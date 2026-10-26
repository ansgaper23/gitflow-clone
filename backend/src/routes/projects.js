import express, { Router } from 'express'
import path from 'path'
import os from 'os'
import multer from 'multer'

import AdmZip from 'adm-zip';


import {
  getCloudOverview,
  getTables,
  getTableRowsData,
  insertTableRow,
  updateTableRow,
  deleteTableRow,
  executeProjectSql,
  getUsers,
  deleteUser,
  getStorageBuckets,
  getStorageFiles,
  createStorageBucket,
  deleteStorageFile
} from '../controllers/cloudController.js';
import fsPromises from 'node:fs/promises';
import fs from 'node:fs';
import { runtimeBus } from '../services/runtimeBus.js';
import { executeQuickEdit } from '../services/quickEditService.js';
import { commitCheckpoint, restoreLocalGitCheckpoint, findProjectWorkspace } from '../services/gitCheckpoint.js';
import { invalidateSemanticGraph } from '../services/semanticGraph.js';
import { invalidateDbSchemaGraph } from '../services/dbSchemaGraph.js';

/**
 * Validador estricto de rutas de archivos para prevenir ataques de Path Traversal.
 * Rechaza rutas con '..', rutas absolutas, caracteres nulos y accesos a .git, node_modules o .env
 * @param {string} relPath
 * @returns {string}
 */
export function sanitizeProjectPath(relPath) {
  if (!relPath || typeof relPath !== 'string' || !relPath.trim()) {
    throw new Error('Ruta de archivo inválida o vacía');
  }
  const normalized = relPath.replace(/\\/g, '/').trim();
  
  // Rechazar intentos de path traversal y rutas absolutas
  if (normalized.includes('..') || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error('Ruta no permitida: Path Traversal detectado');
  }
  if (normalized.includes('\0')) {
    throw new Error('Carácter nulo detectado');
  }
  // Rechazar rutas sensibles o carpetas de control (.git, node_modules, .env*)
  const segments = normalized.split('/');
  if (segments.some(seg => {
    const s = seg.toLowerCase();
    return s === '.git' || s === 'node_modules' || s === '.env' || s.startsWith('.env.');
  })) {
    throw new Error(`Acceso denegado a ruta restringida: ${normalized}`);
  }
  return normalized;
}


function analyzeZipContent(zipFilePath) {
  try {
    const zip = new AdmZip(zipFilePath);
    const entries = zip.getEntries();
    
    let hasDatabaseFiles = false;
    let sqlFiles = [];
    let fileTypes = { images: 0, code: 0, others: 0 };

    for (const entry of entries) {
      if (entry.isDirectory || entry.entryName.startsWith('__MACOSX/')) continue;
      
      const ext = path.extname(entry.entryName).toLowerCase();
      const baseName = path.basename(entry.entryName).toLowerCase();

      // Detecci?n de base de datos
      if (['.sql', '.dump', '.backup'].includes(ext) || baseName.includes('flow_migrador')) {
        hasDatabaseFiles = true;
        sqlFiles.push(entry.entryName);
      } else if (['.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif'].includes(ext)) {
        fileTypes.images++;
      } else if (['.js', '.jsx', '.ts', '.tsx', '.json', '.css', '.html'].includes(ext)) {
        fileTypes.code++;
      } else {
        fileTypes.others++;
      }
    }

    return {
      isDatabaseBackup: hasDatabaseFiles,
      sqlFiles,
      fileCount: entries.length,
      fileTypes
    };
  } catch (err) {
    console.error('[Upload Classifier] Error al analizar ZIP:', err);
    return { isDatabaseBackup: false, isCorrupt: true };
  }
}




import { importDatabaseZip } from '../services/dbMigrator.js';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { from as copyFrom } from 'pg-copy-streams';
import { pipeline } from 'node:stream/promises';
import { createReadStream } from 'node:fs';

import pg from 'pg';
import { restartPreviewForAgent } from '../services/previewOrchestrator.js';
const { Client } = pg;
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cloudRoutes from './cloud.routes.js';
import analyticsRoutes from './analytics.routes.js';
import seoRoutes from './seo.routes.js';
import settingsRoutes from './settings.routes.js';
const uploadDbZip = multer({ dest: tmpdir() });

import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { requireAuth, requireGithub, hasAccess, hasActivePlan } from '../middleware/auth.js'
import { supabase } from '../db/supabaseClient.js'
import { createRepo, deleteRepo, sendGithubAwareError } from '../services/github.js'
import { buildScaffoldFiles } from '../services/scaffold.js'
import { generateDesignDirections } from '../services/geminiAssist.js'
import { activeTurns } from '../services/conversationTurn.js'
import {
  writeProjectFiles,
  readAllProjectFiles,
  restoreProjectFiles,
  listProjectFiles,
  readProjectFile,
  writeProjectFile,
} from '../services/projectStorage.js'
import {
  slugify,
  generateHumanProjectName,
  createVirtualProject,
  ensureGithubProject,
  listOwnedProjects,
  getOwnedProject,
  isVirtualRepo,
} from '../services/projectResolver.js'
import {
  generateProjectName,
  buildCleanFallbackName,
  ensureUniqueSlug,
  isGenericOrLiteralName,
} from '../services/projectNaming.js'
import { createCheckpoint, listCheckpoints, resolveCheckpointFileState } from '../services/checkpoints.js'
import { discoverRoutes } from '../services/routeDiscovery.js'
import { isPreviewConfigured, isVpsPgConfigured, config } from '../config.js'
import { createVpsConnection, dropVpsDatabase } from '../services/vpsPostgres.js'
import { dropAllStorage } from '../services/flowStorage.js'
import { refreshPreview, getPreviewStatus, stopPreview } from '../services/previewOrchestrator.js'
import { listProjectSecrets, upsertProjectSecret, deleteProjectSecret } from '../services/projectSecrets.js'
import {
  listProjectSkills,
  addProjectSkill,
  toggleProjectSkill,
  deleteProjectSkill,
  extractSkillFromUpload,
} from '../services/projectSkills.js'
import { listProjectServerSecrets, upsertProjectServerSecret, deleteProjectServerSecret } from '../services/projectServerSecrets.js'
import { setServerSecrets, deleteServerSecret, functionInvokeUrl } from '../services/edgeFunctions.js'
import { resolveDbConnection } from '../services/dbConnectionResolver.js'
import { publishProject, unpublishProject } from '../services/projectPublish.js'
import {
  isValidDomain,
  createDomainZone,
  deleteDomainZone,
  checkDelegation,
  syncCustomDomainsNginxMap,
  NAMESERVERS,
} from '../services/dnsProvider.js'
import { issueCertificateForDomain, removeDomainNginxSite, certExists } from '../services/certManager.js'
import { isDnsConfigured } from '../config.js'
import { executeRemoteSupabaseMigration } from '../services/supabaseMigrator.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
// getFileContent (GitHub) decodifica todo como texto UTF-8 — un binario real (imagen, fuente)
// saldría corrupto si se copiara así. El remix por ahora solo duplica archivos de texto/código;
// las imágenes hay que volver a subirlas a mano en la copia.
const REMIX_BINARY_EXT_RE = /\.(png|jpe?g|gif|webp|ico|bmp|pdf|zip|woff2?|ttf|eot|mp4|mp3|wav)$/i
// backend/src/routes -> backend/public/project-assets (mismo patrón que THUMBNAILS_DIR)
export const PROJECT_ASSETS_DIR = join(__dirname, '..', '..', 'public', 'project-assets')

const assetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB, de sobra para un logo/imagen social
})
const ALLOWED_IMAGE_TYPES = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/x-icon': '.ico', 'image/svg+xml': '.svg' }

export const projectsRouter = Router()

// Endpoint universal de subida de archivos para el proyecto
projectsRouter.post('/:projectId/upload-file', requireAuth, uploadDbZip.single('file'), async (req, res) => {
  try {
    const { projectId } = req.params;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No se recibi? ning?n archivo.' });
    }

    const isZip = file.originalname.toLowerCase().endsWith('.zip');

    if (isZip) {
      const analysis = analyzeZipContent(file.path);

      if (analysis.isDatabaseBackup) {
        // Es un respaldo de base de datos leg?timo
        const tempZipId = path.basename(file.path);
        return res.json({
          success: true,
          type: 'DATABASE_BACKUP',
          message: 'Se detect? un respaldo de base de datos en el ZIP.',
          tempZipId: tempZipId,
          zipExtractPath: file.path,
          sqlFiles: analysis.sqlFiles
        });
      }

      // ZIP de Assets/C?digo
      const projectAssetsDir = path.resolve(process.env.PROJECTS_ROOT || '/var/opt/gitflow-app/projects', projectId, 'src/assets/imported');
      await fsPromises.mkdir(projectAssetsDir, { recursive: true }).catch(()=>true);

      const zip = new AdmZip(file.path);
      zip.getEntries().forEach(entry => {
        if (!entry.isDirectory && !entry.entryName.startsWith('__MACOSX/')) {
          const targetPath = path.join(projectAssetsDir, path.basename(entry.entryName));
          zip.extractEntryTo(entry, path.dirname(targetPath), false, true);
        }
      });

      await fsPromises.unlink(file.path).catch(() => {});

      return res.json({
        success: true,
        type: 'PROJECT_ASSETS_ZIP',
        message: `Se descomprimieron los recursos del archivo ${file.originalname} en tu proyecto.`,
        fileCount: analysis.fileCount
      });
    }

    // Archivo normal (no ZIP)
    const projectPublicDir = path.resolve(process.env.PROJECTS_ROOT || '/var/opt/gitflow-app/projects', projectId, 'public/uploads');
    await fsPromises.mkdir(projectPublicDir, { recursive: true }).catch(()=>true);
    
    const destinationPath = path.join(projectPublicDir, file.originalname);
    await fsPromises.rename(file.path, destinationPath).catch(()=>true);

    return res.json({
      success: true,
      type: 'SINGLE_FILE',
      message: `Archivo ${file.originalname} guardado correctamente.`,
      url: `/uploads/${file.originalname}`
    });

  } catch (error) {
    console.error('[Upload Handler] Error procesando archivo:', error);
    res.status(500).json({ error: 'Error al procesar el archivo subido.' });
  }
});



function serializeProject(p) {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    storageType: p.storage_type,
    repoFullName: p.repo_full_name,
    thumbnailUrl: p.thumbnail_url || null,
    logoUrl: p.logo_url || null,
    socialImageUrl: p.social_image_url || null,
    publishedAt: p.published_at || null,
    customDomain: p.custom_domain || null,
    customDomainVerifiedAt: p.custom_domain_verified_at || null,
    knowledge: p.knowledge || '',
    aiMemory: p.ai_memory || '',
    createdAt: p.created_at,
  }
}

