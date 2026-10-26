import { Router } from 'express'
import { supabase } from '../db/supabaseClient.js'
import { runAppChat } from '../services/appAi.js'

// Ruta PÚBLICA (sin requireAuth): la llaman las apps ya construidas/desplegadas de los
// usuarios, en el navegador de SUS visitantes — no hay sesión de FlowPro de por medio.
export const appAiRouter = Router()

appAiRouter.post('/:projectId/chat', async (req, res) => {
  const { projectId } = req.params
  const { message, history, context } = req.body || {}
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Falta el mensaje' })
  }

  const { data: project, error } = await supabase.from('projects').select('id').eq('id', projectId).maybeSingle()
  if (error) return res.status(500).json({ error: error.message })
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })

  try {
    const reply = await runAppChat({
      projectId,
      message: message.trim().slice(0, 4000),
      history: Array.isArray(history) ? history.slice(-20) : [],
      systemContext: typeof context === 'string' && context.trim() ? context.trim() : undefined,
    })
    res.json({ reply })
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message })
  }
})
