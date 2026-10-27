import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { runAgentWithRotation } from './aiAccounts.js';
import { commitTree, getValidGithubToken } from './github.js';
import { AttachmentProcessor } from './attachmentProcessor.js';
import { supabase } from '../db/supabaseClient.js';
import { config } from '../config.js';

const execAsync = promisify(exec);

// Ubicación de almacenamiento para workspaces en caché en el servidor
const WORKSPACES_BASE_DIR = process.env.LOVABLE_WORKSPACES_DIR || 
  (process.platform === 'win32'
    ? path.join(process.cwd(), 'temp-lovable-workspaces')
    : '/opt/flowpro-workspaces');

// Mapeo semántico de componentes y archivos a lenguaje humano
const FRIENDLY_NAMES = {
  'Index.tsx': 'la página de inicio (Index.tsx)',
  'Index.jsx': 'la página de inicio (Index.jsx)',
  'App.tsx': 'la estructura principal (App.tsx)',
  'App.jsx': 'la estructura principal (App.jsx)',
  'Navbar.tsx': 'la barra de navegación (Navbar)',
  'Navbar.jsx': 'la barra de navegación (Navbar)',
  'Header.tsx': 'el encabezado superior (Header)',
  'Footer.tsx': 'el pie de página (Footer)',
  'Hero.tsx': 'la portada principal (Hero)',
  'HeroSection.tsx': 'la portada principal (HeroSection)',
  'index.css': 'el sistema de estilos globales (CSS)',
  'tailwind.config.ts': 'la paleta y tema de Tailwind CSS',
  'tailwind.config.js': 'la paleta y tema de Tailwind CSS',
};

function getFriendlyFileName(relPath) {
  if (!relPath) return 'un archivo';
  const base = path.basename(relPath);
  if (FRIENDLY_NAMES[base]) return FRIENDLY_NAMES[base];
  if (base.endsWith('.tsx') || base.endsWith('.jsx')) return `el componente ${base}`;
  if (base.endsWith('.ts') || base.endsWith('.js')) return `el módulo ${base}`;
  if (base.endsWith('.css')) return `el archivo de estilos ${base}`;
  return `"${relPath}"`;
}


function normalizeLovableMarkdown(text) {
  if (!text || typeof text !== 'string') return '';
  let clean = text.trim();

  // a) Saludo inicial en su propio parrafo
  clean = clean.replace(/^(\u00A1?Hola!?[,.]?|Buenas(?: [a-z]+)?[,.]?|Saludos[,.]?)\s+/i, '$1\n\n');

  // b) Oracion introductoria que termina en dos puntos (ej: "contempla lo siguiente:")
  clean = clean.replace(/([.!?])\s+([A-Za-z\u00C0-\u017F][^.\n!?]{4,85}:)/g, '$1\n\n$2');

  // c) Separar vinetas inline despues de puntuacion (: . ! ? ) )
  clean = clean.replace(/([.:;!?\)])\s*[-–—•●\u2013\u2014\u2022\u25CF]\s+/g, '$1\n\n- ');

  // d) Separar listas numeradas
  clean = clean.replace(/([.:;!?\)])\s*(\d+)\.\s+/g, '$1\n\n$2. ');

  // e) Vinetas con guion en medio de frase
  clean = clean.replace(/(\s+)[-–—•●\u2013\u2014\u2022\u25CF]\s+([A-Za-z0-9_*\u00C0-\u017F])/g, '\n\n- $2');

  // f) Pregunta final que empieza con interrogacion
  clean = clean.replace(/([.:;!])\s+([\u00BF\?][A-Za-z\u00C0-\u017F])/g, '$1\n\n$2');

  // g) Destacar en negrita titulos de items (- Titulo: Texto -> - **Titulo:** Texto)
  clean = clean.replace(/(^|\n)([ \t]*)([-*•–—●\u2013\u2014\u2022\u25CF]|\d+\.)[ \t]+([A-Za-z0-9\u00C0-\u017F][^:\n\*]{2,45}):[ \t]+/g, function(_m, p1, p2, p3, p4) {
    return p1 + p2 + p3 + ' **' + p4 + ':** ';
  });

  return clean;
}

function buildHumanActivityDescription(toolName, toolArgs) {
  const targetPath = toolArgs.path || toolArgs.filePath || '';
  const cleanPath = targetPath.replace(/^\.?\//, '');
  const friendly = getFriendlyFileName(cleanPath);

  if (toolName === 'search_files') {
    const q = (toolArgs.query || '').trim();
    return q ? `Buscando "${q}" en los componentes del proyecto...` : 'Buscando elementos en los archivos...';
  }
  if (toolName === 'read_file') {
    return `Analizando ${friendly}...`;
  }
  if (toolName === 'propose_change' || toolName === 'replace_file_content') {
    const sum = toolArgs.summary ? ` (${toolArgs.summary})` : '';
    return `Actualizando código en ${friendly}${sum}...`;
  }
  if (toolName === 'create_file') {
    return `Creando nuevo archivo en ${friendly}...`;
  }
  if (toolName === 'list_files') {
    return 'Explorando la estructura del proyecto...';
  }
  if (toolName === 'read_table_rows') {
    return `Consultando datos de la tabla "${toolArgs.table || ''}" en Supabase...`;
  }
  if (toolName === 'propose_db_migration') {
    return `Diseñando migración SQL para la base de datos (${toolArgs.migration_name || ''})...`;
  }
  if (toolName === 'message_user') {
    return 'Finalizando y redactando resumen de cambios...';
  }
  return 'Procesando cambios...';
}

/**
 * Obtiene el token de GitHub configurado para clonar y pushear repositorios
 */
/**
 * Validador estático de integridad de módulos (Imports/Exports)
 * Detecta si un archivo modificado importa símbolos locales que no están exportados en el destino,
 * previniendo errores de compilación Vite / TanStack Router / Lovable antes de hacer git push.
 */
async function validateModuleIntegrity(workspaceDir, modifiedFiles) {
  const errors = [];
  const codeExts = ['.ts', '.tsx', '.js', '.jsx'];
  const candidates = (modifiedFiles || []).filter(f => codeExts.includes(path.extname(f)));

  for (const relFile of candidates) {
    const fullSourcePath = path.join(workspaceDir, relFile);
    if (!fs.existsSync(fullSourcePath)) continue;

    let sourceCode = '';
    try {
      sourceCode = await fs.promises.readFile(fullSourcePath, 'utf8');
    } catch (_) {
      continue;
    }

    const importRegex = /import\s+(?:type\s+)?(?:\{([^}]+)\}|([A-Za-z0-9_$]+)\s*,\s*\{([^}]+)\})\s+from\s+['"]([^'"]+)['"]/g;
    let match;

    while ((match = importRegex.exec(sourceCode)) !== null) {
      const namedBlock = match[1] || match[3] || '';
      const modSpecifier = match[4] || '';

      if (!modSpecifier.startsWith('.') && !modSpecifier.startsWith('@/')) {
        continue;
      }

      const importedNames = namedBlock
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => {
          const parts = s.split(/\s+as\s+/);
          return parts[0].replace(/^type\s+/, '').trim();
        })
        .filter(n => n && !n.startsWith('//') && !n.startsWith('/*'));

      if (importedNames.length === 0) continue;

      let resolvedBase = '';
      if (modSpecifier.startsWith('@/')) {
        resolvedBase = path.join(workspaceDir, 'src', modSpecifier.slice(2));
      } else {
        resolvedBase = path.resolve(path.dirname(fullSourcePath), modSpecifier);
      }

      let targetFile = null;
      const testPaths = [
        resolvedBase,
        resolvedBase + '.ts',
        resolvedBase + '.tsx',
        resolvedBase + '.js',
        resolvedBase + '.jsx',
        path.join(resolvedBase, 'index.ts'),
        path.join(resolvedBase, 'index.tsx'),
        path.join(resolvedBase, 'index.js')
      ];

      for (const p of testPaths) {
        if (fs.existsSync(p) && fs.statSync(p).isFile()) {
          targetFile = p;
          break;
        }
      }

      if (!targetFile) {
        errors.push(`[MODULO NO ENCONTRADO] "${relFile}" importa desde "${modSpecifier}", pero el archivo no existe en el proyecto.`);
        continue;
      }

      let targetCode = '';
      try {
        targetCode = await fs.promises.readFile(targetFile, 'utf8');
      } catch (_) {
        continue;
      }

      if (/export\s+\*\s+from/i.test(targetCode)) {
        continue;
      }

      const exportedNames = new Set();
      const declRegex = /export\s+(?:async\s+)?(?:default\s+)?(?:const|function\*?|class|type|interface|enum|let|var)\s+([A-Za-z0-9_$]+)/g;
      let dMatch;
      while ((dMatch = declRegex.exec(targetCode)) !== null) {
        exportedNames.add(dMatch[1]);
      }

      const exportBlockRegex = /export\s+(?:type\s+)?\{([^}]+)\}/g;
      let ebMatch;
      while ((ebMatch = exportBlockRegex.exec(targetCode)) !== null) {
        const items = ebMatch[1].split(',').map(s => s.trim()).filter(Boolean);
        for (const it of items) {
          const parts = it.split(/\s+as\s+/);
          const exportAlias = (parts[1] || parts[0]).replace(/^type\s+/, '').trim();
          if (exportAlias) exportedNames.add(exportAlias);
        }
      }

      if (/export\s+default\s+/i.test(targetCode)) {
        exportedNames.add('default');
      }

      const targetRel = path.relative(workspaceDir, targetFile).replace(/\\/g, '/');

      for (const imp of importedNames) {
        if (!exportedNames.has(imp)) {
          errors.push(`[EXPORT FALTANTE] "${relFile}" intenta importar "${imp}" desde "${modSpecifier}", pero "${targetRel}" no exporta ningún símbolo con el nombre "${imp}".`);
        }
      }
    }
  }

  return errors;
}

