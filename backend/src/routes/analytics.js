import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { getOwnedProject, getProjectBySlug } from '../services/projectResolver.js'
import { recordPageview, getAnalyticsSummary } from '../services/projectAnalytics.js'

export const analyticsRouter = Router()

const SLUG_RE = /^[a-z0-9-]{1,60}$/

// Pública (sin auth): la llama el script inyectado en cada sitio publicado, que corre en el
// navegador del visitante, no en el de un usuario logueado de FlowPro.
// Montado en /api, así que esta ruta queda en POST /api/track.
analyticsRouter.post('/track', async (req, res) => {
  try {
    const { slug, path } = req.body || {}
    if (typeof slug !== 'string' || !SLUG_RE.test(slug)) return res.status(204).end()
    const project = await getProjectBySlug(slug)
    if (!project) return res.status(204).end()
    await recordPageview(project.id, path, req.ip, req.headers['user-agent'])
    res.status(204).end()
  } catch {
    // Best-effort: nunca debe romper la carga del sitio del usuario por un fallo acá.
    res.status(204).end()
  }
})

// GET /api/analytics/projects/:id
analyticsRouter.get('/analytics/projects/:id', requireAuth, async (req, res) => {
  try {
    const project = await getOwnedProject(req.user.id, req.params.id)
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 90)
    const summary = await getAnalyticsSummary(project.id, days)
    res.json(summary)
  } catch (err) {
    res.status(500).json({ error: 'No se pudieron cargar las analíticas', detail: err.message })
  }
})
