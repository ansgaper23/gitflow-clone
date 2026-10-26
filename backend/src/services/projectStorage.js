import { supabase } from '../db/supabaseClient.js'
import { getRepoTree, getFileContent, commitFileChange, commitTree, restoreToCommit } from './github.js'
import { isVirtualRepo } from './projectResolver.js'

// Capa única de acceso a archivos de un proyecto: branchea entre la API de GitHub
// (proyectos storage_type=github) y la tabla project_files (proyectos storage_type=virtual,
// sin GitHub conectado). El resto del backend (agent.js, rutas) no necesita saber cuál es.

// Cache de CONTENIDO de archivo entre turnos — antes cada etapa de una migración larga
// (agent.js#readCache es SOLO por turno, se tira al terminar) releía desde cero los mismos ~150
// archivos que ya había leído la etapa anterior, cada vez (confirmado con un caso real: 10 turnos
// seguidos, mismo listado completo de reads en cada uno — ida y vuelta a GitHub/Supabase por
// nada, y probablemente parte de por qué esas etapas tardaban varios minutos cada una).
// Es SEGURO cachear entre turnos porque este archivo es el ÚNICO lugar del backend que escribe
// contenido de un proyecto (GitHub o project_files) — writeProjectFile/writeProjectFiles/
// replaceAllProjectFiles de acá abajo actualizan/invalidan la entrada correspondiente apenas
// escriben de verdad, así que un turno posterior nunca puede leer algo desactualizado por culpa
// del caché. El TTL es solo una red de seguridad extra (por si algún día se agrega otra forma de
// escribir un archivo sin pasar por estas funciones), no lo que mantiene la coherencia día a día.
const FILE_CACHE_TTL_MS = 20 * 60 * 1000
const fileCache = new Map() // "projectId:path" -> { content, expiresAt }

function fileCacheKey(project, path) {
  return `${project.id}:${path}`
}

function cacheFile(project, path, content) {
  fileCache.set(fileCacheKey(project, path), { content, expiresAt: Date.now() + FILE_CACHE_TTL_MS })
}

// Exportado para el único otro lugar que puede llegar a necesitar invalidar a mano: un checkpoint
// restaurado a un commit_sha de GitHub (restoreToCommit) reemplaza un montón de archivos a la vez
// sin que este módulo sepa cuáles ni con qué contenido — más simple tirar todo lo de ese proyecto
// que intentar reconstruir cada entrada.
export function invalidateProjectFileCache(projectId) {
  for (const key of fileCache.keys()) {
    if (key.startsWith(`${projectId}:`)) fileCache.delete(key)
  }
}

export async function listProjectFiles(project, accessToken, signal) {
  if (isVirtualRepo(project.repo_full_name)) {
    const { data, error } = await supabase.from('project_files').select('path').eq('project_id', project.id)
    if (error) throw error
    return data.map((f) => ({ path: f.path }))
  }
  const [owner, repo] = project.repo_full_name.split('/')
  return getRepoTree(accessToken, owner, repo, project.branch, signal)
}

export async function readProjectFile(project, accessToken, path, signal, noCache = false) {
  const key = fileCacheKey(project, path)
  const cached = fileCache.get(key)
  if (!noCache && cached && cached.expiresAt > Date.now()) return cached.content

  const content = await (async () => {
    if (isVirtualRepo(project.repo_full_name)) {
      const { data, error } = await supabase
        .from('project_files')
        .select('content')
        .eq('project_id', project.id)
        .eq('path', path)
        .maybeSingle()
      if (error) throw error
      if (!data) throw new Error(`No existe el archivo: ${path}`)
      return data.content
    }
    const [owner, repo] = project.repo_full_name.split('/')
    return getFileContent(accessToken, owner, repo, path, project.branch, signal)
  })()
  cacheFile(project, path, content)
  return content
}

// Aplica un cambio a UN archivo. Para proyectos virtuales se aplica directo (no hay "commit"
// real); para GitHub, crea un commit de verdad. La aprobación del usuario ya ocurrió antes
// de llamar esto — esta función es la que corre cuando se aprueba, sea cual sea el storage.
export async function writeProjectFile(project, accessToken, { path, newContent, summary, contentIsBase64 }) {
  if (isVirtualRepo(project.repo_full_name)) {
    const { error } = await supabase.from('project_files').upsert(
      {
        project_id: project.id,
        path,
        content: newContent,
        is_base64: Boolean(contentIsBase64),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'project_id,path' },
    )
    if (error) throw error
    cacheFile(project, path, newContent)
    return { commitUrl: null, commitSha: null }
  }
  const [owner, repo] = project.repo_full_name.split('/')
  const result = await commitFileChange({
    accessToken,
    owner,
    repo,
    path,
    newContent,
    message: `FlowPro: ${summary}`,
    branch: project.branch,
    contentIsBase64,
  })
  cacheFile(project, path, newContent)
  return result
}

