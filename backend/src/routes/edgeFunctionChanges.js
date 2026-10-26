import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabase } from '../db/supabaseClient.js'
import { resolveDbConnection } from '../services/dbConnectionResolver.js'
import { deployEdgeFunction } from '../services/edgeFunctions.js'
import { insertFollowUpMessage, buildFollowUpText } from '../services/followUpMessage.js'
import { getOwnedProjectByRepo } from '../services/projectResolver.js'
import { createCheckpoint } from '../services/checkpoints.js'

export const edgeFunctionChangesRouter = Router()

async function loadOwnedChange(req, res) {
  const { data: change, error } = await supabase
    .from('proposed_edge_functions')
    .select('*, conversations!inner(user_id)')
    .eq('id', req.params.id)
    .single()
  if (error || !change || change.conversations.user_id !== req.user.id) {
    res.status(404).json({ error: 'Función no encontrada' })
    return null
  }
  if (change.status !== 'pending') {
    res.status(409).json({ error: `Esta función ya fue ${change.status}` })
    return null
  }
  return change
}

edgeFunctionChangesRouter.post('/:id/approve', requireAuth, async (req, res) => {
  const change = await loadOwnedChange(req, res)
  if (!change) return

  let conn
  try {
    conn = await resolveDbConnection(req.user, change.repo_full_name)
  } catch (err) {
    return res.status(400).json({ error: 'No se pudo preparar la conexión de Supabase', detail: err.message })
  }
  if (!conn || conn.type !== 'oauth') {
    return res.status(400).json({
      error: 'Este proyecto necesita una base de datos de Supabase conectada por OAuth para desplegar funciones (una connection string manual no alcanza).',
    })
  }

  try {
    const result = await deployEdgeFunction(conn.accessToken, conn.projectRef, {
      slug: change.slug,
      code: change.code,
      summary: change.summary,
      verifyJwt: change.verify_jwt,
    })

    const { data: updated, error: updateErr } = await supabase
      .from('proposed_edge_functions')
      .update({ status: 'applied', result: JSON.stringify(result) })
      .eq('id', change.id)
      .select('*')
      .single()
    if (updateErr) throw updateErr

    const project = await getOwnedProjectByRepo(req.user.id, change.repo_full_name)
    if (project) {
      await supabase
        .from('project_edge_functions')
        .upsert(
          { project_id: project.id, slug: change.slug, summary: change.summary, deployed_at: new Date().toISOString() },
          { onConflict: 'project_id,slug' },
        )
      await createCheckpoint(project, change.conversation_id, { changeType: 'code', summary: change.summary })
    }

    const followUpMessage = await insertFollowUpMessage(change.conversation_id, buildFollowUpText('function', change.summary))

    res.json({ ...updated, followUpMessage })
  } catch (err) {
    await supabase.from('proposed_edge_functions').update({ result: `Error: ${err.message}` }).eq('id', change.id)
    res.status(502).json({ error: 'No se pudo desplegar la función', detail: err.message })
  }
})

edgeFunctionChangesRouter.post('/:id/reject', requireAuth, async (req, res) => {
  const change = await loadOwnedChange(req, res)
  if (!change) return

  const { data: updated, error } = await supabase
    .from('proposed_edge_functions')
    .update({ status: 'rejected' })
    .eq('id', change.id)
    .select('*')
    .single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(updated)
})
