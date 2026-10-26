import { supabase } from '../db/supabaseClient.js'
import { verifySession } from '../services/jwt.js'
import { getValidGithubToken } from '../services/github.js'

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null

  if (!token) {
    return res.status(401).json({ error: 'No autenticado' })
  }

  const userId = verifySession(token)
  if (!userId) {
    return res.status(401).json({ error: 'Sesión inválida o expirada' })
  }

  if (!supabase) {
    return res.status(503).json({ error: 'Backend no configurado: falta Supabase' })
  }

  const { data: user, error } = await supabase.from('users').select('*').eq('id', userId).single()
  if (error || !user) {
    return res.status(401).json({ error: 'Usuario no encontrado' })
  }

  // Renueva el token de GitHub acá, una sola vez por request, ANTES de que cualquier ruta lo
  // lea — así ninguna de ellas necesita saber que existe la renovación, siguen usando
  // "req.user.github_access_token" directo y para cuando lo leen ya está fresco si hacía
  // falta (ver services/github.js -> getValidGithubToken). Si falla (sin conexión a GitHub
  // ahora mismo, refresh_token también vencido), no se corta el request entero por esto: las
  // rutas que de verdad necesiten GitHub van a toparse con el 401 real y pedir reconectar.
  if (user.github_access_token) {
    await getValidGithubToken(user).catch(() => {})
  }

  req.user = user
  next()
}

export function hasActivePlan(user) {
  return Boolean(user.plan_expires_at && new Date(user.plan_expires_at) > new Date())
}

const TRIAL_MS = 30 * 60 * 1000

// Demo gratis para clientes nuevos: 30 minutos desde que se registraron, sin necesidad de
// plan. Pasada la ventana (o para cuentas viejas que ya la agotaron), hace falta un plan
// pago — usar SIEMPRE hasAccess() para gatear el agente, no hasActivePlan() solo.
export function isTrialActive(user) {
  if (!user.created_at) return false
  return Date.now() - new Date(user.created_at).getTime() < TRIAL_MS
}

export function trialExpiresAt(user) {
  if (!user.created_at) return null
  return new Date(new Date(user.created_at).getTime() + TRIAL_MS).toISOString()
}

export function hasAccess(user) {
  return hasActivePlan(user) || isTrialActive(user) || user?.is_admin || user?.is_collaborator
}

// GitHub ya no es obligatorio para tener una cuenta (login por email/contraseña o Google),
// pero sigue siendo obligatorio para cualquier ruta que llame a la API de GitHub.
export function requireGithub(req, res, next) {
  if (!req.user.github_access_token) {
    return res.status(403).json({ error: 'Conecta tu cuenta de GitHub para continuar', code: 'github_not_connected' })
  }
  next()
}