// Proyectos propios en FlowPro: incluye virtuales y los de GitHub que ya se abrieron alguna
// vez (para volver a un proyecto virtual hace falta esto — no aparece en ninguna lista de GitHub).
projectsRouter.get('/', requireAuth, async (req, res) => {
  try {
    const projects = await listOwnedProjects(req.user.id)
    res.json(projects.map(serializeProject))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

function previewHost() {
  try {
    return new URL(config.frontendUrl).hostname
  } catch {
    return 'flow-pro.online'
  }
}

// Chequeo liviano de disponibilidad mientras el usuario escribe (antes de guardar) — no
// reserva nada, solo informa. La validación real (y lo que de verdad previene un choque)
// vuelve a pasar en el PATCH de /:id/slug, contra el mismo índice único de la base. Va ANTES
// de la ruta "/:id" de abajo a propósito: si no, Express matchea "slug-available" como si
// fuera un :id y esta ruta nunca se alcanza.
projectsRouter.get('/slug-available', requireAuth, async (req, res) => {
  const raw = String(req.query.slug || '')
  const slug = slugify(raw)
  if (!slug || slug === 'proyecto') return res.json({ slug, available: false, reason: 'Elegí un subdominio válido' })
  const { data, error } = await supabase.from('projects').select('id').eq('slug', slug).maybeSingle()
  if (error) return res.status(500).json({ error: error.message })
  const takenByOther = data && data.id !== req.query.projectId
  res.json({ slug, available: !takenByOther, host: previewHost() })
})

projectsRouter.get('/:id', requireAuth, async (req, res) => {
  const { data: project, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .maybeSingle()
  if (error) return res.status(500).json({ error: error.message })
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })
  res.json(serializeProject(project))
})

// Borra el proyecto de FlowPro (dashboard, chat, historial, cambios propuestos, checkpoints,
// secrets, skills — todo lo que cuelga de "projects" por foreign key con "on delete cascade").
// Antes de eso, limpia a mano lo que NO tiene esa cascada porque vive fuera de esa relación:
// dominio propio (DNS + certificado + sitio de nginx), build publicado en disco, el cupo de
// preview si estaba corriendo, y la conexión de base de datos (que si es la automática de Flow
// Cloud, borra la base y el storage de verdad, igual que "Desconectar" — ver dbConnections.js).
// A propósito NO borra el repositorio de GitHub: sigue siendo tuyo, FlowPro solo deja de
// llevar cuenta de él.

projectsRouter.patch('/:id', requireAuth, async (req, res) => {
  const { name } = req.body
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Nombre de proyecto inválido' })
  }
  const project = await getOwnedProject(req.user.id, req.params.id)
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })

  const { data, error } = await supabase
    .from('projects')
    .update({ name: name.trim() })
    .eq('id', project.id)
    .select('*')
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(serializeProject(data))
})
projectsRouter.delete('/:id', requireAuth, async (req, res) => {
  const project = await getOwnedProject(req.user.id, req.params.id)
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })

  if (isPreviewConfigured) {
    await stopPreview(`user:${req.user.id}`, project.repo_full_name).catch(() => {})
  }

  if (project.custom_domain) {
    await deleteDomainZone(project.custom_domain).catch((err) => console.error('No se pudo borrar la zona DNS al eliminar el proyecto:', err.message))
    removeDomainNginxSite(project.slug)
  }

  if (project.published_at) {
    await unpublishProject(project).catch((err) => console.error('No se pudo borrar el build publicado al eliminar el proyecto:', err.message))
  }

  const { data: conn } = await supabase
    .from('repo_db_connections')
    .select('id, connection_type, vps_database_name')
    .eq('user_id', req.user.id)
    .eq('repo_full_name', project.repo_full_name)
    .maybeSingle()
  if (conn) {
    await supabase.from('repo_db_connections').delete().eq('id', conn.id)
    if (conn.connection_type === 'vps' && conn.vps_database_name) {
      dropVpsDatabase(conn.vps_database_name).catch((err) => console.error(`No se pudo borrar la base VPS "${conn.vps_database_name}":`, err.message))
      dropAllStorage(conn.vps_database_name).catch((err) => console.error(`No se pudo borrar el storage de "${conn.vps_database_name}":`, err.message))
    }
  }

  const { error } = await supabase.from('projects').delete().eq('id', project.id).eq('user_id', req.user.id)
  if (error) return res.status(500).json({ error: error.message })

  if (project.storage_type === 'github') {
    try {
      const [owner, repoName] = project.repo_full_name.split('/')
      await deleteRepo(req.user.github_access_token, owner, repoName)
    } catch (err) {
      console.error(`Failed to delete GitHub repository ${project.repo_full_name}:`, err.message)
    }
  }

  res.status(204).end()
})

// Abre (o registra por primera vez) un repo de GitHub existente como proyecto de FlowPro,
// para poder navegarlo por /chat/:projectId igual que uno virtual.
projectsRouter.post('/open', requireAuth, requireGithub, async (req, res) => {
  const { repoFullName } = req.body
  if (!repoFullName) return res.status(400).json({ error: 'Falta repoFullName' })
  try {
    const project = await ensureGithubProject(req.user.id, repoFullName)
    res.json(serializeProject(project))
  } catch (err) {
    sendGithubAwareError(res, err, err.message)
  }
})

// Selector de dirección de diseño (estilo Lovable): antes de crear el proyecto de verdad, la
// IA propone 2-3 mockups visuales autocontenidos (sin build, sin npm, un solo HTML) para la
// misma idea. No crea nada todavía — el usuario elige uno (o lo omite) desde el dashboard y
// recién ahí se llama a "/create" con esa dirección ya inyectada en el prompt inicial.
projectsRouter.post('/design-directions', requireAuth, async (req, res) => {
  const { prompt } = req.body
  if (!prompt?.trim()) return res.status(400).json({ error: 'Falta describir qué quieres construir' })
  if (!hasAccess(req.user)) {
    return res.status(402).json({ error: 'Tu demo gratis o tu plan terminaron. Elige un plan para crear proyectos.' })
  }
  try {
    const directions = await generateDesignDirections(prompt.trim())
    if (!directions) return res.status(502).json({ error: 'No se pudieron generar propuestas de diseño, intentá de nuevo' })
    res.json({ directions })
  } catch (err) {
    res.status(502).json({ error: 'No se pudieron generar propuestas de diseño', detail: err.message })
  }
})

