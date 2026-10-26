import { supabase } from '../db/supabaseClient.js'
import { isVirtualRepo } from './projectResolver.js'
import { snapshotProjectFiles } from './projectStorage.js'

// Se llama después de aplicar CUALQUIER cambio (código, DB o archivo) para que quede un punto
// en el historial al que el usuario pueda volver desde el panel de historial del chat, estilo
// Lovable. `commitSha` solo aplica a proyectos GitHub y a cambios que tocan archivos (código/
// asset); los cambios de DB no mueven archivos, así que no llevan snapshot propio — el restore
// usa el checkpoint de archivos más cercano hacia atrás en el tiempo.
// Best-effort: si falla, no debe tumbar el flujo de aprobación que ya se aplicó de verdad.
export async function createCheckpoint(project, conversationId, { changeType, summary, commitSha }) {
  try {
    let filesSnapshot = null
    if (isVirtualRepo(project.repo_full_name) && changeType !== 'db') {
      filesSnapshot = await snapshotProjectFiles(project)
    }
    const { error } = await supabase.from('project_checkpoints').insert({
      project_id: project.id,
      conversation_id: conversationId || null,
      change_type: changeType,
      summary,
      commit_sha: changeType === 'db' ? null : commitSha || null,
      files_snapshot: filesSnapshot,
    })
    if (error) throw error
  } catch (err) {
    console.error('No se pudo crear el checkpoint:', err.message)
  }
}

export async function listCheckpoints(projectId) {
  const { data, error } = await supabase
    .from('project_checkpoints')
    .select('id, change_type, summary, commit_sha, files_snapshot, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (error) throw error
  // No hace falta mandar el snapshot completo al frontend, solo si existe (para saber si es restaurable).
  return data.map((c) => ({
    id: c.id,
    changeType: c.change_type,
    summary: c.summary,
    createdAt: c.created_at,
    hasFileState: Boolean(c.commit_sha || c.files_snapshot),
  }))
}

// Busca el estado de archivos "efectivo" para restaurar a un checkpoint: si el checkpoint
// elegido no tiene ninguno propio (típico de uno de tipo 'db'), usa el más cercano hacia atrás
// en el tiempo que sí tenga uno.
export async function resolveCheckpointFileState(projectId, checkpointId) {
  const { data: checkpoint, error } = await supabase
    .from('project_checkpoints')
    .select('id, project_id, created_at, commit_sha, files_snapshot')
    .eq('id', checkpointId)
    .eq('project_id', projectId)
    .maybeSingle()
  if (error) throw error
  if (!checkpoint) return null

  if (checkpoint.commit_sha || checkpoint.files_snapshot) {
    return { commitSha: checkpoint.commit_sha, filesSnapshot: checkpoint.files_snapshot }
  }

  const { data: prior, error: priorErr } = await supabase
    .from('project_checkpoints')
    .select('commit_sha, files_snapshot')
    .eq('project_id', projectId)
    .lte('created_at', checkpoint.created_at)
    .or('commit_sha.not.is.null,files_snapshot.not.is.null')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (priorErr) throw priorErr
  if (!prior) return null
  return { commitSha: prior.commit_sha, filesSnapshot: prior.files_snapshot }
}
