import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabase } from '../db/supabaseClient.js'
import { getOwnedProject, isVirtualRepo } from '../services/projectResolver.js'
import { resolveDbConnection } from '../services/dbConnectionResolver.js'
import { applyCodeChanges, applyDbChanges } from '../services/applyProposals.js'
import { createCheckpoint } from '../services/checkpoints.js'
import { isPreviewConfigured } from '../config.js'
import { refreshPreview } from '../services/previewOrchestrator.js'
import { insertFollowUpMessage, buildFollowUpText } from '../services/followUpMessage.js'

// Botón único de aprobar/rechazar por TURNO (no por archivo) — solo aparece cuando el modelo
// marcó una etapa de un plan largo como "requires_approval" (ver agent.js); en un pedido
// normal los cambios ya se aplicaron solos y acá no hay nada pendiente que mostrar.
export const turnActionsRouter = Router()

async function loadOwnedMessage(req, res) {
  const { data: message, error } = await supabase
    .from('messages')
    .select('*, conversations!inner(id, user_id, project_id, repo_full_name)')
    .eq('id', req.params.messageId)
    .single()
  if (error || !message || message.conversations.user_id !== req.user.id) {
    res.status(404).json({ error: 'Mensaje no encontrado' })
    return null
  }
  return message
}

turnActionsRouter.post('/:messageId/approve-all', requireAuth, async (req, res) => {
  const message = await loadOwnedMessage(req, res)
  if (!message) return
  const convo = message.conversations

  const project = await getOwnedProject(req.user.id, convo.project_id)
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })

  if (!isVirtualRepo(project.repo_full_name) && !req.user.github_access_token) {
    return res.status(403).json({ error: 'Conecta tu cuenta de GitHub para continuar', code: 'github_not_connected' })
  }

  try {
    const [{ data: codeRows, error: codeErr }, { data: dbRows, error: dbErr }] = await Promise.all([
      supabase.from('proposed_changes').select('*').eq('message_id', message.id).eq('status', 'pending'),
      supabase.from('proposed_db_changes').select('*').eq('message_id', message.id).eq('status', 'pending'),
    ])
    if (codeErr) throw codeErr
    if (dbErr) throw dbErr

    let updatedChanges = codeRows || []
    let updatedDbChanges = dbRows || []
    let anyApplied = false
    let combinedSummary = null

    if (codeRows?.length) {
      const applied = await applyCodeChanges(project, req.user.github_access_token, codeRows)
      if (applied) {
        updatedChanges = applied.updated
        combinedSummary = applied.summary
        await createCheckpoint(project, convo.id, { changeType: 'code', summary: applied.summary, commitSha: applied.commitSha })
        anyApplied = true
      }
    }

    if (dbRows?.length) {
      updatedDbChanges = await applyDbChanges(dbRows, (repo) => resolveDbConnection(req.user, repo))
      anyApplied = true
    }

    if (isPreviewConfigured && anyApplied) refreshPreview(`user:${req.user.id}`, project).catch(() => {})

    const followUpMessage = anyApplied
      ? await insertFollowUpMessage(convo.id, buildFollowUpText('code', combinedSummary || 'los cambios de esta etapa'))
      : null

    res.json({ changes: updatedChanges, dbChanges: updatedDbChanges, followUpMessage })
  } catch (err) {
    res.status(502).json({ error: 'No se pudieron aplicar los cambios', detail: err.message })
  }
})

turnActionsRouter.post('/:messageId/reject-all', requireAuth, async (req, res) => {
  const message = await loadOwnedMessage(req, res)
  if (!message) return

  const [{ data: codeRows, error: codeErr }, { data: dbRows, error: dbErr }] = await Promise.all([
    supabase
      .from('proposed_changes')
      .update({ status: 'rejected' })
      .eq('message_id', message.id)
      .eq('status', 'pending')
      .select('*'),
    supabase
      .from('proposed_db_changes')
      .update({ status: 'rejected' })
      .eq('message_id', message.id)
      .eq('status', 'pending')
      .select('*'),
  ])
  if (codeErr || dbErr) return res.status(500).json({ error: (codeErr || dbErr).message })

  res.json({ changes: codeRows || [], dbChanges: dbRows || [] })
})