async function resolveGithubToken(explicitToken = null, repoOwner = null) {
  // 1. Si hay un token explícito, probarlo contra la API de GitHub
  if (explicitToken && typeof explicitToken === 'string' && explicitToken.trim().length > 0) {
    const cleanToken = explicitToken.trim();
    try {
      const checkRes = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${cleanToken}`, 'User-Agent': 'FlowPro-Lovable-Bridge' }
      });
      if (checkRes.ok) {
        return cleanToken;
      }
      console.warn(`[LovableBridge] El token explícito proporcionado está vencido o es inválido (HTTP ${checkRes.status}). Buscando token para @${repoOwner || 'usuario'}...`);
    } catch (_) {
      return cleanToken;
    }
  }

  // 2. Si se especificó el dueño del repositorio (ej. 'ansgaper23'), buscar a ESE usuario en Supabase
  if (repoOwner && supabase) {
    try {
      const { data: userByOwner } = await supabase
        .from('users')
        .select('*')
        .ilike('github_login', repoOwner)
        .not('github_access_token', 'is', null)
        .maybeSingle();

      if (userByOwner) {
        const validToken = await getValidGithubToken(userByOwner).catch(() => null);
        if (validToken) {
          const testRes = await fetch('https://api.github.com/user', {
            headers: { Authorization: `Bearer ${validToken.trim()}`, 'User-Agent': 'FlowPro-Lovable-Bridge' }
          }).catch(() => null);
          if (testRes && testRes.ok) {
            console.log(`[LovableBridge] ✅ Token válido resuelto para el dueño del repositorio: @${repoOwner}`);
            return validToken.trim();
          }
        }
      }
    } catch (ownerErr) {
      console.warn(`[LovableBridge] Error buscando token para @${repoOwner}:`, ownerErr.message);
    }
  }

  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  if (process.env.GITHUB_ACCESS_TOKEN) return process.env.GITHUB_ACCESS_TOKEN.trim();

  // 3. Buscar cualquier token activo en Supabase como fallback
  try {
    if (supabase) {
      const { data } = await supabase
        .from('users')
        .select('*')
        .not('github_access_token', 'is', null)
        .order('created_at', { ascending: false })
        .limit(5);

      if (data && data.length > 0) {
        for (const u of data) {
          const validToken = await getValidGithubToken(u).catch(() => null);
          if (validToken) {
            const testRes = await fetch('https://api.github.com/user', {
              headers: { Authorization: `Bearer ${validToken.trim()}`, 'User-Agent': 'FlowPro-Lovable-Bridge' }
            }).catch(() => null);
            if (testRes && testRes.ok) {
              return validToken.trim();
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('[LovableBridge] Error al resolver token de Supabase:', err.message);
  }

  return null;
}

/**
 * Recorre recursivamente el repositorio clonado para obtener el árbol de archivos relativo
 */
async function getWorkspaceFileTree(dir, baseDir = dir) {
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    let files = [];
    for (const entry of entries) {
      if (['node_modules', '.git', 'dist', 'build', '.next', '.vite'].includes(entry.name)) {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        const subFiles = await getWorkspaceFileTree(fullPath, baseDir);
        files = files.concat(subFiles);
      } else {
        files.push(relPath);
      }
    }
    return files;
  } catch (_) {
    return [];
  }
}

/**
 * Pre-búsqueda semántica ultrarrápida de archivos relevantes (Arquitectura Lovable Engine).
 * Precarga en memoria los componentes y utilidades más afines al prompt del usuario
 * para que el modelo aplique cambios en Turno 1 sin perder tiempo leyendo en bucle.
 */
async function findRelevantProjectContext(workspaceDir, fileTree, prompt, activeRoute, selectedElement) {
  const contextSnippets = [];
  const candidateFiles = new Set();

  // 1. Elemento seleccionado con Click-to-Edit (prioridad máxima)
  if (selectedElement?.file) {
    const target = selectedElement.file.replace(/^\.?\//, '');
    if (fileTree.includes(target)) candidateFiles.add(target);
  }

  // 2. Ruta activa en pantalla de Lovable (ej: /match/123 -> MatchStream.tsx)
  if (activeRoute && activeRoute !== '/') {
    const cleanRoute = activeRoute.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const rel of fileTree) {
      if (!rel.startsWith('src/pages/') && !rel.startsWith('src/views/')) continue;
      const baseName = path.basename(rel, path.extname(rel)).toLowerCase();
      if (cleanRoute.includes(baseName) || baseName.includes(cleanRoute)) {
        candidateFiles.add(rel);
        break;
      }
    }
  }

  // 3. Palabras clave del prompt
  const stopwords = new Set([
    'para', 'como', 'pero', 'este', 'esta', 'estos', 'estas', 'cuando', 'donde',
    'porque', 'tengo', 'hacer', 'cambiar', 'poner', 'quitar', 'quiero', 'necesito',
    'problema', 'error', 'favor', 'puede', 'puedes', 'todos', 'todas', 'sobre',
    'desde', 'hasta', 'entre', 'hacia', 'tiempo', 'ahora', 'luego', 'antes', 'despues'
  ]);
  const words = (prompt || '')
    .toLowerCase()
    .replace(/[^\w\sáéíóúüñ]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !stopwords.has(w));

  for (const rel of fileTree) {
    if (!rel.startsWith('src/') || rel.endsWith('.d.ts') || rel.includes('.test.') || rel.includes('ui/')) continue;
    const lowerRel = rel.toLowerCase();
    for (const w of words) {
      if (lowerRel.includes(w)) {
        candidateFiles.add(rel);
        break;
      }
    }
    if (candidateFiles.size >= 6) break;
  }

  // 4. Mapeo semántico por intenciones comunes
  const lowerPrompt = (prompt || '').toLowerCase();
  const semanticRules = [
    { regex: /embed|servidor|reproductor|stream|video|player|iframe/i, pattern: /player|stream|video|embed/i },
    { regex: /header|menu|navbar|navegacion|barra/i, pattern: /header|navbar|nav/i },
    { regex: /footer|pie\s+de\s+pagina/i, pattern: /footer/i },
    { regex: /agenda|partido|partidos|evento|match/i, pattern: /match|agenda|schedule/i },
    { regex: /canal|canales|channel|lista/i, pattern: /channel|canal/i },
    { regex: /login|auth|sesion|usuario|perfil|registro/i, pattern: /auth|login|profile|user/i },
    { regex: /database|supabase|tabla|datos|guardar/i, pattern: /supabase|db|api/i }
  ];

  for (const rule of semanticRules) {
    if (rule.regex.test(lowerPrompt)) {
      const matches = fileTree.filter(f => rule.pattern.test(f) && !f.includes('ui/'));
      matches.slice(0, 3).forEach(f => candidateFiles.add(f));
    }
  }

  // 5. Leer contenido de los archivos candidatos más relevantes (máximo 4 archivos, tope 35KB)
  let totalChars = 0;
  const maxChars = 35000;

  for (const rel of candidateFiles) {
    if (totalChars >= maxChars || contextSnippets.length >= 4) break;
    const fullPath = path.join(workspaceDir, rel);
    try {
      if (fs.existsSync(fullPath)) {
        const content = await fs.promises.readFile(fullPath, 'utf8');
        if (content && content.length < 18000) {
          contextSnippets.push(`--- ARCHIVO CLAVE RELEVANTE: ${rel} ---\n\`\`\`typescript\n${content}\n\`\`\``);
          totalChars += content.length;
        }
      }
    } catch (_) {}
  }

  return contextSnippets;
}