// Para el scaffold inicial: varios archivos de una sola vez.
export async function writeProjectFiles(project, accessToken, files, message) {
  if (isVirtualRepo(project.repo_full_name)) {
    const rows = Object.entries(files).map(([path, content]) => ({
      project_id: project.id,
      path,
      content,
      is_base64: false,
    }))
    const { error } = await supabase.from('project_files').upsert(rows, { onConflict: 'project_id,path' })
    if (error) throw error
    for (const [path, content] of Object.entries(files)) cacheFile(project, path, content)
    return { commitUrl: null, commitSha: null }
  }
  const [owner, repo] = project.repo_full_name.split('/')
  const result = await commitTree(accessToken, owner, repo, files, message, project.branch)
  for (const [path, content] of Object.entries(files)) cacheFile(project, path, content)
  return result
}

// Todo el contenido actual del proyecto, para migrar a GitHub o para que el orquestador
// arme el workspace de un preview virtual sin git clone.
export async function readAllProjectFiles(project) {
  if (!isVirtualRepo(project.repo_full_name)) {
    throw new Error('readAllProjectFiles solo aplica a proyectos virtuales')
  }
  const { data, error } = await supabase
    .from('project_files')
    .select('path, content, is_base64')
    .eq('project_id', project.id)
  if (error) throw error
  return data
}

// Foto completa de los archivos actuales del proyecto, en el formato que espera un checkpoint
// (files_snapshot) o un restore: { path: { content, isBase64 } }. Para GitHub no se usa —ahí el
// checkpoint solo guarda el commit_sha, mucho más liviano que duplicar todo el árbol.
export async function snapshotProjectFiles(project) {
  const files = await readAllProjectFiles(project)
  const snapshot = {}
  for (const f of files) snapshot[f.path] = { content: f.content, isBase64: f.is_base64 }
  return snapshot
}

// Reemplaza TODO el contenido de un proyecto virtual por el de `files` (a diferencia de
// writeProjectFiles, que solo agrega/actualiza): borra lo que ya no corresponda. Es lo que
// necesita un restore de checkpoint para que archivos creados después del punto elegido
// desaparezcan, no solo que los viejos se sobreescriban.
async function replaceAllProjectFiles(project, files) {
  const { error: deleteErr } = await supabase.from('project_files').delete().eq('project_id', project.id)
  if (deleteErr) throw deleteErr

  const rows = Object.entries(files).map(([path, value]) => {
    const isBase64 = typeof value === 'object' && value !== null && value.isBase64
    const content = typeof value === 'object' && value !== null ? value.content : value
    return { project_id: project.id, path, content, is_base64: Boolean(isBase64) }
  })
  // Reemplazo total (checkpoint/restore) — más simple e igual de seguro tirar TODO lo cacheado de
  // este proyecto que reconstruir entrada por entrada (archivos que ya no existen después del
  // restore también tienen que desaparecer del caché, no solo actualizarse).
  invalidateProjectFileCache(project.id)
  if (rows.length === 0) return
  const { error: insertErr } = await supabase.from('project_files').insert(rows)
  if (insertErr) throw insertErr
  for (const row of rows) cacheFile(project, row.path, row.content)
}

// Restaura el proyecto al estado de un checkpoint: `source` trae `commitSha` (checkpoint
// capturado cuando el proyecto ya era de GitHub) y/o `filesSnapshot` (capturado mientras era
// virtual). Cuál de los dos usa depende de dónde vive el proyecto AHORA, no de dónde vivía
// cuando se creó el checkpoint — así un proyecto migrado a GitHub puede restaurar checkpoints
// de cuando todavía era virtual, y viceversa nunca hace falta (no se puede "des-migrar").
export async function restoreProjectFiles(project, accessToken, { commitSha, filesSnapshot }, message) {
  if (isVirtualRepo(project.repo_full_name)) {
    if (!filesSnapshot) throw new Error('Este checkpoint no tiene una foto de archivos guardada, no se puede restaurar')
    await replaceAllProjectFiles(project, filesSnapshot)
    return { commitUrl: null, commitSha: null }
  }
  const [owner, repo] = project.repo_full_name.split('/')
  if (commitSha) {
    // No hay forma barata de saber acá qué contenido quedó en cada archivo tras el restore (a
    // diferencia del caso "filesSnapshot" de abajo) — invalidar todo es lo seguro.
    const result = await restoreToCommit(accessToken, owner, repo, commitSha, message, project.branch)
    invalidateProjectFileCache(project.id)
    return result
  }
  if (filesSnapshot) {
    const result = await commitTree(accessToken, owner, repo, filesSnapshot, message, project.branch, { exact: true })
    invalidateProjectFileCache(project.id)
    for (const [path, value] of Object.entries(filesSnapshot)) {
      const content = typeof value === 'object' && value !== null ? value.content : value
      cacheFile(project, path, content)
    }
    return result
  }
  throw new Error('Este checkpoint no tiene ni commit ni foto de archivos guardada, no se puede restaurar')
}
