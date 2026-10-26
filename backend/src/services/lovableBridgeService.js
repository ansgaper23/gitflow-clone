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
 * @returns {Promise<{ ok: boolean, summary: string, filesModified: string[], commitSha: string }>}
 */
export async function processLovableDispatch({ projectId, prompt, github, activeRoute }) {
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
  console.log(`[LovableBridge] Preparando repositorio ${owner}/${repo} (${branch}) en ${workspaceDir}...`);

  const gitAuthUrl = token 
    ? `https://x-access-token:${token}@github.com/${owner}/${repo}.git`
    : `https://github.com/${owner}/${repo}.git`;

  try {
    if (fs.existsSync(path.join(workspaceDir, '.git'))) {
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
  console.log(`[LovableBridge] Ejecutando bucle de inferencia para: "${prompt}"...`);

  const filesModified = new Set();
  const fileContentsBefore = new Map();
  let agentSummary = '';
  let agentMessage = '';

  const systemPrompt = `Eres FlowPro Lovable Bridge Agent, el orquestador autónomo de ingeniería de software.
Estás modificando el proyecto web alojado en el repositorio GitHub "${owner}/${repo}" vinculado a Lovable.dev.

INFORMACIÓN DEL ENTORNO DE LOVABLE:
- Tecnologías: Vite + React + TypeScript + Tailwind CSS v3 + shadcn/ui + Lucide React.
- Ruta activa en pantalla de Lovable: "${activeRoute || '/'}"
${supabaseTypes ? `- Esquema de Base de Datos Supabase (types.ts):\n\`\`\`typescript\n${supabaseTypes}\n\`\`\`\n` : ''}
${packageJsonContent ? `- package.json del proyecto:\n\`\`\`json\n${packageJsonContent}\n\`\`\`\n` : ''}

ÁRBOL DE ARCHIVOS ACTUAL DEL REPOSITORIO:
${fileTree.slice(0, 100).map(f => `- ${f}`).join('\n')}

REGLAS DE ORO:
1. Lee primero los archivos existentes que necesitas cambiar usando "read_file".
2. Aplica los cambios usando "replace_file_content" o "create_file". Devuelve código COMPLETO sin placeholders ni omitir líneas existentes.
3. Respeta el diseño existente: Tailwind CSS v3 (usa tokens semánticos o clases nativas), componentes shadcn/ui en @/components/ui, y lucide-react.
4. NO uses Tailwind v4 (@import "tailwindcss" o @theme).
5. Al terminar, llama OBLIGATORIAMENTE a "message_user" con el resumen conciso de los cambios.`;

  const tools = [
    {
      name: 'read_file',
      description: 'Lee el contenido de un archivo del repositorio para entender su estructura.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Ruta relativa del archivo (ej: src/components/Navbar.tsx)' }
        },
        required: ['filePath']
      }
    },
    {
      name: 'replace_file_content',
      description: 'Modifica o sobreescribe un archivo existente con el código nuevo completo.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Ruta relativa del archivo a modificar' },
          content: { type: 'string', description: 'Código fuente completo actualizado' },
          summary: { type: 'string', description: 'Resumen descriptivo del cambio' }
        },
        required: ['filePath', 'content']
      }
    },
    {
      name: 'create_file',
      description: 'Crea un nuevo archivo en el repositorio.',
      parameters: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'Ruta relativa del nuevo archivo (ej: src/components/ContactModal.tsx)' },
          content: { type: 'string', description: 'Código fuente del nuevo archivo' },
          summary: { type: 'string', description: 'Resumen descriptivo del nuevo archivo' }
        },
        required: ['filePath', 'content']
      }
    },
    {
      name: 'message_user',
      description: 'Cierra el turno notificando el resumen final de lo implementado.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Título o resumen de los cambios (ej: Botón y modal de contacto agregados al Navbar)' },
          message: { type: 'string', description: 'Detalle amigable de lo implementado' }
        },
        required: ['summary']
      }
    }
  ];

  const executeTool = async (toolName, toolArgs) => {
    if (toolName === 'read_file') {
      const cleanPath = (toolArgs.filePath || '').replace(/^\.?\//, '');
      const fullTarget = path.join(workspaceDir, cleanPath);
      if (!fs.existsSync(fullTarget)) {
        return `Error: El archivo "${cleanPath}" no existe en el repositorio.`;
      }
      const content = await fs.promises.readFile(fullTarget, 'utf8');
      return content.slice(0, 100000);
    }

    if (toolName === 'replace_file_content' || toolName === 'create_file') {
      const cleanPath = (toolArgs.filePath || '').replace(/^\.?\//, '');
      const fullTarget = path.join(workspaceDir, cleanPath);
      await fs.promises.mkdir(path.dirname(fullTarget), { recursive: true });
      await fs.promises.writeFile(fullTarget, toolArgs.content, 'utf8');
      filesModified.add(cleanPath);
      if (toolArgs.summary && !agentSummary) {
        agentSummary = toolArgs.summary;
      }
      return `Archivo "${cleanPath}" guardado exitosamente.`;
    }

    if (toolName === 'message_user') {
      agentSummary = toolArgs.summary || agentSummary;
      agentMessage = toolArgs.message || '';
      return 'Resumen enviado.';
    }

    return `Herramienta desconocida: ${toolName}`;
  };

  try {
    await runAgentWithRotation({
      system: systemPrompt,
      tools: tools,
      history: [],
      userMessage: prompt,
      executeTool: executeTool,
      signal: null,
      toolChoice: 'auto'
    });
  } catch (agentErr) {
    console.error(`[LovableBridge] Error durante el bucle de IA:`, agentErr.message);
    throw new Error(`Fallo en la inferencia del agente: ${agentErr.message}`);
  }

  const finalSummary = agentSummary || 'Actualización de componentes e interfaz';
  const modifiedList = Array.from(filesModified);

  // ── PASO C: Commit y Push Atómico a GitHub ──
  console.log(`[LovableBridge] Guardando cambios y preparando git push (${modifiedList.length} archivos modificados)...`);

  let commitSha = null;

  if (modifiedList.length > 0) {
    try {
      await clearGitLocks(workspaceDir);
      await execAsync('git add .', { cwd: workspaceDir });
      
      const statusRes = await execAsync('git status --porcelain', { cwd: workspaceDir });
      if (statusRes.stdout.trim().length > 0) {
        const commitMsg = `feat(flowpro): ${finalSummary}`;
        await execAsync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, { cwd: workspaceDir });
        
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
  } else {
    const revRes = await execAsync('git rev-parse HEAD', { cwd: workspaceDir }).catch(() => ({ stdout: '' }));
    commitSha = revRes.stdout ? revRes.stdout.trim() : null;
  }

  return {
    ok: true,
    summary: finalSummary,
    filesModified: modifiedList,
    commitSha: commitSha || 'unknown'
  };
}