/**
 * Elimina locks residuales de Git si un proceso anterior terminó inesperadamente
 */
async function clearGitLocks(workspaceDir) {
  try {
    const lockPath = path.join(workspaceDir, '.git', 'index.lock');
    if (fs.existsSync(lockPath)) {
      await fs.promises.unlink(lockPath);
    }
  } catch (_) {}
}

/**
 * Ejecuta el pipeline completo de Lovable Bridge
 * @param {Object} params
 * @param {string} params.projectId
 * @param {string} params.prompt
 * @param {Object} params.github { owner, repo, branch, token }
 * @param {string} [params.activeRoute]
 * @param {Function} [params.onActivity] Callback para telemetría efímera en vivo
 * @returns {Promise<{ ok: boolean, summary: string, message?: string, filesModified: string[], commitSha: string }>}
 */
export async function processLovableDispatch({ projectId, prompt, github, activeRoute, selectedElement, attachments, onActivity }) {
  const notifyActivity = (desc) => {
    if (typeof onActivity === 'function') {
      try {
        onActivity(desc);
      } catch (_) {}
    }
  };

  if (!github || !github.owner || !github.repo) {
    return {
      ok: false,
      error: 'MISSING_GITHUB_LINK',
      message: 'Por favor vincula tu proyecto a GitHub en los ajustes de Lovable para sincronizar con FlowPro.'
    };
  }

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return {
      ok: false,
      error: 'MISSING_PROMPT',
      message: 'El campo prompt es obligatorio.'
    };
  }

  const owner = github.owner.trim();
  const repo = github.repo.trim();
  const branch = (github.branch || 'main').trim();
  const token = await resolveGithubToken(github.token, owner);

  // Asegurar directorio base de workspaces
  await fs.promises.mkdir(WORKSPACES_BASE_DIR, { recursive: true });

  if (!token) {
    console.error(`[LovableBridge] No se pudo resolver un token de GitHub válido para ${owner}/${repo}`);
    return {
      ok: false,
      error: 'GITHUB_AUTH_FAILED',
      message: `No se pudo autenticar con GitHub para "${owner}/${repo}". Tu token de GitHub ha expirado o no tiene permisos de escritura.\n\n👉 Por favor haz clic arriba en el botón [🔑 Conectar GitHub] en FlowPro para autorizar vía OAuth o introduce un Personal Access Token (classic) con permiso 'repo'.`
    };
  }

  const safeProjectId = String(projectId || `${owner}-${repo}`).replace(/[^a-zA-Z0-9_-]/g, '');
  const workspaceDir = path.join(WORKSPACES_BASE_DIR, `lovable-${safeProjectId}`);

  // ── PASO A: Clonación o Actualización del Repositorio de GitHub ──
  notifyActivity(`Conectando con repositorio ${owner}/${repo}...`);
  console.log(`[LovableBridge] Preparando repositorio ${owner}/${repo} (${branch}) en ${workspaceDir}...`);

  const gitAuthUrl = token 
    ? `https://x-access-token:${token}@github.com/${owner}/${repo}.git`
    : `https://github.com/${owner}/${repo}.git`;

  try {
    if (fs.existsSync(path.join(workspaceDir, '.git'))) {
      notifyActivity('Sincronizando cambios locales con GitHub (git pull)...');
      console.log(`[LovableBridge] Repositorio existente detectado en caché. Actualizando con git pull...`);
    await clearGitLocks(workspaceDir);
      await execAsync(`git remote set-url origin "${gitAuthUrl}"`, { cwd: workspaceDir });
      try {
        await execAsync(`git fetch origin "${branch}"`, { cwd: workspaceDir });
        await execAsync(`git checkout "${branch}"`, { cwd: workspaceDir });
        await execAsync(`git pull origin "${branch}"`, { cwd: workspaceDir });
      } catch (pullErr) {
        console.warn(`[LovableBridge] git pull falló (${pullErr.message}), intentando continuar con estado local...`);
      }
    } else {
      notifyActivity(`Clonando ${owner}/${repo} por primera vez...`);
      console.log(`[LovableBridge] Clonando repositorio ${owner}/${repo} por primera vez...`);
      if (fs.existsSync(workspaceDir)) {
        await fs.promises.rm(workspaceDir, { recursive: true, force: true });
      }
      try {
        await execAsync(`git clone --depth 50 -b "${branch}" "${gitAuthUrl}" "${workspaceDir}"`);
      } catch (cloneErr) {
        console.warn(`[LovableBridge] Clone con branch específica falló, intentando clone por defecto:`, cloneErr.message);
        await execAsync(`git clone --depth 50 "${gitAuthUrl}" "${workspaceDir}"`);
      }
    }

    // Configurar identidad git local para el workspace
    await execAsync('git config user.name "FlowPro Bridge"', { cwd: workspaceDir });
    await execAsync('git config user.email "bridge@flow-pro.online"', { cwd: workspaceDir });
  } catch (gitPrepErr) {
    console.error(`[LovableBridge] Error en preparación de Git:`, gitPrepErr.message);
    const isAuthErr = /authentication failed|invalid username or token|bad credentials/i.test(gitPrepErr.message);
    if (isAuthErr) {
      throw new Error(`GITHUB_AUTH_FAILED: El token de GitHub ha expirado o no tiene permisos para acceder al repositorio "${owner}/${repo}". Por favor actualiza tu token en el botón [🔑 Conectar GitHub] de FlowPro.`);
    }
    throw new Error(`No se pudo sincronizar el repositorio de GitHub (${owner}/${repo}): ${gitPrepErr.message}`);
  }

  // Leer esquema de base de datos de Lovable (src/integrations/supabase/types.ts) si existe
  let supabaseTypes = '';
  const typesCandidate = path.join(workspaceDir, 'src', 'integrations', 'supabase', 'types.ts');
  if (fs.existsSync(typesCandidate)) {
    try {
      const rawTypes = await fs.promises.readFile(typesCandidate, 'utf8');
      supabaseTypes = rawTypes.slice(0, 15000); // Primeras 15k para no desbordar contexto
    } catch (_) {}
  }

  // Resolver credenciales y cliente de Supabase del proyecto Lovable si existen
  let supabaseUrl = '';
  let supabaseAnonKey = '';
  let projectSupabase = null;

  const envPath = path.join(workspaceDir, '.env');
  if (fs.existsSync(envPath)) {
    try {
      const envRaw = await fs.promises.readFile(envPath, 'utf8');
      const urlM = envRaw.match(/VITE_SUPABASE_URL=["']?([^"'\r\n]+)/);
      const keyM = envRaw.match(/VITE_SUPABASE_PUBLISHABLE_KEY=["']?([^"'\r\n]+)/) ||
                   envRaw.match(/VITE_SUPABASE_ANON_KEY=["']?([^"'\r\n]+)/);
      if (urlM && urlM[1]) supabaseUrl = urlM[1].trim();
      if (keyM && keyM[1]) supabaseAnonKey = keyM[1].trim();
    } catch (_) {}
  }

  // Fallback: buscar URL en src/integrations/supabase/client.ts
  if (!supabaseUrl) {
    const clientPath = path.join(workspaceDir, 'src', 'integrations', 'supabase', 'client.ts');
    if (fs.existsSync(clientPath)) {
      try {
        const clientRaw = await fs.promises.readFile(clientPath, 'utf8');
        const urlM = clientRaw.match(/https:\/\/[a-z0-9-]+\.supabase\.co/i);
        if (urlM) supabaseUrl = urlM[0];
      } catch (_) {}
    }
  }

  if (supabaseUrl && supabaseAnonKey) {
    try {
      projectSupabase = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      console.log(`[LovableBridge] Conectado a Supabase de Lovable: ${supabaseUrl}`);
    } catch (e) {
      console.warn(`[LovableBridge] No se pudo inicializar cliente de Supabase:`, e.message);
    }
  }

  // Leer migraciones SQL existentes en supabase/migrations/
  let existingMigrations = [];
  const migrationsDir = path.join(workspaceDir, 'supabase', 'migrations');
  if (fs.existsSync(migrationsDir)) {
    try {
      const migFiles = await fs.promises.readdir(migrationsDir);
      existingMigrations = migFiles.filter(f => f.endsWith('.sql')).sort();
    } catch (_) {}
  }

  // Leer package.json para respetar dependencias existentes
  let packageJsonContent = '';
  const pkgPath = path.join(workspaceDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      packageJsonContent = await fs.promises.readFile(pkgPath, 'utf8');
    } catch (_) {}
  }

  // Leer árbol de archivos
  const fileTree = await getWorkspaceFileTree(workspaceDir);

  // ── PRE-INDEXACIÓN SEMÁNTICA RÁPIDA (Estilo Lovable Engine) ──
  // Identifica y precarga en memoria los archivos directamente relacionados con la solicitud
  // para que el modelo aplique cambios en Ronda 1 sin perder tiempo leyendo en bucle.
  const preloadedContext = await findRelevantProjectContext(workspaceDir, fileTree, prompt, activeRoute, selectedElement);

  // ── PASO B: Bucle Cognitivo del Agente de FlowPro ──
  // ── CLASIFICADOR DE INTENCIÓN DE USUARIO (Estilo Lovable Engine) ──
  const cleanPrompt = (prompt || '').toLowerCase().trim();
  const hasQuestionIntent = /\?|¿|por\s*qu[eé]|c[oó]mo\s+(?:funciona|est[aá]|hace|se)|cu[aá]l|qu[eé]\s+(?:es|hace|significa|tablas|columnas|archivos|roles)|explica|analiza|audita|diagnostica|dime|muestra|donde|d[oó]nde|por\s+que/i.test(cleanPrompt);
  const hasActionIntent = /\b(?:cambi[aáeé]|cre[aáeé]|agr[eé]g[aáeé]|a[ñn][aá]d[aáeé]|el[ií]min[aáeé]|b[oó]rr[aáeé]|mod[ií]fic[aáeé]|corr[ií]g[aáeé]|arr[eé]gl[aáeé]|soluci[oó]n[aáeé]|resuelv[aáeé]|resolv[eé]r?|implement[aáeé]|actualiz[aáeé]|ren[oó]mbr[aáeé]|h[aá]z|hacer|hag[aá]|p[oó]n|qu[ií]t[aáeé]|reempl[aá]z[aáeé]|aj[uú]st[aáeé]|rep[aá]r[aáeé]|fix|update|delete|insert)(?:[rn]|lo|la|los|las|me|nos)?\b/i.test(cleanPrompt);

  let detectedIntent = 'ACTION';
  if (hasQuestionIntent && hasActionIntent) {
    detectedIntent = 'HYBRID';
  } else if (hasQuestionIntent && !hasActionIntent) {
    detectedIntent = 'QUERY';
  }

  notifyActivity('Analizando solicitud y planificando cambios...');
  console.log(`[LovableBridge] Ejecutando bucle de inferencia para: "${prompt}"...`);

  const filesModified = new Set();
  let agentSummary = '';
  let agentMessage = '';
  let readToolCount = 0;

  const selectedElementBlock = selectedElement ? `
ELEMENTO VISUAL SELECCIONADO POR EL USUARIO EN PANTALLA (CLICK-TO-EDIT):
- Archivo objetivo: ${selectedElement.file || selectedElement.path || 'Desconocido'}
- Línea aproximada: ${selectedElement.line || 'N/A'}
- Componente JSX: <${selectedElement.component || 'Component'}>
- Etiqueta HTML: <${selectedElement.tag || 'div'}>
- Texto o etiqueta visible: "${selectedElement.textSnippet || ''}"
- Ruta activa en pantalla: "${activeRoute || selectedElement.route || '/'}"
REGLA PRIORITARIA: El usuario ha inspeccionado/seleccionado visualmente este elemento en pantalla. Centra y enfoca tus cambios directamente en este archivo y componente.` : '';

  const systemPrompt = `Eres FlowPro Lovable Bridge Agent, el orquestador autónomo de ingeniería de software.
Estás modificando el proyecto web alojado en el repositorio GitHub "${owner}/${repo}" vinculado a Lovable.dev.

TONO Y ESTILO DE COMUNICACIÓN (LOVABLE NATIVE PERSONA):
- Eres el asistente y compañero de desarrollo senior de Lovable (FlowPro). Tu tono es cálido, empático, directo, profesional y muy amigable.
- NUNCA uses encabezados artificiales ni burocráticos como "### Diagnóstico", "### Análisis Técnico", "---", ni "### Recomendaciones".
- NUNCA vomites bloques de código fuente, llamadas a useEffect, dependencias de hooks o rutas internas de archivos a menos que el usuario lo solicite expresamente.
- Responde siempre en Markdown limpio y bien estructurado:
  - Escribe una frase breve de saludo o introducción en su propio párrafo.
  - Deja una línea en blanco entre cada párrafo.
  - Cuando enumeres puntos, usa listas de Markdown reales, con cada viñeta en su propia línea comenzando con '- ' (nunca pongas varias viñetas dentro del mismo párrafo ni uses el símbolo '•' en línea).
  - Resalta los términos clave en **negrita**.
  - Sé conciso: máximo 4 a 6 viñetas, de una o dos líneas cada una.
  - Si haces una pregunta al final, ponla en un párrafo aparte.
- Cierra con una pregunta amable ofreciendo el siguiente paso de forma abierta y colaborativa.

${detectedIntent === 'QUERY' ? `MODO CONSULTA / PREGUNTA:
- Responde la duda del usuario de forma directa y amigable en el primer párrafo.
- Si hay condiciones o datos clave, destácalos en 2 o 3 viñetas breves con negritas.
- Concluye con una pregunta cordial ofreciendo ajustar o implementar mejoras.` 
: detectedIntent === 'HYBRID' ? `MODO HÍBRIDO (PREGUNTA + ACCIÓN):
- Responde amistosamente a la pregunta en 1 o 2 oraciones.
- Aplica la corrección en el código con "edit_file".
- Confirma en 1 frase lo que se solucionó y cómo verificarlo en la vista previa.` 
: `MODO EJECUCIÓN PURA (ACCIÓN):
- Procede de inmediato a aplicar los cambios en el código con "edit_file".
- Confirma amistosamente el cambio en 1 o 2 oraciones claras invitando a verlo en la vista previa.`}

INFORMACIÓN DEL ENTORNO DE LOVABLE:
- Tecnologías: Vite + React + TypeScript + Tailwind CSS v3 + shadcn/ui + Lucide React.
- Ruta activa en pantalla de Lovable: "${activeRoute || '/'}"
${selectedElementBlock}
${projectSupabase ? `- Base de datos Supabase conectada y activa: "${supabaseUrl}". Dispones de la herramienta "read_table_rows" para consultar registros reales.\n` : ''}
${supabaseTypes ? `- Esquema de Base de Datos Supabase (types.ts):\n\`\`\`typescript\n${supabaseTypes}\n\`\`\`\n` : ''}
${existingMigrations.length > 0 ? `- Migraciones SQL registradas (${existingMigrations.length}):\n${existingMigrations.slice(-5).map(m => `  • supabase/migrations/${m}`).join('\n')}\n` : ''}
${packageJsonContent ? `- package.json del proyecto:\n\`\`\`json\n${packageJsonContent}\n\`\`\`\n` : ''}
${preloadedContext.length > 0 ? `
ARCHIVOS DEL PROYECTO DIRECTAMENTE RELACIONADOS (PRE-CARGADOS EN MEMORIA PARA EDICIÓN INMEDIATA):
${preloadedContext.join('\n\n')}
` : ''}

ÁRBOL DE ARCHIVOS ACTUAL DEL REPOSITORIO:
${fileTree.slice(0, 100).map(f => `- ${f}`).join('\n')}

REGLAS DE ORO:
1. PRIORIDAD DE EDICIÓN QUIRÚRGICA Y PREVENCIÓN DE TRUNCAMIENTO:
   - Para modificar archivos existentes, PRIORIZA SIEMPRE la herramienta "edit_file" especificando el bloque exacto ("target") y su sustituto ("replacement").
   - Queda ESTRICTAMENTE PROHIBIDO enviar fragmentos parciales o snippets a "propose_change" o "replace_file_content". Esas herramientas son únicamente para archivos nuevos ("create_file") o reescrituras 100% completas conservando todos sus imports, tipos y componentes existentes.
   - Si la solicitud requiere cambios de código, actúa de inmediato sin pasar más de 2 o 3 rondas leyendo archivos.
2. INTEGRIDAD ABSOLUTA DE IMPORTS Y EXPORTS (PREVENCIÓN DE ERRORES DE COMPILACIÓN):
   - NUNCA importes una función, tipo o componente desde un archivo local (@/... o ./...) sin haber comprobado con "read_file" o "search_files" que el archivo destino REALMENTE lo exporta con ese nombre exacto.
   - ATOMICIDAD: Si creas o modificas una interfaz visual que necesita nuevas funciones de backend, helpers en src/lib/ o consultas, DEBES modificar o exportar dichas funciones en el archivo de helpers antes de finalizar.
3. REGLAS DE STREAMING Y REPRODUCTORES:
   - Para reproductores de video e iframes de streaming:
     * Usa siempre referrerPolicy="no-referrer" en etiquetas <iframe> para evitar bloqueos por Anti-Hotlinking de servidores de streaming.
     * Añade todos los permisos necesarios en allow="autoplay; encrypted-media; fullscreen; picture-in-picture; screen-wake-lock; clipboard-write; web-share".
     * Soporta URLs de embed limpias sin destruir parámetros esenciales como ?r= o ?url=.
4. DISEÑO Y COMPONENTES:
   - Respeta el diseño existente: Tailwind CSS v3 (usa tokens semánticos o clases nativas), componentes shadcn/ui en @/components/ui, y lucide-react.
   - NO uses Tailwind v4 (@import "tailwindcss" o @theme).
5. GESTIÓN DE BASE DE DATOS Y SUPABASE:
   - Para consultar datos existentes, usa la herramienta "read_table_rows".
   - Para crear nuevas tablas o columnas, usa "propose_db_migration" con SQL idempotente (CREATE TABLE IF NOT EXISTS, ALTER TABLE ADD COLUMN IF NOT EXISTS).
   - Respeta siempre el esquema de Supabase tipado en "src/integrations/supabase/types.ts".
6. CIERRE OBLIGATORIO (ESTILO AMIGABLE Y RESUMIDO DE LOVABLE):
   - Al terminar, llama OBLIGATORIAMENTE a "message_user" con:
     * summary: Un título semántico muy corto (3 a 6 palabras, ej: "Licencia de prueba explicada" o "Pestaña renombrada a FLOW PRO").
     * message: Un mensaje cálido, conciso, conversacional y natural (1 o 2 párrafos breves o 2-3 viñetas limpias). Cero encabezados formales, cero explicaciones redundantes de código.`;

  // ── 1. DEFINICIÓN DE HERRAMIENTAS UNIVERSAL (Antigravity, Anthropic, Gemini, OpenAI) ──
  const makeTool = (name, description, schema) => ({
    name,
    description,
    input_schema: schema,
    parameters: schema
  });

  const tools = [
    makeTool(
      'edit_file',
      'Reemplaza una sección específica de código en un archivo existente buscando un bloque exacto (target) y sustituyéndolo por el nuevo bloque (replacement). Ideal para modificaciones puntuales sin reescribir todo el archivo.',
      {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Ruta relativa del archivo a editar (ej: src/components/dashboard/SuperAdminDashboard.tsx)' },
          target: { type: 'string', description: 'Texto o bloque de código EXACTO existente que se desea reemplazar' },
          replacement: { type: 'string', description: 'Nuevo texto o bloque de código que sustituirá a target' },
          summary: { type: 'string', description: 'Resumen descriptivo del cambio' }
        },
        required: ['path', 'target', 'replacement']
      }
    ),
    makeTool(
      'propose_change',
      'Propone o aplica una modificación completa sobre un archivo del repositorio.',
      {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Ruta relativa del archivo (ej: src/pages/Index.tsx)' },
          new_content: { type: 'string', description: 'Contenido completo y actualizado del archivo' },
          summary: { type: 'string', description: 'Resumen descriptivo del cambio' }
        },
        required: ['path']
      }
    ),
    makeTool(
      'replace_file_content',
      'Modifica o sobreescribe un archivo existente con el código nuevo completo.',
      {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Ruta relativa del archivo a modificar' },
          filePath: { type: 'string', description: 'Ruta alternativa' },
          content: { type: 'string', description: 'Código fuente completo actualizado' },
          summary: { type: 'string', description: 'Resumen descriptivo del cambio' }
        }
      }
    ),
    makeTool(
      'create_file',
      'Crea un nuevo archivo en el repositorio.',
      {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Ruta relativa del nuevo archivo' },
          filePath: { type: 'string', description: 'Ruta alternativa' },
          content: { type: 'string', description: 'Código fuente completo' },
          summary: { type: 'string', description: 'Resumen descriptivo' }
        }
      }
    ),
    makeTool(
      'read_file',
      'Lee el contenido completo de un archivo del repositorio.',
      {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Ruta relativa del archivo' },
          filePath: { type: 'string', description: 'Ruta alternativa' }
        }
      }
    ),
    makeTool(
      'list_files',
      'Lista el árbol de archivos disponibles en el repositorio.',
      {
        type: 'object',
        properties: {
          directory: { type: 'string', description: 'Directorio opcional' }
        }
      }
    ),
    makeTool(
      'search_files',
      'Busca texto, frases o componentes dentro de los archivos del repositorio.',
      {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Texto o término a buscar' }
        },
        required: ['query']
      }
    ),
    makeTool(
      'read_table_rows',
      'Lee filas y registros reales de una tabla en la base de datos Supabase conectada.',
      {
        type: 'object',
        properties: {
          table: { type: 'string', description: 'Nombre exacto de la tabla (ej: categories, orders, products, profiles)' },
          limit: { type: 'integer', description: 'Cantidad máxima de filas a consultar (por defecto 15, máx 50)' }
        },
        required: ['table']
      }
    ),
    makeTool(
      'propose_db_migration',
      'Crea una nueva migración SQL en supabase/migrations/<timestamp>_<nombre>.sql para añadir o modificar tablas, columnas, funciones o RLS en Supabase.',
      {
        type: 'object',
        properties: {
          migration_name: { type: 'string', description: 'Nombre descriptivo en snake_case (ej: add_status_to_orders, create_bookings_table)' },
          sql_content: { type: 'string', description: 'Sentencias SQL completas e idempotentes (CREATE TABLE IF NOT EXISTS, ALTER TABLE ADD COLUMN IF NOT EXISTS, RLS, etc.)' },
          summary: { type: 'string', description: 'Resumen descriptivo del cambio en la estructura de la base de datos' }
        },
        required: ['migration_name', 'sql_content']
      }
    ),
    makeTool(
      'message_user',
      'Entrega la respuesta al usuario con el estilo nativo de Lovable: amigable, cálido, conversacional y muy resumido (máximo 1-2 párrafos cortos o 2-3 viñetas breves). Queda terminantemente PROHIBIDO usar encabezados formales tipo "### Diagnóstico", "### Análisis Técnico", "---", ni pegar bloques de código o rutas internas a menos que el usuario lo haya pedido expresamente.',
      {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Título o resumen de una sola línea (3 a 6 palabras, ej: Asignación de licencia de prueba)' },
          message: { type: 'string', description: 'Mensaje amigable, natural y resumido estilo Lovable (1-2 párrafos breves, sin jerga académica ni encabezados rígidos)' }
        },
        required: ['summary', 'message']
      }
    )
  ];

  // ── 2. EJECUTOR DE HERRAMIENTAS ADAPTATIVO (Soporta { name, input } y (name, args)) ──
  const executeTool = async (arg1, arg2) => {
    let toolName = '';
    let toolArgs = {};

    if (arg1 && typeof arg1 === 'object' && arg1.name) {
      toolName = arg1.name;
      toolArgs = arg1.input || {};
    } else {
      toolName = typeof arg1 === 'string' ? arg1 : '';
      toolArgs = (arg2 && typeof arg2 === 'object') ? arg2 : {};
    }

    // Emitir telemetría de la actividad en vivo
    const humanDesc = buildHumanActivityDescription(toolName, toolArgs);
    if (humanDesc) {
      notifyActivity(humanDesc);
    }

    console.log(`[LovableBridge] Ejecutando tool: "${toolName}" con args:`, Object.keys(toolArgs));

    // A. list_files: bridgeClient requiere obligatoriamente un Array de strings
    if (toolName === 'list_files') {
      const dir = (toolArgs.directory || '').replace(/^\.?\//, '');
      const list = dir ? fileTree.filter(f => f.startsWith(dir)) : fileTree;
      return list;
    }

    // B. search_files: búsqueda en archivos de código
    if (toolName === 'search_files') {
      readToolCount++;
      const q = (toolArgs.query || '').toLowerCase();
      if (!q) return 'Debes especificar un término de búsqueda.';
      const matches = [];
      for (const rel of fileTree) {
        if (!rel.startsWith('src/') && rel !== 'index.html' && rel !== 'package.json') continue;
        const full = path.join(workspaceDir, rel);
        try {
          const txt = await fs.promises.readFile(full, 'utf8');
          if (txt.toLowerCase().includes(q)) matches.push(rel);
        } catch (_) {}
      }
      const res = matches.length > 0
        ? `Coincidencias encontradas en:\n${matches.join('\n')}`
        : `No se encontró ninguna coincidencia para "${toolArgs.query}".`;

      if (readToolCount >= 3 && filesModified.size === 0) {
        if (detectedIntent === 'QUERY') {
          return `${res}\n\n[DIRECTIVA INFORMATIVA]: Ya has recopilado suficiente contexto (${readToolCount} lecturas). Procede AHORA a redactar tu respuesta bien estructurada llamando a "message_user". No es necesario modificar archivos.`;
        } else {
          return `${res}\n\n[DIRECTIVA DE ACCIÓN INMEDIATA]: Ya has realizado ${readToolCount} lecturas. Procede AHORA a aplicar los cambios en el código usando "edit_file".`;
        }
      }
      return res;
    }

    // C. read_file: lectura de archivo
    if (toolName === 'read_file') {
      readToolCount++;
      const targetPath = toolArgs.path || toolArgs.filePath || '';
      const cleanPath = targetPath.replace(/^\.?\//, '');
      if (!cleanPath) return 'Error: Falta especificar la ruta del archivo.';
      const fullTarget = path.join(workspaceDir, cleanPath);
      if (!fs.existsSync(fullTarget)) {
        return `Error: El archivo "${cleanPath}" no existe en el repositorio.`;
      }
      const content = await fs.promises.readFile(fullTarget, 'utf8');
      const snippet = content.slice(0, 100000);

      if (readToolCount >= 3 && filesModified.size === 0) {
        if (detectedIntent === 'QUERY') {
          return `${snippet}\n\n[DIRECTIVA INFORMATIVA]: Ya has revisado ${readToolCount} archivos y dispones del contexto necesario. Procede AHORA a redactar tu respuesta analítica y bien estructurada llamando a "message_user". No es necesario modificar archivos.`;
        } else {
          return `${snippet}\n\n[DIRECTIVA DE ACCIÓN INMEDIATA]: Ya has revisado ${readToolCount} archivos. Tienes el contexto completo. Procede AHORA a aplicar la solución sobre el archivo objetivo usando "edit_file".`;
        }
      }
      return snippet;
    }

    // D0. edit_file: reemplazo puntual de texto
    if (toolName === 'edit_file') {
      const targetPath = toolArgs.path || toolArgs.filePath || '';
      const cleanPath = targetPath.replace(/^\.?\//, '');
      if (!cleanPath) return 'Error: Falta especificar la ruta del archivo.';
      const fullTarget = path.join(workspaceDir, cleanPath);
      if (!fs.existsSync(fullTarget)) {
        return `Error: El archivo "${cleanPath}" no existe en el repositorio.`;
      }
      const existingContent = await fs.promises.readFile(fullTarget, 'utf8');
      const targetStr = toolArgs.target;
      const replacementStr = toolArgs.replacement ?? '';

      if (typeof targetStr !== 'string' || !targetStr) {
        return 'Error: Debes especificar el parámetro "target" con el bloque de texto exacto a reemplazar.';
      }

      if (!existingContent.includes(targetStr)) {
        return `Error: El bloque target no fue encontrado exactamente en "${cleanPath}". Asegúrate de copiar el texto exacto incluyendo espacios, saltos de línea e indentación.`;
      }

      const updatedContent = existingContent.replace(targetStr, replacementStr);
      await fs.promises.writeFile(fullTarget, updatedContent, 'utf8');
      filesModified.add(cleanPath);
      if (toolArgs.summary) agentSummary = toolArgs.summary;
      console.log(`[LovableBridge] ✅ Archivo editado puntualmente con edit_file: ${cleanPath}`);
      return `Archivo "${cleanPath}" editado exitosamente. Se reemplazó la sección indicada sin afectar el resto del archivo.`;
    }

    // D. propose_change / replace_file_content / create_file: escritura en disco
    if (toolName === 'propose_change' || toolName === 'replace_file_content' || toolName === 'create_file') {
      const targetPath = toolArgs.path || toolArgs.filePath || '';
      const cleanPath = targetPath.replace(/^\.?\//, '');
      if (!cleanPath) return 'Error: Falta especificar la ruta del archivo.';

      const fileContent = toolArgs.new_content ?? toolArgs.content ?? toolArgs.code ?? toolArgs.new_str ?? '';
      const fullTarget = path.join(workspaceDir, cleanPath);

      // Salvaguarda contra truncamiento catastrófico de archivos
      if (fs.existsSync(fullTarget) && toolName !== 'create_file') {
        try {
          const existingContent = await fs.promises.readFile(fullTarget, 'utf8');
          const existingLines = existingContent.split('\n').length;
          const newLines = fileContent.split('\n').length;
          if (existingLines > 80 && newLines < (existingLines * 0.35)) {
            console.warn(`[LovableBridge] ⚠️ Salvaguarda activada: Intento de truncamiento destructivo en ${cleanPath} (De ${existingLines} a ${newLines} líneas).`);
            return `ERROR DE INTEGRIDAD: El archivo "${cleanPath}" tiene ${existingLines} líneas y el contenido enviado solo tiene ${newLines} líneas. Se ha bloqueado la sobreescritura para evitar borrar el componente. Debes enviar el código COMPLETO conservando todos los imports, componentes y exports existentes.`;
          }
        } catch (_) {}
      }

      await fs.promises.mkdir(path.dirname(fullTarget), { recursive: true });
      await fs.promises.writeFile(fullTarget, fileContent, 'utf8');
      filesModified.add(cleanPath);
      if (toolArgs.summary) agentSummary = toolArgs.summary;
      console.log(`[LovableBridge] ✅ Archivo modificado: ${cleanPath} (${fileContent.length} caracteres)`);
      return `Archivo "${cleanPath}" guardado exitosamente.`;
    }

    // E. read_table_rows: consulta de registros reales en Supabase
    if (toolName === 'read_table_rows') {
      if (!projectSupabase) {
        return 'No se pudo conectar a la base de datos Supabase: credenciales VITE_SUPABASE_URL o VITE_SUPABASE_PUBLISHABLE_KEY no encontradas en el archivo .env del repositorio.';
      }
      const tableName = String(toolArgs.table || '').trim();
      const limit = Math.min(Math.max(Number(toolArgs.limit) || 15, 1), 50);
      try {
        const { data, error } = await projectSupabase.from(tableName).select('*').limit(limit);
        if (error) {
          return `Error al consultar la tabla "${tableName}": ${error.message} (Código: ${error.code || 'N/A'}). Verifica si la tabla existe en types.ts y las políticas RLS.`;
        }
        if (!data || data.length === 0) {
          return `La tabla "${tableName}" existe pero no contiene ningún registro actualmente.`;
        }
        return JSON.stringify(data, null, 2);
      } catch (err) {
        return `Error ejecutando consulta en "${tableName}": ${err.message}`;
      }
    }

    // F. propose_db_migration: crear archivo de migración SQL en supabase/migrations/
    if (toolName === 'propose_db_migration') {
      const rawName = String(toolArgs.migration_name || 'migration').replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
      const now = new Date();
      const timestamp = now.toISOString().replace(/[-:T]/g, '').slice(0, 14); // YYYYMMDDHHMMSS
      const fileName = `${timestamp}_${rawName}.sql`;
      const relPath = path.join('supabase', 'migrations', fileName).replace(/\\/g, '/');
      const fullPath = path.join(workspaceDir, relPath);

      await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.promises.writeFile(fullPath, toolArgs.sql_content, 'utf8');
      filesModified.add(relPath);

      if (toolArgs.summary) agentSummary = toolArgs.summary;
      console.log(`[LovableBridge] ✅ Migración SQL creada: ${relPath}`);
      return `Migración SQL creada exitosamente en "${relPath}". Se subirá a GitHub para aplicarse en Supabase.`;
    }

    // G. update_memory: noop para compatibilidad con Antigravity
    if (toolName === 'update_memory') {
      return 'Memoria registrada.';
    }

    // H. message_user: cierre de turno con validación previa de integridad
    if (toolName === 'message_user') {
      const integrityErrors = await validateModuleIntegrity(workspaceDir, Array.from(filesModified));
      if (integrityErrors.length > 0) {
        console.warn(`[LovableBridge] ⚠️ Error de integridad de módulos detectado antes de message_user:`, integrityErrors);
        return `ERROR DE INTEGRIDAD DE COMPILACIÓN DETECTADO:\n${integrityErrors.join('\n')}\n\nDEBES corregir las importaciones o exportar las funciones/tipos faltantes en sus respectivos archivos usando "edit_file" antes de poder concluir con message_user.`;
      }
      agentSummary = toolArgs.summary || agentSummary;
      agentMessage = normalizeLovableMarkdown(toolArgs.message || '');
      return 'Resumen enviado.';
    }

    return `Herramienta desconocida: ${toolName}`;
  };

  try {
    // ── PROCESAMIENTO DE DOCUMENTOS Y ADJUNTOS MULTIMODAL ──
    const documentContextBlocks = [];
    if (attachments && Array.isArray(attachments) && attachments.length > 0) {
      for (const att of attachments) {
        if (!att || !att.data) continue;
        const name = att.name || 'documento';
        const mime = att.type || '';

        let buffer = null;
        try {
          const base64Data = att.data.includes('base64,') ? att.data.split('base64,')[1] : att.data;
          buffer = Buffer.from(base64Data, 'base64');
        } catch (bErr) {
          console.warn(`[LovableBridge] No se pudo decodificar adjunto ${name}:`, bErr.message);
          continue;
        }

        notifyActivity(`Extrayendo contenido de "${name}"...`);
        const lowerName = name.toLowerCase();
        const isImage =
          mime.startsWith('image/') ||
          lowerName.endsWith('.png') ||
          lowerName.endsWith('.jpg') ||
          lowerName.endsWith('.jpeg') ||
          lowerName.endsWith('.webp') ||
          lowerName.endsWith('.svg') ||
          lowerName.endsWith('.gif');

        // Imágenes: guardar en public/images/ y documentar
        if (isImage) {
          try {
            let safeName = name.replace(/[^a-zA-Z0-9_.-]/g, '_');
            if (!path.extname(safeName)) {
              const ext = mime.split('/')[1] || 'png';
              safeName += `.${ext.replace('+xml', '')}`;
            }
            const assetsDir = path.join(workspaceDir, 'public', 'images');
            await fs.promises.mkdir(assetsDir, { recursive: true });
            const targetPath = path.join(assetsDir, safeName);
            await fs.promises.writeFile(targetPath, buffer);
            filesModified.add(`public/images/${safeName}`);

            documentContextBlocks.push(
              `[IMAGEN ADJUNTA: "${name}"]\n- Guardada en el repositorio en: "public/images/${safeName}"\n- Acceso en componentes React: src="/images/${safeName}"\n- Nota: El usuario adjuntó esta imagen. Incorpórala o úsala en los componentes según su petición.`
            );
          } catch (imgErr) {
            documentContextBlocks.push(`[IMAGEN ADJUNTA: "${name}" (${imgErr.message})]`);
          }
          continue;
        }

        // Documentos: Word (.docx), Excel (.xlsx, .csv), PDF (.pdf), Texto (.md, .txt, .json, .sql)
        try {
          const extracted = await AttachmentProcessor.extractTextFull(buffer, name, mime);
          let textContent = extracted.text || '';

          // Fallback a lectura de texto plano si no se extrajo texto pero es un archivo de texto/código
          if (!textContent.trim() && (mime.startsWith('text/') || /\.(txt|md|json|js|jsx|ts|tsx|html|css|sql|csv|env|yml|yaml|xml)$/i.test(name))) {
            try {
              textContent = buffer.toString('utf8');
            } catch (_) {}
          }

          // Si el .docx contenía imágenes incrustadas, extraerlas también a public/assets/
          if (extracted.extractedAssets && extracted.extractedAssets.length > 0) {
            for (const asset of extracted.extractedAssets) {
              if (asset.buffer) {
                try {
                  const safeImg = path.basename(asset.publicPath || asset.name || 'asset.png');
                  const targetImg = path.join(workspaceDir, 'public', 'assets', safeImg);
                  await fs.promises.mkdir(path.dirname(targetImg), { recursive: true });
                  await fs.promises.writeFile(targetImg, asset.buffer);
                  filesModified.add(`public/assets/${safeImg}`);
                } catch (_) {}
              }
            }
          }

          if (textContent.trim().length > 0) {
            documentContextBlocks.push(
              `================================================================================\nCONTENIDO EXTRAÍDO DEL DOCUMENTO ADJUNTO: "${name}"\n================================================================================\n${textContent.slice(0, 45000)}\n================================================================================`
            );
            console.log(`[LovableBridge] ✅ Documento "${name}" extraído exitosamente (${textContent.length} caracteres)`);
          }
        } catch (docErr) {
          console.warn(`[LovableBridge] Error extrayendo documento ${name}:`, docErr.message);
          documentContextBlocks.push(`[DOCUMENTO ADJUNTO: "${name}" - Error de lectura: ${docErr.message}]`);
        }
      }
    }

    const finalUserPrompt = documentContextBlocks.length > 0
      ? `${prompt}\n\n[ARCHIVOS Y DOCUMENTOS ADJUNTOS POR EL USUARIO EN EL CHAT]:\n${documentContextBlocks.join('\n\n')}`
      : prompt;

    // ── 3. INVOCACIÓN CON `projectId` PARA AISLAMIENTO DEL WORKSPACE ──
    const agentResult = await runAgentWithRotation({
      system: systemPrompt,
      tools: tools,
      history: [],
      userMessage: finalUserPrompt,
      executeTool: executeTool,
      signal: null,
      projectId: safeProjectId,
      toolChoice: 'auto'
    });

    if (!agentMessage && agentResult?.text) {
      agentMessage = normalizeLovableMarkdown(agentResult.text.trim());
    }
  } catch (agentErr) {
    console.error(`[LovableBridge] Error durante el bucle de IA:`, agentErr.message);
    throw new Error(`Fallo en la inferencia del agente: ${agentErr.message}`);
  }

  // ── 4. VALIDACIÓN ESTRICTA DE CAMBIOS ANTES DE COMMIT ──
  const modifiedList = Array.from(filesModified);

  if (modifiedList.length === 0) {
    if (agentMessage) {
      console.log(`[LovableBridge] Turno informativo/consulta completado sin modificaciones de archivos para: "${prompt}"`);
      return {
        ok: true,
        summary: agentSummary || 'Diagnóstico completado',
        message: agentMessage,
        filesModified: [],
        commitSha: null
      };
    }
    console.warn(`[LovableBridge] La IA no modificó ningún archivo para el prompt: "${prompt}"`);
    return {
      ok: false,
      error: 'NO_FILES_MODIFIED',
      summary: agentSummary || 'Sin cambios en archivos',
      message: 'El modelo analizó la solicitud pero completó su turno sin aplicar modificaciones en el código. Prueba indicando específicamente el componente a modificar.',
      filesModified: [],
      commitSha: null
    };
  }

  const finalSummary = agentSummary || 'Actualización de componentes e interfaz';

  // ── PASO C: Commit y Push Atómico a GitHub ──
  // Validación de integridad pre-commit
  const finalIntegrityCheck = await validateModuleIntegrity(workspaceDir, modifiedList);
  if (finalIntegrityCheck.length > 0) {
    console.error(`[LovableBridge] ❌ Bloqueo Pre-Commit: errores de integridad detectados:`, finalIntegrityCheck);
    throw new Error(`El código introdujo errores de exportación faltantes:\n${finalIntegrityCheck.join('\n')}`);
  }
  notifyActivity(`Preparando commit y sincronizando ${modifiedList.length} archivo(s) con GitHub...`);
  console.log(`[LovableBridge] Guardando cambios y preparando git push (${modifiedList.length} archivos modificados)...`);

  let commitSha = null;

  try {
    await clearGitLocks(workspaceDir);
    await execAsync('git add .', { cwd: workspaceDir });
    
    const statusRes = await execAsync('git status --porcelain', { cwd: workspaceDir });
    if (statusRes.stdout.trim().length > 0) {
      const commitMsg = `feat(flowpro): ${finalSummary}`;
      await execAsync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, { cwd: workspaceDir });
      
      notifyActivity('Haciendo push a GitHub (rama ' + branch + ')...');
      console.log(`[LovableBridge] Haciendo push a origin/${branch}...`);
      await execAsync(`git remote set-url origin "${gitAuthUrl}"`, { cwd: workspaceDir });
      await execAsync(`git push origin "${branch}"`, { cwd: workspaceDir });
      
      const revRes = await execAsync('git rev-parse HEAD', { cwd: workspaceDir });
      commitSha = revRes.stdout.trim();
      console.log(`[LovableBridge] Push exitoso. Commit SHA: ${commitSha}`);
    } else {
      const revRes = await execAsync('git rev-parse HEAD', { cwd: workspaceDir });
      commitSha = revRes.stdout.trim();
    }
  } catch (gitPushErr) {
    console.warn(`[LovableBridge] git push vía CLI falló (${gitPushErr.message}). Intentando fallback con GitHub API...`);
    if (token) {
      try {
        notifyActivity('Sincronizando vía GitHub API (fallback)...');
        const filesMap = {};
        for (const relPath of modifiedList) {
          const content = await fs.promises.readFile(path.join(workspaceDir, relPath), 'utf8');
          filesMap[relPath] = content;
        }
        const apiRes = await commitTree(
          token,
          owner,
          repo,
          filesMap,
          `feat(flowpro): ${finalSummary}`,
          branch
        );
        commitSha = apiRes.commitSha;
        console.log(`[LovableBridge] Commit exitoso vía GitHub API. SHA: ${commitSha}`);
      } catch (apiErr) {
        console.error(`[LovableBridge] Fallback API también falló:`, apiErr.message);
        throw new Error(`Fallo al sincronizar con GitHub: ${gitPushErr.message}`);
      }
    } else {
      throw gitPushErr;
    }
  }

  notifyActivity('¡Cambios sincronizados en GitHub exitosamente!');

  return {
    ok: true,
    summary: finalSummary,
    message: agentMessage || null,
    filesModified: modifiedList,
    commitSha: commitSha || 'unknown'
  };
}
