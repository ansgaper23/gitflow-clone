import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { runAgentWithRotation } from './aiAccounts.js';
import { commitTree } from './github.js';
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
  if (toolName === 'message_user') {
    return 'Finalizando y redactando resumen de cambios...';
  }
  return 'Procesando cambios...';
}

/**
 * Obtiene el token de GitHub configurado para clonar y pushear repositorios
 */
async function resolveGithubToken(explicitToken = null) {
  if (explicitToken && typeof explicitToken === 'string' && explicitToken.trim().length > 0) {
    return explicitToken.trim();
  }
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN.trim();
  if (process.env.GITHUB_ACCESS_TOKEN) return process.env.GITHUB_ACCESS_TOKEN.trim();

  // Buscar token de usuario autenticado en Supabase si existe
  try {
    if (supabase) {
      const { data } = await supabase
        .from('users')
        .select('github_access_token')
        .not('github_access_token', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data?.github_access_token) {
        return data.github_access_token.trim();
      }
    }
  } catch (_) {}

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
export async function processLovableDispatch({ projectId, prompt, github, activeRoute, selectedElement, onActivity }) {
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
  const token = await resolveGithubToken(github.token);

  // Asegurar directorio base de workspaces
  await fs.promises.mkdir(WORKSPACES_BASE_DIR, { recursive: true });

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

  // ── PASO B: Bucle Cognitivo del Agente de FlowPro ──
  notifyActivity('Analizando solicitud y planificando cambios...');
  console.log(`[LovableBridge] Ejecutando bucle de inferencia para: "${prompt}"...`);

  const filesModified = new Set();
  let agentSummary = '';
  let agentMessage = '';

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

INFORMACIÓN DEL ENTORNO DE LOVABLE:
- Tecnologías: Vite + React + TypeScript + Tailwind CSS v3 + shadcn/ui + Lucide React.
- Ruta activa en pantalla de Lovable: "${activeRoute || '/'}"
${selectedElementBlock}
${supabaseTypes ? `- Esquema de Base de Datos Supabase (types.ts):\n\`\`\`typescript\n${supabaseTypes}\n\`\`\`\n` : ''}
${packageJsonContent ? `- package.json del proyecto:\n\`\`\`json\n${packageJsonContent}\n\`\`\`\n` : ''}

ÁRBOL DE ARCHIVOS ACTUAL DEL REPOSITORIO:
${fileTree.slice(0, 100).map(f => `- ${f}`).join('\n')}

REGLAS DE ORO:
1. OBLIGATORIO: Tu objetivo es MODIFICAR EL CÓDIGO en disco. Usa search_files para encontrar dónde está el texto o elemento solicitado, lee el archivo con read_file, y aplica los cambios con propose_change o replace_file_content. NO respondas solo con texto explicativo sin modificar archivos.
2. Aplica los cambios usando "propose_change", "replace_file_content" o "create_file". Devuelve código COMPLETO sin placeholders ni omitir líneas existentes.
3. Respeta el diseño existente: Tailwind CSS v3 (usa tokens semánticos o clases nativas), componentes shadcn/ui en @/components/ui, y lucide-react.
4. NO uses Tailwind v4 (@import "tailwindcss" o @theme).
5. Al terminar, llama OBLIGATORIAMENTE a "message_user" con:
   - summary: Un título semántico muy corto (3 a 6 palabras) del cambio realizado (ej: "Eliminación del camino al mundial").
   - message: Una explicación conversacional limpia, natural y concisa (1 o 2 párrafos) de las modificaciones implementadas.`;

  // ── 1. DEFINICIÓN DE HERRAMIENTAS UNIVERSAL (Antigravity, Anthropic, Gemini, OpenAI) ──
  const makeTool = (name, description, schema) => ({
    name,
    description,
    input_schema: schema,
    parameters: schema
  });

  const tools = [
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
      'message_user',
      'Notifica el resumen final de lo implementado.',
      {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Título o resumen de los cambios (3 a 6 palabras)' },
          message: { type: 'string', description: 'Detalle conversacional y limpio de los cambios' }
        },
        required: ['summary']
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
      return matches.length > 0
        ? `Coincidencias encontradas en:\n${matches.join('\n')}`
        : `No se encontró ninguna coincidencia para "${toolArgs.query}".`;
    }

    // C. read_file: lectura de archivo
    if (toolName === 'read_file') {
      const targetPath = toolArgs.path || toolArgs.filePath || '';
      const cleanPath = targetPath.replace(/^\.?\//, '');
      if (!cleanPath) return 'Error: Falta especificar la ruta del archivo.';
      const fullTarget = path.join(workspaceDir, cleanPath);
      if (!fs.existsSync(fullTarget)) {
        return `Error: El archivo "${cleanPath}" no existe en el repositorio.`;
      }
      const content = await fs.promises.readFile(fullTarget, 'utf8');
      return content.slice(0, 100000);
    }

    // D. propose_change / replace_file_content / create_file: escritura en disco
    if (toolName === 'propose_change' || toolName === 'replace_file_content' || toolName === 'create_file') {
      const targetPath = toolArgs.path || toolArgs.filePath || '';
      const cleanPath = targetPath.replace(/^\.?\//, '');
      if (!cleanPath) return 'Error: Falta especificar la ruta del archivo.';

      const fileContent = toolArgs.new_content ?? toolArgs.content ?? toolArgs.code ?? toolArgs.new_str ?? '';
      const fullTarget = path.join(workspaceDir, cleanPath);
      await fs.promises.mkdir(path.dirname(fullTarget), { recursive: true });
      await fs.promises.writeFile(fullTarget, fileContent, 'utf8');
      filesModified.add(cleanPath);
      if (toolArgs.summary) agentSummary = toolArgs.summary;
      console.log(`[LovableBridge] ✅ Archivo modificado: ${cleanPath} (${fileContent.length} caracteres)`);
      return `Archivo "${cleanPath}" guardado exitosamente.`;
    }

    // E. update_memory: noop para compatibilidad con Antigravity
    if (toolName === 'update_memory') {
      return 'Memoria registrada.';
    }

    // F. message_user: cierre de turno
    if (toolName === 'message_user') {
      agentSummary = toolArgs.summary || agentSummary;
      agentMessage = toolArgs.message || '';
      return 'Resumen enviado.';
    }

    return `Herramienta desconocida: ${toolName}`;
  };

  try {
    // ── 3. INVOCACIÓN CON `projectId` PARA AISLAMIENTO DEL WORKSPACE ──
    await runAgentWithRotation({
      system: systemPrompt,
      tools: tools,
      history: [],
      userMessage: prompt,
      executeTool: executeTool,
      signal: null,
      projectId: safeProjectId,
      toolChoice: 'auto'
    });
  } catch (agentErr) {
    console.error(`[LovableBridge] Error durante el bucle de IA:`, agentErr.message);
    throw new Error(`Fallo en la inferencia del agente: ${agentErr.message}`);
  }

  // ── 4. VALIDACIÓN ESTRICTA DE CAMBIOS ANTES DE COMMIT ──
  const modifiedList = Array.from(filesModified);

  if (modifiedList.length === 0) {
    console.warn(`[LovableBridge] La IA no modificó ningún archivo para el prompt: "${prompt}"`);
    return {
      ok: false,
      error: 'NO_FILES_MODIFIED',
      summary: agentSummary || 'No se modificaron archivos',
      message: agentMessage || 'El modelo analizó la solicitud pero no aplicó cambios con "propose_change" o "replace_file_content". Por favor sé más específico con el componente o archivo a editar.',
      filesModified: [],
      commitSha: null
    };
  }

  const finalSummary = agentSummary || 'Actualización de componentes e interfaz';

  // ── PASO C: Commit y Push Atómico a GitHub ──
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