// Con GitHub conectado: repo real + scaffold commiteado, como siempre.
// Sin GitHub (login por Google/email): proyecto virtual, vive en FlowPro (project_files),
// se puede usar y ver el preview igual, y migrar a GitHub más adelante cuando quiera.
projectsRouter.post('/create', requireAuth, async (req, res) => {
  const { prompt, projectName } = req.body
  if (!prompt?.trim()) return res.status(400).json({ error: 'Falta describir qué quieres construir' })
  if (!hasAccess(req.user)) {
    return res.status(402).json({ error: 'Tu demo gratis o tu plan terminaron. Elige un plan para crear proyectos.' })
  }

  const hasExplicitName = Boolean(projectName && projectName.trim())
  const initialNaming = hasExplicitName ? { name: projectName.trim(), slug: slugify(projectName) } : buildCleanFallbackName(prompt)
  const humanName = initialNaming.name
  const baseName = initialNaming.slug
  const hasGithub = Boolean(req.user.github_access_token)

  let project
  try {
    if (hasGithub) {
      let repo
      try {
        repo = await createRepo(req.user.github_access_token, baseName, {
          private: true,
          description: prompt.slice(0, 200),
        })
      } catch (err) {
        return sendGithubAwareError(res, err, 'No se pudo crear el repositorio en GitHub', 502)
      }
      project = await ensureGithubProject(req.user.id, repo.fullName, { branch: repo.defaultBranch })
      // Guardar también el nombre legible en projects
      await supabase.from('projects').update({ name: humanName }).eq('id', project.id)
      project.name = humanName
    } else {
      project = await createVirtualProject(req.user.id, humanName)
    }
  } catch (err) {
    return res.status(502).json({ error: 'No se pudo crear el proyecto', detail: err.message })
  }

  // Base de datos: por defecto, sin preguntar, se aprovisiona nuestra propia base en la VPS —
  // elegir Supabase (u otra) ya no es parte de este paso, eso ahora vive en "Integraciones"
  // dentro del editor. Va ANTES del scaffold porque el scaffold necesita saber qué cliente de
  // datos incluir (src/lib/db.js vs. nada) — ver scaffold.js.
  let dbInfo = null
  let dbKind = 'none'
  if (isVpsPgConfigured) {
    try {
      const conn = await createVpsConnection(req.user.id, project.repo_full_name, 'Base de datos automática')
      dbInfo = { type: 'vps', databaseName: conn.vps_database_name }
      dbKind = 'vps'
    } catch (err) {
      dbInfo = { error: err.message }
    }
  }

  const scaffoldFiles = buildScaffoldFiles({ projectName: project.name, dbKind })
  try {
    if (hasGithub) {
      const { commitSha } = await writeProjectFiles(
        project,
        req.user.github_access_token,
        scaffoldFiles,
        'FlowPro: scaffold inicial del proyecto',
      )
      await createCheckpoint(project, null, { changeType: 'code', summary: 'Scaffold inicial', commitSha })
    } else {
      await writeProjectFiles(project, null, scaffoldFiles, 'Scaffold inicial')
      await createCheckpoint(project, null, { changeType: 'code', summary: 'Scaffold inicial' })
    }
  } catch (err) {
    return res.status(502).json({
      error: hasGithub ? 'El repo se creó pero falló el scaffold inicial' : 'No se pudo preparar el proyecto',
      detail: err.message,
      repoFullName: project.repo_full_name,
    })
  }

  // Si el usuario no especificó un nombre explícito, generar nombre semántico estilo Lovable en segundo plano
  if (!hasExplicitName) {
    (async () => {
      try {
        const urls = prompt.match(/https?:\/\/[^\s"'<>]+/gi) || []
        const generated = await generateProjectName(prompt, { urls })
        if (generated && generated.name) {
          const { data: current } = await supabase.from('projects').select('name').eq('id', project.id).single()
          if (current && (current.name === humanName || isGenericOrLiteralName(current.name, prompt))) {
            const uniqueSlug = await ensureUniqueSlug(generated.slug, project.id, supabase)
            await supabase.from('projects').update({ name: generated.name, slug: uniqueSlug }).eq('id', project.id)
            console.log(`[projectNaming] Proyecto ${project.id} renombrado semánticamente a "${generated.name}" (${uniqueSlug})`)
          }
        }
      } catch (err) {
        console.warn('[projectNaming] Error asíncrono en /create:', err.message)
      }
    })()
  }

  const { data: convo, error: convoErr } = await supabase
    .from('conversations')
    .insert({ user_id: req.user.id, project_id: project.id, repo_full_name: project.repo_full_name, title: prompt.slice(0, 80) })
    .select('*')
    .single()
  if (convoErr) {
    return res.status(502).json({
      error: 'El proyecto se creó pero falló al preparar la conversación',
      detail: convoErr.message,
      projectId: project.id,
    })
  }

  res.status(201).json({
    projectId: project.id,
    storageType: project.storage_type,
    repoFullName: project.storage_type === 'github' ? project.repo_full_name : null,
    name: project.name,
    conversationId: convo.id,
    prompt,
    database: dbInfo,
  })
})

// Tablas que guardan un `repo_full_name` propio (aparte de projects.repo_full_name) y que por
// lo tanto hay que reescribir cuando un proyecto virtual pasa a tener un repo_full_name real.
const CHILD_TABLES_GLOBAL_REPO = ['proposed_changes', 'proposed_db_changes', 'proposed_asset_changes']
const CHILD_TABLES_USER_SCOPED_REPO = ['conversations', 'repo_db_connections']

// Crea un repo real en GitHub, sube el contenido actual del proyecto virtual como un solo
// commit, y reasigna el proyecto (y todo lo que lo referencia) al nuevo repo_full_name.
// El registro virtual en project_files se deja intacto como respaldo, ya no se usa una vez
// que storage_type pasa a 'github'.
// "Remix" estilo Lovable: copia el estado actual de un proyecto (propio) a uno nuevo, virtual
// (sin GitHub) para arrancar rápido — el original queda intacto. Storage-agnóstico del lado
// de la lectura (listProjectFiles/readProjectFile ya abstraen GitHub vs. virtual), pero el
// destino siempre es virtual por simplicidad; si querés que la copia tenga su propio repo,
// usá "Migrar a GitHub" sobre ella después, como con cualquier proyecto virtual.
projectsRouter.post('/:id/remix', requireAuth, async (req, res) => {
  const source = await getOwnedProject(req.user.id, req.params.id)
  if (!source) return res.status(404).json({ error: 'Proyecto no encontrado' })
  if (!isVirtualRepo(source.repo_full_name) && !req.user.github_access_token) {
    return res.status(403).json({ error: 'Conecta tu cuenta de GitHub para continuar', code: 'github_not_connected' })
  }

  try {
    const entries = await listProjectFiles(source, req.user.github_access_token)
    const files = {}
    for (const entry of entries) {
      if (REMIX_BINARY_EXT_RE.test(entry.path)) continue
      try {
        let content = await readProjectFile(source, req.user.github_access_token, entry.path)
        if (typeof content === 'string') content = content.replace(/\0/g, '')
        files[entry.path] = content
      } catch {
        // un archivo puntual que no se pudo leer no debería tumbar todo el remix
      }
    }

    const newProject = await createVirtualProject(req.user.id, `${source.name}-copia`)
    await writeProjectFiles(newProject, null, files, 'Remix inicial')
    await createCheckpoint(newProject, null, { changeType: 'code', summary: `Remix de "${source.name}"` })

    res.status(201).json(serializeProject(newProject))
  } catch (err) {
    res.status(502).json({ error: 'No se pudo duplicar el proyecto', detail: err.message })
  }
})

projectsRouter.post('/:id/migrate-to-github', requireAuth, requireGithub, async (req, res) => {
  const { data: project, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .maybeSingle()
  if (error) return res.status(500).json({ error: error.message })
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })
  if (project.storage_type !== 'virtual') {
    return res.status(409).json({ error: 'Este proyecto ya está en GitHub' })
  }

  const oldRepoFullName = project.repo_full_name
  const baseName = slugify(req.body?.repoName || project.name)

  let repo
  try {
    repo = await createRepo(req.user.github_access_token, baseName, {
      private: true,
      description: `Migrado desde FlowPro: ${project.name}`,
    })
  } catch (err) {
    return sendGithubAwareError(res, err, 'No se pudo crear el repositorio en GitHub', 502)
  }

  let files
  try {
    files = await readAllProjectFiles(project)
  } catch (err) {
    return res.status(500).json({
      error: 'El repositorio se creó pero no se pudo leer el proyecto virtual',
      detail: err.message,
      repoFullName: repo.fullName,
    })
  }
  const filesMap = {}
  for (const f of files) filesMap[f.path] = { content: f.content, isBase64: f.is_base64 }

  let migrationCommitSha
  try {
    const result = await writeProjectFiles(
      { repo_full_name: repo.fullName, branch: repo.defaultBranch },
      req.user.github_access_token,
      filesMap,
      'FlowPro: migración desde proyecto virtual',
    )
    migrationCommitSha = result.commitSha
  } catch (err) {
    return res.status(502).json({
      error: 'El repositorio se creó pero falló subir los archivos',
      detail: err.message,
      repoFullName: repo.fullName,
    })
  }

  try {
    const { error: updateProjErr } = await supabase
      .from('projects')
      .update({ storage_type: 'github', repo_full_name: repo.fullName, branch: repo.defaultBranch })
      .eq('id', project.id)
    if (updateProjErr) throw updateProjErr

    // repo_full_name virtual es un `virtual/<uuid>` único globalmente, así que no hace falta
    // filtrar estas dos por user_id para que sea seguro.
    for (const table of CHILD_TABLES_GLOBAL_REPO) {
      const { error: childErr } = await supabase.from(table).update({ repo_full_name: repo.fullName }).eq('repo_full_name', oldRepoFullName)
      if (childErr) throw childErr
    }
    for (const table of CHILD_TABLES_USER_SCOPED_REPO) {
      const { error: childErr } = await supabase
        .from(table)
        .update({ repo_full_name: repo.fullName })
        .eq('repo_full_name', oldRepoFullName)
        .eq('user_id', req.user.id)
      if (childErr) throw childErr
    }
  } catch (err) {
    return res.status(500).json({
      error: 'El código se subió a GitHub pero falló actualizar el proyecto en FlowPro',
      detail: err.message,
      repoFullName: repo.fullName,
    })
  }

  await createCheckpoint(
    { id: project.id, repo_full_name: repo.fullName },
    null,
    { changeType: 'code', summary: 'Migrado a GitHub', commitSha: migrationCommitSha },
  )

  res.json({ projectId: project.id, storageType: 'github', repoFullName: repo.fullName })
})

// Páginas/rutas detectadas en el código del proyecto, para el selector de páginas del panel
// de Vista previa (estilo Lovable) — incluye páginas que no están linkeadas en ningún lado.
projectsRouter.get('/:id/pages', requireAuth, async (req, res) => {
  const project = await getOwnedProject(req.user.id, req.params.id)
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })
  if (!isVirtualRepo(project.repo_full_name) && !req.user.github_access_token) {
    return res.status(403).json({ error: 'Conecta tu cuenta de GitHub para continuar', code: 'github_not_connected' })
  }
  try {
    const paths = await discoverRoutes(project, req.user.github_access_token)
    res.json({ paths })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Vista de código (estilo Lovable): a diferencia del chat, esto lee/escribe el archivo
// DIRECTO, sin pasar por "proponer cambio" — quien edita acá es el usuario mismo, ya revisó lo
// que escribió con sus propios ojos, así que no hace falta el paso de aprobación que sí
// necesitan los cambios que propone la IA.
projectsRouter.get('/:id/files', requireAuth, async (req, res) => {
  const project = await getOwnedProject(req.user.id, req.params.id)
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })
  if (!isVirtualRepo(project.repo_full_name) && !req.user.github_access_token) {
    return res.status(403).json({ error: 'Conecta tu cuenta de GitHub para continuar', code: 'github_not_connected' })
  }
  try {
    const files = await listProjectFiles(project, req.user.github_access_token)
    res.json({ paths: files.map((f) => f.path).sort() })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

projectsRouter.get('/:id/file', requireAuth, async (req, res) => {
  const project = await getOwnedProject(req.user.id, req.params.id)
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })
  let sanitizedPath
  try {
    sanitizedPath = sanitizeProjectPath(req.query.path)
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
  if (!isVirtualRepo(project.repo_full_name) && !req.user.github_access_token) {
    return res.status(403).json({ error: 'Conecta tu cuenta de GitHub para continuar', code: 'github_not_connected' })
  }
  try {
    const content = await readProjectFile(project, req.user.github_access_token, sanitizedPath)
    res.json({ path: sanitizedPath, content })
  } catch (err) {
    res.status(404).json({ error: `No se pudo leer ${sanitizedPath}`, detail: err.message })
  }
})

projectsRouter.put('/:id/file', requireAuth, async (req, res) => {
  const project = await getOwnedProject(req.user.id, req.params.id)
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })
  let sanitizedPath
  try {
    sanitizedPath = sanitizeProjectPath(req.body.path)
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
  const { content } = req.body
  if (content === undefined) return res.status(400).json({ error: 'Falta content' })
  if (!isVirtualRepo(project.repo_full_name) && !req.user.github_access_token) {
    return res.status(403).json({ error: 'Conecta tu cuenta de GitHub para continuar', code: 'github_not_connected' })
  }
  try {
    const { commitUrl, commitSha } = await writeProjectFile(project, req.user.github_access_token, {
      path: sanitizedPath,
      newContent: content,
      summary: `Editado manualmente: ${sanitizedPath}`,
    })
    await createCheckpoint(project, null, { changeType: 'code', summary: `Editado manualmente: ${sanitizedPath}`, commitSha })
    if (isPreviewConfigured) refreshPreview(`user:${req.user.id}`, project).catch(() => {})

    // Sincronización tripartita con Git local en workspace de preview
    for (let i = 0; i < 5; i++) {
      const ws = `/opt/gitflow-previews/workspace-${i}`
      if (fs.existsSync(ws)) {
        await commitCheckpoint(ws, `manual_${Date.now()}`, `Manual edit: ${sanitizedPath}`).catch(() => null)
      }
    }

    // Invalidar grafos semánticos para el Agente IA
    invalidateSemanticGraph(project.id)
    if (sanitizedPath.endsWith('.sql')) invalidateDbSchemaGraph(project.id)

    res.json({ path: sanitizedPath, commitUrl, ok: true })
  } catch (err) {
    res.status(502).json({ error: `No se pudo guardar ${sanitizedPath}`, detail: err.message })
  }
})

projectsRouter.post('/:id/file', requireAuth, async (req, res) => {
  const project = await getOwnedProject(req.user.id, req.params.id)
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })
  let sanitizedPath
  try {
    sanitizedPath = sanitizeProjectPath(req.body.path)
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
  const content = req.body.content || ''
  if (!isVirtualRepo(project.repo_full_name) && !req.user.github_access_token) {
    return res.status(403).json({ error: 'Conecta tu cuenta de GitHub para continuar', code: 'github_not_connected' })
  }
  try {
    if (isVirtualRepo(project.repo_full_name)) {
      const { data: existing } = await supabase
        .from('project_files')
        .select('path')
        .eq('project_id', project.id)
        .eq('path', sanitizedPath)
        .maybeSingle()
      if (existing) {
        return res.status(409).json({ error: `El archivo "${sanitizedPath}" ya existe` })
      }
    }

    const { commitUrl, commitSha } = await writeProjectFile(project, req.user.github_access_token, {
      path: sanitizedPath,
      newContent: content,
      summary: `Creado manualmente: ${sanitizedPath}`,
    })
    await createCheckpoint(project, null, { changeType: 'code', summary: `Creado manualmente: ${sanitizedPath}`, commitSha })
    if (isPreviewConfigured) refreshPreview(`user:${req.user.id}`, project).catch(() => {})

    for (let i = 0; i < 5; i++) {
      const ws = `/opt/gitflow-previews/workspace-${i}`
      if (fs.existsSync(ws)) {
        await commitCheckpoint(ws, `manual_${Date.now()}`, `Manual create: ${sanitizedPath}`).catch(() => null)
      }
    }

    invalidateSemanticGraph(project.id)
    if (sanitizedPath.endsWith('.sql')) invalidateDbSchemaGraph(project.id)

    res.json({ path: sanitizedPath, commitUrl, ok: true })
  } catch (err) {
    res.status(502).json({ error: `No se pudo crear ${sanitizedPath}`, detail: err.message })
  }
})

