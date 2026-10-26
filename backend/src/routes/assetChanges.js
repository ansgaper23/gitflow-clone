import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabase } from '../db/supabaseClient.js'
import { writeProjectFile } from '../services/projectStorage.js'
import { getOwnedProjectByRepo, isVirtualRepo } from '../services/projectResolver.js'
import { resolveDbConnection } from '../services/dbConnectionResolver.js'
import { getServiceRoleKey, uploadToStorage } from '../services/supabaseStorage.js'
import { isPreviewConfigured } from '../config.js'
import { refreshPreview } from '../services/previewOrchestrator.js'
import { insertFollowUpMessage, buildFollowUpText } from '../services/followUpMessage.js'
import { createCheckpoint } from '../services/checkpoints.js'

export const assetChangesRouter = Router()

async function loadOwnedChange(req, res) {
  const { data: change, error } = await supabase
    .from('proposed_asset_changes')
    .select('*, conversations!inner(user_id)')
    .eq('id', req.params.id)
    .single()
  if (error || !change || change.conversations.user_id !== req.user.id) {
    res.status(404).json({ error: 'Cambio no encontrado' })
    return null
  }
  if (change.status !== 'pending') {
    res.status(409).json({ error: `Este cambio ya fue ${change.status}` })
    return null
  }
  return change
}

assetChangesRouter.post('/:id/approve', requireAuth, async (req, res) => {
  const change = await loadOwnedChange(req, res)
  if (!change) return

  try {
    if (change.target === 'github') {
      if (!isVirtualRepo(change.repo_full_name) && !req.user.github_access_token) {
        return res.status(403).json({ error: 'Conecta tu cuenta de GitHub para continuar', code: 'github_not_connected' })
      }
      const project = await getOwnedProjectByRepo(req.user.id, change.repo_full_name)
      if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })

      const { commitUrl, commitSha } = await writeProjectFile(project, req.user.github_access_token, {
        path: change.path,
        newContent: change.file_base64,
        summary: change.summary,
        contentIsBase64: true,
      })
      const { data: updated, error } = await supabase
        .from('proposed_asset_changes')
        .update({ status: 'applied', commit_url: commitUrl })
        .eq('id', change.id)
        .select('*')
        .single()
      if (error) throw error
      await createCheckpoint(project, change.conversation_id, { changeType: 'asset', summary: change.summary, commitSha })
      if (isPreviewConfigured) refreshPreview(`user:${req.user.id}`, project).catch(() => {})
      const followUpMessage = await insertFollowUpMessage(change.conversation_id, buildFollowUpText('asset', change.summary))
      return res.json({ ...updated, followUpMessage })
    }

    if (change.target === 'storage') {
      const dbConnection = await resolveDbConnection(req.user, change.repo_full_name)
      if (!dbConnection || dbConnection.type !== 'oauth') {
        return res.status(400).json({ error: 'Se necesita una conexión de Supabase por OAuth para subir a Storage' })
      }
      const serviceRoleKey = await getServiceRoleKey(dbConnection.accessToken, dbConnection.projectRef)
      const { publicUrl } = await uploadToStorage({
        projectRef: dbConnection.projectRef,
        serviceRoleKey,
        bucket: change.bucket,
        path: change.path,
        buffer: Buffer.from(change.file_base64, 'base64'),
        mimeType: change.mime_type,
      })
      const { data: updated, error } = await supabase
        .from('proposed_asset_changes')
        .update({ status: 'applied', public_url: publicUrl })
        .eq('id', change.id)
        .select('*')
        .single()
      if (error) throw error
      const followUpMessage = await insertFollowUpMessage(change.conversation_id, buildFollowUpText('storage', change.summary))
      return res.json({ ...updated, followUpMessage })
    }

    res.status(400).json({ error: `Destino desconocido: ${change.target}` })
  } catch (err) {
    await supabase.from('proposed_asset_changes').update({ result: `Error: ${err.message}` }).eq('id', change.id)
    res.status(502).json({ error: 'No se pudo subir el archivo', detail: err.message })
  }
})

assetChangesRouter.post('/:id/reject', requireAuth, async (req, res) => {
  const change = await loadOwnedChange(req, res)
  if (!change) return

  const { data: updated, error } = await supabase
    .from('proposed_asset_changes')
    .update({ status: 'rejected' })
    .eq('id', change.id)
    .select('*')
    .single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(updated)
})
