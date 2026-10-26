import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabase } from '../db/supabaseClient.js'
import { writeProjectFile } from '../services/projectStorage.js'
import { getOwnedProjectByRepo, isVirtualRepo } from '../services/projectResolver.js'
import { isPreviewConfigured } from '../config.js'
import { refreshPreview } from '../services/previewOrchestrator.js'
import { insertFollowUpMessage, buildFollowUpText } from '../services/followUpMessage.js'
import { createCheckpoint } from '../services/checkpoints.js'

export const changesRouter = Router()

changesRouter.post('/:id/approve', requireAuth, async (req, res) => {
  const { data: change, error } = await supabase
    .from('proposed_changes')
    .select('*, conversations!inner(user_id)')
    .eq('id', req.params.id)
    .single()
  if (error || !change || change.conversations.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Cambio propuesto no encontrado' })
  }
  if (change.status !== 'pending') {
    return res.status(409).json({ error: `Este cambio ya fue ${change.status}` })
  }

  if (!isVirtualRepo(change.repo_full_name) && !req.user.github_access_token) {
    return res.status(403).json({ error: 'Conecta tu cuenta de GitHub para continuar', code: 'github_not_connected' })
  }

  try {
    const project = await getOwnedProjectByRepo(req.user.id, change.repo_full_name)
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })

    const { commitUrl, commitSha } = await writeProjectFile(project, req.user.github_access_token, {
      path: change.file_path,
      newContent: change.new_content,
      summary: change.summary,
    })

    const { data: updated, error: updateErr } = await supabase
      .from('proposed_changes')
      .update({ status: 'applied', commit_url: commitUrl })
      .eq('id', change.id)
      .select('*')
      .single()
    if (updateErr) throw updateErr

    await createCheckpoint(project, change.conversation_id, { changeType: 'code', summary: change.summary, commitSha })

    if (isPreviewConfigured) refreshPreview(`user:${req.user.id}`, project).catch(() => {})

    const followUpMessage = await insertFollowUpMessage(change.conversation_id, buildFollowUpText('code', change.summary))

    res.json({ ...updated, followUpMessage })
  } catch (err) {
    res.status(502).json({ error: 'No se pudo aplicar el cambio', detail: err.message })
  }
})

changesRouter.post('/:id/reject', requireAuth, async (req, res) => {
  const { data: change, error } = await supabase
    .from('proposed_changes')
    .select('*, conversations!inner(user_id)')
    .eq('id', req.params.id)
    .single()
  if (error || !change || change.conversations.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Cambio propuesto no encontrado' })
  }
  if (change.status !== 'pending') {
    return res.status(409).json({ error: `Este cambio ya fue ${change.status}` })
  }

  const { data: updated, error: updateErr } = await supabase
    .from('proposed_changes')
    .update({ status: 'rejected' })
    .eq('id', change.id)
    .select('*')
    .single()
  if (updateErr) return res.status(500).json({ error: updateErr.message })

  res.json(updated)
})