projectsRouter.delete('/:id/file', requireAuth, async (req, res) => {
  const project = await getOwnedProject(req.user.id, req.params.id)
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })
  let sanitizedPath
  try {
    sanitizedPath = sanitizeProjectPath(req.query.path || req.body?.path)
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
  if (!isVirtualRepo(project.repo_full_name) && !req.user.github_access_token) {
    return res.status(403).json({ error: 'Conecta tu cuenta de GitHub para continuar', code: 'github_not_connected' })
  }
  try {
    if (isVirtualRepo(project.repo_full_name)) {
      const { error } = await supabase
        .from('project_files')
        .delete()
        .eq('project_id', project.id)
        .eq('path', sanitizedPath)
      if (error) throw error
    }

    await createCheckpoint(project, null, { changeType: 'code', summary: `Eliminado manualmente: ${sanitizedPath}` })
    if (isPreviewConfigured) refreshPreview(`user:${req.user.id}`, project).catch(() => {})

    for (let i = 0; i < 5; i++) {
      const ws = `/opt/gitflow-previews/workspace-${i}`
      if (fs.existsSync(ws)) {
        const filePath = path.join(ws, sanitizedPath)
        if (fs.existsSync(filePath)) {
          fs.rmSync(filePath, { force: true })
        }
        await commitCheckpoint(ws, `manual_${Date.now()}`, `Manual delete: ${sanitizedPath}`).catch(() => null)
      }
    }

    invalidateSemanticGraph(project.id)
    if (sanitizedPath.endsWith('.sql')) invalidateDbSchemaGraph(project.id)

    res.json({ path: sanitizedPath, ok: true })
  } catch (err) {
    res.status(502).json({ error: `No se pudo eliminar ${sanitizedPath}`, detail: err.message })
  }
})

// Exportación y descarga en archivo .ZIP

projectsRouter.get('/:id/export-static', requireAuth, async (req, res) => {
  const project = await getOwnedProject(req.user.id, req.params.id)
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })

  try {
    const safeSlug = (project.slug || project.name || 'proyecto').replace(/[^a-zA-Z0-9-_]/g, '_')

    // 1. Buscar workspace físico en /opt/gitflow-previews/workspace-0..9 o /opt/gitflow-app/workspace/:id
    let workspaceDir = null
    for (let i = 0; i < 10; i++) {
      const ws = `/opt/gitflow-previews/workspace-${i}`
      if (fs.existsSync(ws)) {
        try {
          const cfg = fs.readFileSync(path.join(ws, '.git', 'config'), 'utf-8')
          if (project.repo_full_name && cfg.includes(project.repo_full_name)) {
            workspaceDir = ws
            break
          }
        } catch (_) {}
      }
    }

    if (!workspaceDir) {
      const appWs = `/opt/gitflow-app/workspace/${project.id}`
      if (fs.existsSync(appWs)) workspaceDir = appWs
    }

    const zip = new AdmZip()

    if (workspaceDir && fs.existsSync(workspaceDir)) {
      const distDir = path.join(workspaceDir, 'dist')
      const publicDocAssets = path.join(workspaceDir, 'public', 'doc-assets')
      const distDocAssets = path.join(distDir, 'doc-assets')

      // Ejecutar compilación Vite estática si es necesario
      try {
        console.log(`[export-static] Compilando dist estático en ${workspaceDir}...`)
        const { execSync } = await import('node:child_process')
        execSync('npx vite build --base=./ || npm run build', {
          cwd: workspaceDir,
          timeout: 60000,
          stdio: 'pipe',
          env: { ...process.env, NODE_ENV: 'production' }
        })
      } catch (buildErr) {
        console.warn(`[export-static] Advertencia en build de Vite: ${buildErr.message}. Usando dist existente o fallback.`)
      }

      // Asegurar que doc-assets esté dentro de dist
      if (fs.existsSync(publicDocAssets)) {
        try {
          if (!fs.existsSync(distDocAssets)) {
            fs.mkdirSync(distDocAssets, { recursive: true })
          }
          const assetFiles = fs.readdirSync(publicDocAssets)
          for (const af of assetFiles) {
            const srcFile = path.join(publicDocAssets, af)
            const destFile = path.join(distDocAssets, af)
            if (fs.statSync(srcFile).isFile() && !fs.existsSync(destFile)) {
              fs.copyFileSync(srcFile, destFile)
            }
          }
        } catch (_) {}
      }

      if (fs.existsSync(distDir) && fs.existsSync(path.join(distDir, 'index.html'))) {
        zip.addLocalFolder(distDir)
      } else {
        // Fallback: empaquetar archivos del proyecto excluyendo node_modules y .git
        const files = await readAllProjectFiles(project).catch(() => [])
        for (const f of files) {
          if (f.path && !f.path.includes('node_modules') && !f.path.includes('.git')) {
            zip.addFile(f.path, Buffer.from(f.content || '', f.is_base64 ? 'base64' : 'utf-8'))
          }
        }
      }
    } else {
      // Entorno virtual o sin workspace local directo
      const files = await readAllProjectFiles(project).catch(() => [])
      for (const f of files) {
        if (f.path && !f.path.includes('node_modules') && !f.path.includes('.git')) {
          zip.addFile(f.path, Buffer.from(f.content || '', f.is_base64 ? 'base64' : 'utf-8'))
        }
      }
    }

    const zipBuffer = zip.toBuffer()
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${safeSlug}-estatico-dist.zip"`)
    res.setHeader('Content-Length', zipBuffer.length)
    return res.send(zipBuffer)
  } catch (err) {
    console.error('[export-static] Error:', err)
    res.status(500).json({ error: 'Error al exportar build estático', detail: err.message })
  }
})

projectsRouter.get('/:id/export-zip', requireAuth, async (req, res) => {
  const project = await getOwnedProject(req.user.id, req.params.id)
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })
  try {
    let files = []
    if (isVirtualRepo(project.repo_full_name)) {
      const { data, error } = await supabase
        .from('project_files')
        .select('path, content, is_base64')
        .eq('project_id', project.id)
      if (error) throw error
      files = data || []
    } else {
      files = await readAllProjectFiles(project).catch(() => [])
    }

    const zip = new AdmZip()
    const forbidden = ['.git', 'node_modules', '.env']

    for (const f of files) {
      if (!f.path) continue
      try {
        const cleanPath = sanitizeProjectPath(f.path)
        const segments = cleanPath.split('/')
        if (segments.some(s => forbidden.includes(s.toLowerCase()))) continue

        if (f.is_base64) {
          zip.addFile(cleanPath, Buffer.from(f.content, 'base64'))
        } else {
          zip.addFile(cleanPath, Buffer.from(f.content || '', 'utf-8'))
        }
      } catch (_) {
        // Excluir archivos que no superen sanitizeProjectPath
      }
    }

    const zipBuffer = zip.toBuffer()
    const safeSlug = (project.slug || project.name || 'project').replace(/[^a-zA-Z0-9-_]/g, '_')

    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${safeSlug}.zip"`)
    res.setHeader('Content-Length', zipBuffer.length)
    return res.send(zipBuffer)
  } catch (err) {
    res.status(500).json({ error: 'Error al exportar el proyecto como ZIP', detail: err.message })
  }
})

projectsRouter.post('/:id/quick-edit', requireAuth, async (req, res) => {
  const project = await getOwnedProject(req.user.id, req.params.id)
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })

  const { elementContext, action, newText, newClasses, tailwindUpdates } = req.body || {}
  try {
    const result = await executeQuickEdit({
      project,
      user: req.user,
      elementContext,
      action,
      newText,
      newClasses,
      tailwindUpdates
    })
    res.json(result)
  } catch (err) {
    res.status(500).json({ status: 'FALLBACK_REQUIRED', reason: 'ERROR', message: err.message })
  }
})

