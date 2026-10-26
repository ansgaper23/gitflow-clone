import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabase } from '../db/supabaseClient.js'
import { runSql } from '../services/repoDb.js'
import { invalidateSchemaCache } from '../services/agent.js'
import { resolveDbConnection } from '../services/dbConnectionResolver.js'
import { insertFollowUpMessage, buildFollowUpText } from '../services/followUpMessage.js'
import { getOwnedProjectByRepo } from '../services/projectResolver.js'
import { createCheckpoint } from '../services/checkpoints.js'

export const dbChangesRouter = Router()

async function loadOwnedChange(req, res) {
  const { data: change, error } = await supabase
    .from('proposed_db_changes')
    .select('*, conversations!inner(user_id)')
    .eq('id', req.params.id)
    .single()
  if (error || !change || change.conversations.user_id !== req.user.id) {
    res.status(404).json({ error: 'Cambio de base de datos no encontrado' })
    return null
  }
  if (change.status !== 'pending') {
    res.status(409).json({ error: `Este cambio ya fue ${change.status}` })
    return null
  }
  return change
}

dbChangesRouter.post('/:id/approve', requireAuth, async (req, res) => {
  const change = await loadOwnedChange(req, res)
  if (!change) return

  let conn
  try {
    conn = await resolveDbConnection(req.user, change.repo_full_name)
  } catch (err) {
    return res.status(400).json({ error: 'No se pudo preparar la conexión de base de datos', detail: err.message })
  }
  if (!conn) {
    return res.status(400).json({ error: 'No hay una base de datos conectada para este repositorio' })
  }

  try {
    const result = await runSql(conn, change.sql)
    const { data: updated, error: updateErr } = await supabase
      .from('proposed_db_changes')
      .update({ status: 'applied', result: JSON.stringify(result) })
      .eq('id', change.id)
      .select('*')
      .single()
    if (updateErr) throw updateErr
    invalidateSchemaCache(conn)

    const project = await getOwnedProjectByRepo(req.user.id, change.repo_full_name)
    if (project) await createCheckpoint(project, change.conversation_id, { changeType: 'db', summary: change.summary })

    const followUpMessage = await insertFollowUpMessage(change.conversation_id, buildFollowUpText('db', change.summary))

    res.json({ ...updated, followUpMessage })
  } catch (err) {
    await supabase.from('proposed_db_changes').update({ result: `Error: ${err.message}` }).eq('id', change.id)
    res.status(502).json({ error: 'No se pudo ejecutar el SQL', detail: err.message })
  }
})

dbChangesRouter.post('/:id/reject', requireAuth, async (req, res) => {
  const change = await loadOwnedChange(req, res)
  if (!change) return

  const { data: updated, error } = await supabase
    .from('proposed_db_changes')
    .update({ status: 'rejected' })
    .eq('id', change.id)
    .select('*')
    .single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(updated)
})