// Secrets/env vars del proyecto (estilo Lovable): el usuario las carga acá directo, sin
// pasárselas a la IA por el chat (que las dejaría escritas en el historial de mensajes). El
// GET nunca devuelve el valor real, solo la clave — para verlo/cambiarlo hay que volver a
// escribirlo.
projectsRouter.get('/:id/secrets', requireAuth, async (req, res) => {
  const project = await getOwnedProject(req.user.id, req.params.id)
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })
  try {
    const secrets = await listProjectSecrets(project.id)
    res.json({ secrets })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

projectsRouter.post('/:id/secrets', requireAuth, async (req, res) => {
  const project = await getOwnedProject(req.user.id, req.params.id)
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })
  const { key, value } = req.body
  if (!key || value === undefined || value === '') return res.status(400).json({ error: 'Faltan key y/o value' })
  try {
    const secret = await upsertProjectSecret(project.id, key.trim(), value)
    res.status(201).json(secret)
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

projectsRouter.delete('/:id/secrets/:secretId', requireAuth, async (req, res) => {
  const project = await getOwnedProject(req.user.id, req.params.id)
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })
  try {
    await deleteProjectSecret(project.id, req.params.secretId)
    res.status(204).end()
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// "Skills" al estilo Claude (SKILL.md, opcionalmente en un .zip) — instrucciones extra que se
// inyectan en el prompt del agente para ESTE proyecto, además de "Conocimiento del proyecto".
const skillUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB de sobra para un SKILL.md real
})

projectsRouter.get('/:id/skills', requireAuth, async (req, res) => {
  const project = await getOwnedProject(req.user.id, req.params.id)
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })
  try {
    const skills = await listProjectSkills(project.id, req.user.id)
    res.json({ skills })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

projectsRouter.post('/:id/skills', requireAuth, skillUpload.single('file'), async (req, res) => {
  const project = await getOwnedProject(req.user.id, req.params.id)
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })
  if (!req.file) return res.status(400).json({ error: 'Falta el archivo (.md o .zip con un SKILL.md adentro)' })
  try {
    const parsed = extractSkillFromUpload(req.file.buffer, req.file.originalname)
    const skill = await addProjectSkill(project.id, parsed)
    res.status(201).json(skill)
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

projectsRouter.patch('/:id/skills/:skillId', requireAuth, async (req, res) => {
  const project = await getOwnedProject(req.user.id, req.params.id)
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })
  try {
    const skill = await toggleProjectSkill(req.user.id, req.params.skillId, Boolean(req.body?.isActive))
    res.json(skill)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

projectsRouter.delete('/:id/skills/:skillId', requireAuth, async (req, res) => {
  const project = await getOwnedProject(req.user.id, req.params.id)
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })
  try {
    await deleteProjectSkill(req.user.id, req.params.skillId)
    res.status(204).end()
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Secrets de SERVIDOR (Edge Functions) — a diferencia de /:id/secrets (que terminan en el
// bundle público), estos se empujan directo a Supabase (Management API) y solo los puede leer
// una función corriendo en su servidor. Necesitan la conexión de Supabase por OAuth: con una
// connection string manual no hay Management API con la que empujarlos.
projectsRouter.get('/:id/server-secrets', requireAuth, async (req, res) => {
  const project = await getOwnedProject(req.user.id, req.params.id)
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })
  try {
    const secrets = await listProjectServerSecrets(project.id)
    res.json({ secrets })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

projectsRouter.post('/:id/server-secrets', requireAuth, async (req, res) => {
  const project = await getOwnedProject(req.user.id, req.params.id)
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })
  const { key, value } = req.body
  if (!key || value === undefined || value === '') return res.status(400).json({ error: 'Faltan key y/o value' })
  try {
    const conn = await resolveDbConnection(req.user, project.repo_full_name)
    if (!conn || conn.type !== 'oauth') {
      return res.status(400).json({
        error: 'Este proyecto necesita una base de datos de Supabase conectada por OAuth para usar secrets de servidor.',
      })
    }
    const secret = await upsertProjectServerSecret(project.id, key.trim(), value)
    await setServerSecrets(conn.accessToken, conn.projectRef, [{ name: key.trim(), value }])
    res.status(201).json(secret)
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

projectsRouter.delete('/:id/server-secrets/:secretId', requireAuth, async (req, res) => {
  const project = await getOwnedProject(req.user.id, req.params.id)
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })
  try {
    const secrets = await listProjectServerSecrets(project.id)
    const target = secrets.find((s) => s.id === req.params.secretId)
    await deleteProjectServerSecret(project.id, req.params.secretId)
    if (target) {
      try {
        const conn = await resolveDbConnection(req.user, project.repo_full_name)
        if (conn?.type === 'oauth') await deleteServerSecret(conn.accessToken, conn.projectRef, target.key)
      } catch {
        // Best-effort: si falla borrarlo de Supabase, al menos ya no se ve/reenvía desde acá.
      }
    }
    res.status(204).end()
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Publicar: a diferencia de la vista previa (un servidor Vite vivo que se apaga solo a los 20
// min de inactividad), esto genera un build estático real y lo deja guardado en el servidor —
// es lo que responde el subdominio público (y, más adelante, un dominio propio) sin depender
// de que el dueño tenga el editor abierto.
// Publicar (hacer pública la web en su subdominio de FlowPro) usa el mismo mínimo que crear un
// proyecto o usar el chat: cualquier plan activo, o la demo gratis de 30 minutos alcanza. El
// plan de 30 días o superior se exige más abajo, pero para conectar un DOMINIO PROPIO, no para
// esto — ver MIN_DOMAIN_PLAN_DAYS en la ruta "/:id/domain".
projectsRouter.post('/:id/publish', requireAuth, async (req, res) => {
  const project = await getOwnedProject(req.user.id, req.params.id)
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })
  if (!isVirtualRepo(project.repo_full_name) && !req.user.github_access_token) {
    return res.status(403).json({ error: 'Conecta tu cuenta de GitHub para continuar', code: 'github_not_connected' })
  }
  // Publicar es más que usar el agente: deja un sitio real, público, consumiendo hosting de
  // verdad — a diferencia del resto de la app (hasAccess), la demo gratis de 30 min NO alcanza
  // acá, hace falta un plan pago activo.
  if (!hasActivePlan(req.user)) {
    return res.status(402).json({
      error: 'Necesitás un plan activo para publicar tu sitio (la demo gratis no incluye publicar).',
      code: 'plan_upgrade_required',
    })
  }

  try {
    const result = await publishProject(project, req.user.github_access_token, req.user)
    res.json(result)
  } catch (err) {
    res.status(502).json({ error: 'No se pudo publicar el proyecto', detail: err.message })
  }
})

projectsRouter.post('/:id/unpublish', requireAuth, async (req, res) => {
  const project = await getOwnedProject(req.user.id, req.params.id)
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })
  try {
    await unpublishProject(project)
    res.status(204).end()
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Lista las Edge Functions ya desplegadas de este proyecto (se registran en project_edge_functions
// cuando se aprueba una "propose_edge_function" — ver routes/edgeFunctionChanges.js). Es
// puramente informativo: para desplegar una nueva se le pide a la IA por chat, no hay un botón
// "crear" acá.
projectsRouter.get('/:id/edge-functions', requireAuth, async (req, res) => {
  const project = await getOwnedProject(req.user.id, req.params.id)
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })
  try {
    const { data, error } = await supabase
      .from('project_edge_functions')
      .select('slug, summary, deployed_at')
      .eq('project_id', project.id)
      .order('deployed_at', { ascending: false })
    if (error) throw error

    let projectRef = null
    try {
      const conn = await resolveDbConnection(req.user, project.repo_full_name)
      if (conn?.type === 'oauth') projectRef = conn.projectRef
    } catch {
      // Sin conexión de Supabase no hay URL de invocación para armar — la lista se muestra igual.
    }

    res.json({
      functions: data.map((f) => ({
        slug: f.slug,
        summary: f.summary,
        deployedAt: f.deployed_at,
        invokeUrl: projectRef ? functionInvokeUrl(projectRef, f.slug) : null,
      })),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Dominio propio: FlowPro corre su propio DNS autoritativo (PowerDNS en esta misma VPS) — el
// usuario cambia los nameservers de SU dominio a los de FlowPro en su registrador, y una vez
// que eso propaga, el dominio sirve el sitio publicado de este proyecto.
// Conectar un dominio propio es más exigente que publicar en el subdominio de FlowPro: hace
// falta el plan de 30 días o superior, no alcanza con cualquier plan activo (ni con la demo
// gratis). No se valida esto en el frontend solamente — el usuario podría llamar a la API
// directo.
const MIN_DOMAIN_PLAN_DAYS = 30

projectsRouter.post('/:id/domain', requireAuth, async (req, res) => {
  if (!isDnsConfigured) return res.status(503).json({ error: 'El servicio de dominios propios no está configurado en el servidor' })
  const project = await getOwnedProject(req.user.id, req.params.id)
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })

  if (!hasActivePlan(req.user)) {
    return res.status(402).json({
      error: `Para conectar un dominio propio necesitás el plan de ${MIN_DOMAIN_PLAN_DAYS} días o superior activo.`,
      code: 'plan_upgrade_required',
    })
  }
  const { data: currentPlan } = await supabase.from('plans').select('duration_days').eq('id', req.user.plan_id).maybeSingle()
  if (!currentPlan || currentPlan.duration_days < MIN_DOMAIN_PLAN_DAYS) {
    return res.status(402).json({
      error: `Para conectar un dominio propio necesitás el plan de ${MIN_DOMAIN_PLAN_DAYS} días o superior activo.`,
      code: 'plan_upgrade_required',
    })
  }

  const domain = String(req.body?.domain || '').trim().toLowerCase()
  if (!isValidDomain(domain)) return res.status(400).json({ error: 'Ese dominio no parece válido (ej. midominio.com)' })
  try {
    await createDomainZone(domain)
    const { error } = await supabase
      .from('projects')
      .update({ custom_domain: domain, custom_domain_verified_at: null })
      .eq('id', project.id)
    if (error) throw error
    res.json({ domain, nameservers: NAMESERVERS.map((ns) => ns.replace(/\.$/, '')) })
  } catch (err) {
    res.status(502).json({ error: 'No se pudo conectar el dominio', detail: err.message })
  }
})

projectsRouter.get('/:id/domain/status', requireAuth, async (req, res) => {
  const project = await getOwnedProject(req.user.id, req.params.id)
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })
  if (!project.custom_domain) return res.json({ domain: null, verified: false, certReady: false })
  try {
    const verified = await checkDelegation(project.custom_domain)
    if (verified && !project.custom_domain_verified_at) {
      await supabase.from('projects').update({ custom_domain_verified_at: new Date().toISOString() }).eq('id', project.id)
      await syncCustomDomainsNginxMap()
    }
    // El certificado se intenta cada vez que se verifica y todavía no existe uno — si Let's
    // Encrypt falla (ej. el challenge HTTP-01 no llegó a tiempo por propagación DNS), no rompe
    // la respuesta: el dominio sigue "verificado" igual, el usuario puede reintentar "Verificar
    // ahora" más tarde y esto se vuelve a intentar solo.
    let certReady = verified && certExists(project.custom_domain)
    if (verified && !certReady) {
      try {
        await issueCertificateForDomain(project.custom_domain, project.slug)
        certReady = true
      } catch (err) {
        console.error(`No se pudo emitir el certificado de ${project.custom_domain}:`, err.message)
      }
    }
    res.json({
      domain: project.custom_domain,
      verified,
      certReady,
      nameservers: NAMESERVERS.map((ns) => ns.replace(/\.$/, '')),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

projectsRouter.delete('/:id/domain', requireAuth, async (req, res) => {
  const project = await getOwnedProject(req.user.id, req.params.id)
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })
  if (!project.custom_domain) return res.status(204).end()
  try {
    await deleteDomainZone(project.custom_domain)
    removeDomainNginxSite(project.slug)
    const wasVerified = Boolean(project.custom_domain_verified_at)
    const { error } = await supabase
      .from('projects')
      .update({ custom_domain: null, custom_domain_verified_at: null })
      .eq('id', project.id)
    if (error) throw error
    if (wasVerified) await syncCustomDomainsNginxMap()
    res.status(204).end()
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Historial de checkpoints del proyecto (estilo Lovable): uno por cada cambio de código, DB o
// archivo aplicado, para poder volver el proyecto a ese punto desde el chat.
projectsRouter.get('/:id/checkpoints', requireAuth, async (req, res) => {
  const project = await getOwnedProject(req.user.id, req.params.id)
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })
  try {
    const checkpoints = await listCheckpoints(project.id)
    res.json(checkpoints)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Rollback atómico de trayectoria (estilo Lovable revert-trajectory)
projectsRouter.post('/:id/revert-trajectory', requireAuth, async (req, res) => {
  const project = await getOwnedProject(req.user.id, req.params.id);
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

  let { messageId, commitSha } = req.body || {};

  // 1. Si no viene commitSha directo pero viene messageId, buscar en messages
  if (!commitSha && messageId) {
    const { data: targetMsg } = await supabase
      .from('messages')
      .select('*')
      .eq('id', messageId)
      .single();
    if (targetMsg) {
      const cpAction = (targetMsg.actions || []).find(a => a.type === 'checkpoint' && (a.commitSha || a.trajectory?.commitSha));
      commitSha = cpAction?.commitSha || cpAction?.trajectory?.commitSha;
    }
  }

  // Si aún no tenemos commitSha, buscar en checkpoints por id o turnId
  if (!commitSha && messageId) {
    const { data: cpRows } = await supabase
      .from('checkpoints')
      .select('commit_sha')
      .eq('project_id', project.id)
      .or(`id.eq.${messageId},turn_id.eq.${messageId}`)
      .order('created_at', { ascending: false })
      .limit(1);
    if (cpRows && cpRows[0]?.commit_sha) {
      commitSha = cpRows[0].commit_sha;
    }
  }

  if (!commitSha) {
    return res.status(400).json({ error: 'No se encontró commitSha ni checkpoint válido para revertir' });
  }

  // 2. Reversión física del workspace Git
  const wsDir = findProjectWorkspace(project);
  let filesRestoredCount = 0;
  if (wsDir && fs.existsSync(wsDir)) {
    const restoreRes = await restoreLocalGitCheckpoint(wsDir, commitSha);
    if (!restoreRes.ok) {
      console.warn(`[revert-trajectory] Warning en restoreLocalGitCheckpoint: ${restoreRes.error}`);
    }

    // 3. Sincronizar project_files en la base de datos con el workspace restaurado
    try {
      const walkDir = (dir, base = '') => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        let results = [];
        for (const entry of entries) {
          const rel = base ? `${base}/${entry.name}` : entry.name;
          if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.vite') continue;
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            results = results.concat(walkDir(full, rel));
          } else if (entry.isFile()) {
            results.push(rel);
          }
        }
        return results;
      };

      const diskFiles = walkDir(wsDir);
      filesRestoredCount = diskFiles.length;

      // Leer archivos de disco y actualizar o insertar en project_files
      for (const relPath of diskFiles) {
        try {
          const fullPath = path.join(wsDir, relPath);
          const content = fs.readFileSync(fullPath, 'utf-8');
          try {
            const { error: upsertErr } = await supabase.from('project_files').upsert({
              project_id: project.id,
              path: relPath,
              content,
              updated_at: new Date().toISOString()
            }, { onConflict: 'project_id,path' });
            if (upsertErr) {
              console.warn('[SupabaseQueryError] project_files upsert failed:', { error: upsertErr.message, details: upsertErr.details });
            }
          } catch (err) {
            console.warn('[SupabaseQueryError] project_files upsert caught:', { error: err.message });
          }
        } catch (_) {}
      }

      // Eliminar de project_files los que ya no existen en el disco tras el rollback
      const { data: dbFiles } = await supabase
        .from('project_files')
        .select('path')
        .eq('project_id', project.id);
      if (dbFiles) {
        const diskSet = new Set(diskFiles);
        const toDelete = dbFiles.filter(f => !diskSet.has(f.path)).map(f => f.path);
        if (toDelete.length > 0) {
          try {
            const { error: delErr } = await supabase.from('project_files').delete().eq('project_id', project.id).in('path', toDelete);
            if (delErr) {
              console.warn('[SupabaseQueryError] project_files delete failed:', { error: delErr.message, details: delErr.details });
            }
          } catch (err) {
            console.warn('[SupabaseQueryError] project_files delete caught:', { error: err.message });
          }
        }
      }
    } catch (syncErr) {
      console.warn(`[revert-trajectory] Error sincronizando project_files: ${syncErr.message}`);
    }
  }

  // 4. Truncar/ocultar turnos posteriores en la conversación si viene messageId
  if (messageId) {
    try {
      const { data: targetMsg } = await supabase
        .from('messages')
        .select('created_at, conversation_id')
        .eq('id', messageId)
        .single();
      if (targetMsg) {
        await supabase
          .from('messages')
          .update({ hidden: true })
          .eq('conversation_id', targetMsg.conversation_id)
          .gt('created_at', targetMsg.created_at);
      }
    } catch (hideErr) {
      console.warn(`[revert-trajectory] Error ocultando mensajes posteriores: ${hideErr.message}`);
    }
  }

  // 5. Invalidar grafos semánticos y refrescar Vite preview
  invalidateSemanticGraph(project.id);
  invalidateDbSchemaGraph(project.id);
  if (isPreviewConfigured) {
    refreshPreview(`user:${req.user.id}`, project).catch(() => {});
  }

  res.json({
    ok: true,
    commitSha,
    messageId: messageId || null,
    filesRestoredCount,
    restoredAt: new Date().toISOString()
  });
});

projectsRouter.post('/:id/checkpoints/:checkpointId/restore', requireAuth, async (req, res) => {
  const project = await getOwnedProject(req.user.id, req.params.id)
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })
  if (!isVirtualRepo(project.repo_full_name) && !req.user.github_access_token) {
    return res.status(403).json({ error: 'Conecta tu cuenta de GitHub para continuar', code: 'github_not_connected' })
  }

  try {
    const fileState = await resolveCheckpointFileState(project.id, req.params.checkpointId)
    if (!fileState) {
      return res.status(404).json({ error: 'No se encontró un estado de archivos para restaurar en ese punto del historial' })
    }
    await restoreProjectFiles(project, req.user.github_access_token, fileState, 'FlowPro: restaurado a un punto anterior del historial')

    if (isPreviewConfigured) refreshPreview(`user:${req.user.id}`, project).catch(() => {})

    res.json({ restored: true })
  } catch (err) {
    res.status(502).json({ error: 'No se pudo restaurar el proyecto', detail: err.message })
  }
})

// Cambia el subdominio del proyecto (<slug>.flow-pro.online). Solo cambia la fila en la
// base — la próxima vez que se inicie un preview, ese slug nuevo se manda como "slugHint" al
// orquestador (ver services/previewOrchestrator.js) y pasa a ser la URL real.

projectsRouter.patch('/:id/default-agent', requireAuth, async (req, res) => {
  try {
    const { default_agent_id } = req.body
    const { data, error } = await supabase
      .from('projects')
      .update({ default_agent_id: default_agent_id || null })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select()
      .single()
    if (error) throw error
    res.json(data)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})
projectsRouter.patch('/:id/slug', requireAuth, async (req, res) => {
  const project = await getOwnedProject(req.user.id, req.params.id)
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })

  const slug = slugify(String(req.body.slug || ''))
  if (!slug || slug === 'proyecto') return res.status(400).json({ error: 'Elegí un subdominio válido' })
  if (slug === project.slug) return res.json(serializeProject(project))

  const { data: existing, error: checkErr } = await supabase.from('projects').select('id').eq('slug', slug).maybeSingle()
  if (checkErr) return res.status(500).json({ error: checkErr.message })
  if (existing) return res.status(409).json({ error: 'Ese subdominio ya está en uso. Elegí otro.' })

  const { data: updated, error } = await supabase.from('projects').update({ slug }).eq('id', project.id).select('*').single()
  if (error) {
    // el índice único de la base es la última línea de defensa si dos guardan al mismo tiempo
    if (error.code === '23505') return res.status(409).json({ error: 'Ese subdominio ya está en uso. Elegí otro.' })
    return res.status(500).json({ error: error.message })
  }

  // Si hay un preview de ESTE proyecto corriendo ahora mismo, quedó reservado bajo el slug
  // viejo — sin esto, esa URL vieja seguiría respondiendo (y la nueva daría 404) hasta que el
  // usuario lo pare a mano o expire por inactividad. Lo paramos para que el cambio se sienta
  // inmediato: la próxima vez que inicie el preview, ya sale con el slug nuevo.
  if (isPreviewConfigured) {
    getPreviewStatus(`user:${req.user.id}`, project.repo_full_name)
      .then((status) => {
        if (status?.status && status.status !== 'idle' && status.repoFullName === project.repo_full_name) {
          return stopPreview(`user:${req.user.id}`, project.repo_full_name)
        }
      })
      .catch(() => {})
  }

  res.json(serializeProject(updated))
})

// "Conocimiento del proyecto" (estilo Lovable): texto fijo que la IA lee siempre, en cada
// mensaje, sin que el usuario tenga que repetir contexto del negocio (rubro, tono, reglas)
// en cada pedido. Ver agent.js -> knowledgeSection.
projectsRouter.patch('/:id/knowledge', requireAuth, async (req, res) => {
  const project = await getOwnedProject(req.user.id, req.params.id)
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })
  const knowledge = String(req.body.knowledge ?? '').slice(0, 8000)
  const { data: updated, error } = await supabase.from('projects').update({ knowledge }).eq('id', project.id).select('*').single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(serializeProject(updated))
})

// Memoria de la IA (ver agent.js -> memorySection / "update_memory"): a diferencia de
// "knowledge" de arriba, esto lo escribe la propia IA sola a medida que trabaja — este endpoint
// es solo para que el dueño la vea y, si quiere, la corrija o borre a mano.
projectsRouter.patch('/:id/ai-memory', requireAuth, async (req, res) => {
  const project = await getOwnedProject(req.user.id, req.params.id)
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })
  const aiMemory = String(req.body.aiMemory ?? '').slice(0, 6000)
  const { data: updated, error } = await supabase.from('projects').update({ ai_memory: aiMemory }).eq('id', project.id).select('*').single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(serializeProject(updated))
})

// Endpoint de cancelación explícita por usuario para el proyecto (/api/projects/:id/cancel)
projectsRouter.post('/:id/cancel', requireAuth, async (req, res) => {
  const projectId = req.params.id;
  let cancelled = false;

  if (activeTurns.has(projectId)) {
    const turnData = activeTurns.get(projectId);
    if (turnData) {
      turnData.explicitCancelRequested = true;
      if (turnData.abortController) {
        try { turnData.abortController.abort(); } catch (_) {}
      }
      cancelled = true;
    }
  }

  for (const [key, turnData] of activeTurns.entries()) {
    if (turnData?.projectId === projectId) {
      turnData.explicitCancelRequested = true;
      if (turnData.abortController) {
        try { turnData.abortController.abort(); } catch (_) {}
      }
      cancelled = true;
    }
  }

  return res.json({
    ok: true,
    cancelled,
    message: cancelled ? 'Cancelación explícita del turno procesada exitosamente.' : 'No había ningún turno activo para este proyecto.'
  });
})

async function saveProjectAsset(req, res, column) {
  const project = await getOwnedProject(req.user.id, req.params.id)
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })
  if (!req.file) return res.status(400).json({ error: 'Falta el archivo (campo "file")' })
  const ext = ALLOWED_IMAGE_TYPES[req.file.mimetype]
  if (!ext) return res.status(400).json({ error: 'Formato no soportado. Usa PNG, JPG, WEBP, ICO o SVG.' })

  try {
    await mkdir(PROJECT_ASSETS_DIR, { recursive: true })
    const filename = `${project.id}-${column}${ext}`
    await writeFile(join(PROJECT_ASSETS_DIR, filename), req.file.buffer)
    const url = `/api/project-assets/${filename}?v=${Date.now()}`
    const { data: updated, error } = await supabase
      .from('projects')
      .update({ [column === 'logo' ? 'logo_url' : 'social_image_url']: url })
      .eq('id', project.id)
      .select('*')
      .single()
    if (error) return res.status(500).json({ error: error.message })
    res.json(serializeProject(updated))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

projectsRouter.post('/:id/logo', requireAuth, assetUpload.single('file'), (req, res) => saveProjectAsset(req, res, 'logo'))
projectsRouter.post('/:id/social-image', requireAuth, assetUpload.single('file'), (req, res) => saveProjectAsset(req, res, 'social'))



async function getTopologicalTableOrder(client, targetTables) {
  if (targetTables.length === 0) return [];
  const query = `
    SELECT
      tc.table_name AS child_table,
      ccu.table_name AS parent_table
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND tc.table_name = ANY($1)
      AND ccu.table_name = ANY($1);
  `;
  
  const { rows } = await client.query(query, [targetTables]);
  
  const graph = new Map();
  const inDegree = new Map();
  
  targetTables.forEach(table => {
    graph.set(table, []);
    inDegree.set(table, 0);
  });

  rows.forEach(({ child_table, parent_table }) => {
    if (child_table !== parent_table) { 
      graph.get(parent_table).push(child_table);
      inDegree.set(child_table, (inDegree.get(child_table) || 0) + 1);
    }
  });

  const queue = targetTables.filter(t => inDegree.get(t) === 0);
  const ordered = [];

  while (queue.length > 0) {
    const current = queue.shift();
    ordered.push(current);

    (graph.get(current) || []).forEach(child => {
      inDegree.set(child, inDegree.get(child) - 1);
      if (inDegree.get(child) === 0) {
        queue.push(child);
      }
    });
  }

  targetTables.forEach(t => {
    if (!ordered.includes(t)) ordered.push(t);
  });

  return ordered;
}


function sanitizeSchemaSQL(sqlContent) {
  return sqlContent
    // 1. Eliminar cualquier intento de crear roles o alterar privilegios por defecto
    .replace(/CREATE\s+ROLE\s+[^;]+;/gi, '/* [flowpro-sanitized: CREATE ROLE bypassed] */')
    .replace(/ALTER\s+ROLE\s+[^;]+;/gi, '/* [flowpro-sanitized: ALTER ROLE bypassed] */')
    .replace(/ALTER\s+DEFAULT\s+PRIVILEGES\s+FOR\s+ROLE\s+[^;]+;/gi, '/* [flowpro-sanitized: default privileges bypassed] */')
    // 2. Eliminar variables de sesión de superusuario
    .replace(/SET\s+session_replication_role\s*=\s*['"]?[a-zA-Z0-9_]+['"]?;?/gi, '/* [flowpro-sanitized: session_replication_role bypassed] */')
    // 3. Eliminar cambios de propietario que apunten a supabase_admin o postgres
    .replace(/OWNER\s+TO\s+['"]?(supabase_admin|postgres)['"]?;?/gi, '/* [flowpro-sanitized: OWNER TO bypassed] */')
    // 4. Otros OWNER TO genéricos
    .replace(/^\s*ALTER\s+TABLE\s+.*?\s+OWNER\s+TO\s+.*?;/gim, '/* [flowpro-sanitized: OWNER TO bypassed] */')
    .replace(/^\s*ALTER\s+(SCHEMA|TYPE|FUNCTION|PROCEDURE)\s+.*?\s+OWNER\s+TO\s+.*?;/gim, '/* [flowpro-sanitized: OWNER TO bypassed] */')
    // 5. Sentencias de replicación
    .replace(/^\s*ALTER\s+TABLE\s+.*?\s+ENABLE\s+REPLICA\s+IDENTITY.*?;/gim, '/* [flowpro-sanitized: REPLICA IDENTITY bypassed] */');
}

projectsRouter.post('/:id/import-db-zip', requireAuth, uploadDbZip.single('zipFile'), async (req, res) => {
  const projectId = req.params.id;
  const zipPath = req.file.path;
  
  try {
    // Validate project
    const { data: project } = await supabase
      .from('projects')
      .select('id, repo_full_name')
      .eq('id', projectId)
      .eq('user_id', req.user.id)
      .single();
      
    if (!project) throw new Error('Project not found');

    let dbConfig = await resolveDbConnection(req.user, project.repo_full_name);
    
    // Removida exclusión de oauth
    if (dbConfig && dbConfig.type === 'oauth') {
      console.log('Using old import pipeline with connected supabase... (will use management API)');
    }
    
    if (!dbConfig) {
      const { createVpsConnection } = await import('../services/vpsPostgres.js');
      const connRow = await createVpsConnection(req.user.id, project.repo_full_name, 'Base de datos automática (Migración)');
      dbConfig = { 
        type: 'manual', 
        connectionString: connRow.connection_string, 
        isVps: true,
        publicToken: connRow.public_token,
        vpsDatabaseName: connRow.vps_database_name
      };
    }

    const extractDir = await mkdtemp(join(tmpdir(), `db-import-${projectId}-`));
    
    // 1. Extraer seguro (Anti Zip-Slip)
    const zip = new AdmZip(zipPath);
    const zipEntries = zip.getEntries();
    
    for (const entry of zipEntries) {
      const resolvedPath = join(extractDir, entry.entryName);
      if (!resolvedPath.startsWith(extractDir)) {
        throw new Error('Intento de Zip Slip detectado');
      }
    }
    zip.extractAllTo(extractDir, true);

    const client = new Client({ connectionString: dbConfig.connectionString, ssl: { rejectUnauthorized: false } });
    await client.connect();
    
    try {
      await importDatabaseZip(client, extractDir);
    } finally {
      await client.end();
    }

    // 5. & 6. Ingesta de Secretos y Re-cableado
    const projectWorkspace = `/opt/gitflow-app/workspace/${projectId}`;
    const targetEnvPath = join(projectWorkspace, '.env');
    
    const envPath = join(extractDir, 'secrets/.env');
    const fs = await import('node:fs/promises');
    let extraSecrets = {};
    if (await fs.stat(envPath).catch(() => false)) {
      const envRaw = await fs.readFile(envPath, 'utf8');
      envRaw.split('\n').forEach(line => {
        const [k, ...v] = line.split('=');
        if (k && v.length) extraSecrets[k.trim()] = v.join('=').trim();
      });
    }

    const flowProEnv = {
      ...extraSecrets,
      VITE_SUPABASE_URL: process.env.FLOWPRO_PUBLIC_SUPABASE_URL || 'https://api.flow-pro.online',
      VITE_SUPABASE_ANON_KEY: process.env.FLOWPRO_PUBLIC_ANON_KEY || 'dummy_key',
      SUPABASE_URL: process.env.FLOWPRO_PUBLIC_SUPABASE_URL || 'https://api.flow-pro.online',
      SUPABASE_ANON_KEY: process.env.FLOWPRO_PUBLIC_ANON_KEY || 'dummy_key',
    };

    const envContent = Object.entries(flowProEnv)
      .map(([key, val]) => `${key}=${val}`)
      .join('\n');

    // Sobreescribir el .env si el workspace existe
    if (await fs.stat(projectWorkspace).catch(() => false)) {
      await fs.writeFile(targetEnvPath, envContent, 'utf8');
    }

    // 7. Reiniciar contenedor
    try {
      await restartPreviewForAgent(project.repo_full_name);
    } catch(e) {
      console.error("Preview restart error:", e);
    }

    // Limpieza
    await rm(extractDir, { recursive: true, force: true });
    await rm(zipPath, { force: true });

    return res.json({
      success: true,
      message: 'Base de datos restaurada y entorno reconectado exitosamente a FlowPro.'
    });

  } catch (err) {
    console.error('[DB-IMPORT-ERROR]', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});


// BYODB Supabase Migration Routes
projectsRouter.post('/:projectId/upload-migration-zip', requireAuth, uploadDbZip.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'No se subió ningún archivo ZIP.' });
    }

    const tempZipPath = req.file.path;

    // Opcional: Extraer el ref si el nombre es flow_migrador_<ref>.zip
    const refMatch = req.file.originalname.match(/flow_migrador_([a-z0-9]+)\.zip/i);
    const detectedRef = refMatch ? refMatch[1] : null;

    // IMPORTANTE: NO llamar a supabaseMigrator aquí.
    return res.json({
      ok: true,
      success: true,
      message: 'Archivo ZIP recibido correctamente.',
      zipExtractPath: tempZipPath,
      projectRef: detectedRef
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

  projectsRouter.post('/:projectId/execute-supabase-migration', express.json(), async (req, res) => {
    let extractDir = null;
    try {
      const { projectId } = req.params;
      const { zipExtractPath, dbPassword, ...credentials } = req.body;
      if (!zipExtractPath) throw new Error('Missing zipExtractPath');

      if (!dbPassword || String(dbPassword).trim().length === 0) {
        return res.status(400).json({
          ok: false,
          error: 'Por favor, introduce la contrase\u00f1a de tu base de datos Supabase.'
        });
      }
      credentials.dbPassword = dbPassword;
      
      extractDir = path.join(os.tmpdir(), `db_import_${Date.now()}_${Math.random().toString(36).slice(2)}`);
      const zip = new AdmZip(zipExtractPath);
      zip.extractAllTo(extractDir, true);

      await executeRemoteSupabaseMigration(projectId, req.user, credentials, extractDir);
      
      return res.json({ success: true, ok: true, message: 'Base de datos migrada y conectada exitosamente.' });
    } catch (error) {
      console.error('[Migration Error]:', error);
      res.status(500).json({ ok: false, error: error.message });
    } finally {
      if (extractDir) await rm(extractDir, { recursive: true, force: true }).catch(() => {});
    }
  });

projectsRouter.use('/:id/cloud', cloudRoutes);
projectsRouter.use('/:id/analytics', analyticsRoutes);
projectsRouter.use('/:id/seo', seoRoutes);
projectsRouter.use('/:id/settings', settingsRoutes);
projectsRouter.get('/:id/cloud/overview', requireAuth, getCloudOverview);
projectsRouter.get('/:id/cloud/database/tables', requireAuth, getTables);
projectsRouter.get('/:id/cloud/database/tables/:tableName/rows', requireAuth, getTableRowsData);
projectsRouter.post('/:id/cloud/database/tables/:tableName/rows', requireAuth, insertTableRow);
projectsRouter.patch('/:id/cloud/database/tables/:tableName/rows/:primaryKey', requireAuth, updateTableRow);
projectsRouter.delete('/:id/cloud/database/tables/:tableName/rows/:primaryKey', requireAuth, deleteTableRow);
projectsRouter.post('/:id/cloud/database/sql', requireAuth, executeProjectSql);

projectsRouter.get('/:id/cloud/users', requireAuth, getUsers);
projectsRouter.delete('/:id/cloud/users/:userId', requireAuth, deleteUser);

projectsRouter.get('/:id/cloud/storage/buckets', requireAuth, getStorageBuckets);
projectsRouter.post('/:id/cloud/storage/buckets', requireAuth, createStorageBucket);
projectsRouter.get('/:id/cloud/storage/buckets/:bucketId/files', requireAuth, getStorageFiles);
projectsRouter.delete('/:id/cloud/storage/buckets/:bucketId/files/:fileName', requireAuth, deleteStorageFile);

// ============================================================================
// ENDPOINTS DE AUTENTICACIÓN OFICIAL DE PROYECTOS (ESTÁNDAR FLOWPRO / LOVABLE)
// ============================================================================

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function resolveProjectDbConnection(projectId) {
  if (!projectId) return null;
  
  let project = null;
  try {
    const { data: p } = await supabase
      .from('projects')
      .select('id, name, slug, repo_full_name, user_id')
      .or(`id.eq.${projectId},slug.eq.${projectId}`)
      .maybeSingle();
    project = p;
  } catch (err) {
    try {
      const { data: pSlug } = await supabase
        .from('projects')
        .select('id, name, slug, repo_full_name, user_id')
        .eq('slug', projectId)
        .maybeSingle();
      project = pSlug;
    } catch (_) {}
  }

  let connRow = null;
  if (project?.repo_full_name) {
    const { data: c } = await supabase
      .from('repo_db_connections')
      .select('*')
      .eq('repo_full_name', project.repo_full_name)
      .maybeSingle();
    connRow = c;
  }

  if (!connRow) {
    const { data: cByToken } = await supabase
      .from('repo_db_connections')
      .select('*')
      .eq('public_token', projectId)
      .maybeSingle();
    connRow = cByToken;
  }

  if (!connRow && typeof projectId === 'string' && projectId.includes('/')) {
    const { data: cByRepo } = await supabase
      .from('repo_db_connections')
      .select('*')
      .eq('repo_full_name', projectId)
      .maybeSingle();
    connRow = cByRepo;
  }

  if (!connRow || !connRow.connection_string) return null;

  return {
    connectionString: connRow.connection_string,
    authSecret: connRow.auth_secret || config.jwtSecret || 'flowpro-default-auth-secret',
    publicToken: connRow.public_token,
    repoFullName: connRow.repo_full_name,
    project
  };
}

// 1. Registro de Usuario (POST /api/projects/:id/auth/signup)
projectsRouter.post('/:id/auth/signup', async (req, res) => {
  const { id } = req.params;
  const { email, password, full_name, metadata } = req.body || {};
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ ok: false, error: 'Email inválido' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ ok: false, error: 'La contraseña debe tener al menos 6 caracteres' });
  }

  const connInfo = await resolveProjectDbConnection(id);
  if (!connInfo) {
    return res.status(404).json({ ok: false, error: 'Proyecto o base de datos no encontrada' });
  }

  const client = new Client({ connectionString: connInfo.connectionString });
  await client.connect();
  try {
    const hash = await bcrypt.hash(password, 10);
    const cleanEmail = email.toLowerCase().trim();
    const userMeta = { full_name: full_name || cleanEmail.split('@')[0], ...(metadata || {}) };

    let userRow = null;
    try {
      const { rows } = await client.query(
        `INSERT INTO auth.users (email, password_hash, raw_user_meta_data, raw_app_meta_data, email_confirmed_at, last_sign_in_at)
         VALUES ($1, $2, $3, $4, now(), now())
         RETURNING id, email, created_at`,
        [cleanEmail, hash, JSON.stringify(userMeta), JSON.stringify({ provider: 'email' })]
      );
      userRow = rows[0];
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ ok: false, error: 'Ya existe una cuenta con ese email' });
      }
      try {
        const { rows } = await client.query(
          `INSERT INTO _flowpro_users (email, password_hash) VALUES ($1, $2) RETURNING id, email, created_at`,
          [cleanEmail, hash]
        );
        userRow = rows[0];
      } catch (fErr) {
        if (fErr.code === '23505') return res.status(409).json({ ok: false, error: 'Ya existe una cuenta con ese email' });
        throw fErr;
      }
    }

    const token = jwt.sign(
      { sub: userRow.id, email: userRow.email },
      connInfo.authSecret,
      { expiresIn: '30d' }
    );

    const user = { id: userRow.id, email: userRow.email, created_at: userRow.created_at };
    return res.status(201).json({
      ok: true,
      user,
      token,
      data: { user, token }
    });
  } catch (err) {
    console.error('[Project Auth Signup Error]:', err);
    return res.status(500).json({ ok: false, error: err.message });
  } finally {
    await client.end().catch(() => {});
  }
});

// 2. Inicio de Sesión (POST /api/projects/:id/auth/login)
projectsRouter.post('/:id/auth/login', async (req, res) => {
  const { id } = req.params;
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ ok: false, error: 'Email y contraseña requeridos' });
  }

  const connInfo = await resolveProjectDbConnection(id);
  if (!connInfo) {
    return res.status(404).json({ ok: false, error: 'Proyecto o base de datos no encontrada' });
  }

  const client = new Client({ connectionString: connInfo.connectionString });
  await client.connect();
  try {
    const cleanEmail = email.toLowerCase().trim();
    let userRow = null;

    try {
      const { rows } = await client.query(
        `SELECT id, email, password_hash, created_at FROM auth.users WHERE email = $1`,
        [cleanEmail]
      );
      userRow = rows[0];
    } catch (e) {}

    if (!userRow) {
      const { rows } = await client.query(
        `SELECT id, email, password_hash, created_at FROM _flowpro_users WHERE email = $1`,
        [cleanEmail]
      );
      userRow = rows[0];
    }

    if (!userRow || !(await bcrypt.compare(password, userRow.password_hash || ''))) {
      return res.status(401).json({ ok: false, error: 'Email o contraseña incorrectos' });
    }

    // Actualizar last_sign_in_at
    await client.query(`UPDATE auth.users SET last_sign_in_at = now() WHERE id = $1`, [userRow.id]).catch(() => {});

    const token = jwt.sign(
      { sub: userRow.id, email: userRow.email },
      connInfo.authSecret,
      { expiresIn: '30d' }
    );

    const user = { id: userRow.id, email: userRow.email, created_at: userRow.created_at };
    return res.json({
      ok: true,
      user,
      token,
      data: { user, token }
    });
  } catch (err) {
    console.error('[Project Auth Login Error]:', err);
    return res.status(500).json({ ok: false, error: err.message });
  } finally {
    await client.end().catch(() => {});
  }
});

// 3. Verificación de Sesión (GET /api/projects/:id/auth/user y /me)
projectsRouter.get(['/:id/auth/user', '/:id/auth/me'], async (req, res) => {
  const { id } = req.params;
  const authHeader = req.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) {
    return res.status(401).json({ ok: false, error: 'Token no proporcionado', user: null });
  }

  const connInfo = await resolveProjectDbConnection(id);
  if (!connInfo) {
    return res.status(404).json({ ok: false, error: 'Proyecto no encontrado' });
  }

  let userId = null;
  try {
    const decoded = jwt.verify(token, connInfo.authSecret);
    userId = decoded.sub;
  } catch (e) {
    return res.status(401).json({ ok: false, error: 'Token inválido o expirado', user: null });
  }

  const client = new Client({ connectionString: connInfo.connectionString });
  await client.connect();
  try {
    let userRow = null;
    try {
      const { rows } = await client.query(
        `SELECT u.id, u.email, u.created_at, u.last_sign_in_at,
                COALESCE(p.full_name, u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)) as full_name,
                COALESCE(p.avatar_url, u.raw_user_meta_data->>'avatar_url') as avatar_url,
                COALESCE(p.role, u.raw_user_meta_data->>'role', 'user') as role
         FROM auth.users u
         LEFT JOIN public.profiles p ON p.id = u.id
         WHERE u.id = $1`,
        [userId]
      );
      userRow = rows[0];
    } catch (e) {}

    if (!userRow) {
      const { rows } = await client.query(
        `SELECT id, email, created_at FROM _flowpro_users WHERE id = $1`,
        [userId]
      );
      userRow = rows[0];
    }

    if (!userRow) {
      return res.status(404).json({ ok: false, error: 'Usuario no encontrado', user: null });
    }

    return res.json({
      ok: true,
      user: userRow,
      data: { user: userRow }
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  } finally {
    await client.end().catch(() => {});
  }
});

// Telemetría de errores de runtime del preview (canal directo desde el iframe)
projectsRouter.post('/:id/telemetry/errors', (req, res) => {
  const { id } = req.params;
  const { message, stack, source, filename, lineno, colno, sessionId } = req.body || {};
  if (message || stack) {
    runtimeBus.notifyError(id, {
      message,
      stack,
      source: source || 'PREVIEW_TELEMETRY',
      filename,
      lineno,
      colno,
      sessionId,
      projectId: id
    });
  }
  return res.status(204).end();
});


