import { Router } from 'express'
import {
  getConnectionByToken,
  verifyAuthToken,
  runSelect,
  runInsert,
  runUpsert,
  runUpdate,
  runDelete,
  runRpc,
  signUp,
  signIn,
  getUserById,
  ProxyError,
} from '../services/dbProxy.js'

// Público a propósito (sin requireAuth) — el "public_token" en la URL hace el mismo papel que
// la anon key de Supabase: lo trae la app publicada en el navegador, ahí no hay sesión de
// FlowPro. La autenticación de la PLATAFORMA no aplica acá; la autenticación del USUARIO FINAL
// de la app (si la usa) es el JWT propio de "auth/login", ver services/dbProxy.js.
export const dbProxyRouter = Router()

// Rate limit simple por clave (token, o "auth:token" para signup/login — más estricto ahí para
// dificultar fuerza bruta): en memoria, por proceso, alcanza para el volumen esperado en v1.
const LIMITS = { default: { max: 120, windowMs: 60_000 }, auth: { max: 20, windowMs: 60_000 } }
const hits = new Map()

function checkRateLimit(key, kind = 'default') {
  const { max, windowMs } = LIMITS[kind]
  const now = Date.now()
  const entry = hits.get(key)
  if (!entry || now > entry.resetAt) {
    hits.set(key, { count: 1, resetAt: now + windowMs })
    return true
  }
  entry.count += 1
  return entry.count <= max
}

function getBearerToken(req) {
  const header = req.get('authorization') || ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null
}

// Postgres rechaza un insert/update que viola una política RLS con el código 42501
// (insufficient_privilege) — se traduce a 403 en vez de dejarlo caer como 500 genérico.
function sendError(res, err) {
  if (err.code === '42501') {
    return res.status(403).json({ data: null, error: 'La operación viola una política de seguridad (RLS) de esta tabla.' })
  }
  const status = err instanceof ProxyError ? err.status : 500
  if (status === 500) console.error('dbProxy error:', err)
  res.status(status).json({ data: null, error: err.message })
}

// Respuesta con forma { data, error } en todos los casos, como supabase-js — así el cliente
// "src/lib/db.js" del scaffold (ver scaffold.js) puede devolverla tal cual sin traducir nada.
// Si la request trae un JWT de sesión (Authorization: Bearer ...), se valida y se pasa el user
// id a la query para que las políticas RLS lo vean vía current_user_id() — un Bearer inválido/
// vencido corta con 401 en vez de degradar silenciosamente a anónimo.
async function withConnection(req, res, fn) {
  const { token } = req.params
  if (!checkRateLimit(token)) {
    return res.status(429).json({ data: null, error: 'Demasiadas solicitudes, esperá un momento.' })
  }
  const conn = await getConnectionByToken(token)
  if (!conn) return res.status(404).json({ data: null, error: 'Token inválido o base de datos no encontrada' })

  const bearer = getBearerToken(req)
  let userId = null
  if (bearer) {
    userId = verifyAuthToken(bearer, conn.auth_secret)
    if (!userId) return res.status(401).json({ data: null, error: 'Sesión inválida o vencida' })
  }

  try {
    const data = await fn(conn, userId)
    res.json({ data, error: null })
  } catch (err) {
    sendError(res, err)
  }
}

dbProxyRouter.get('/:token/:table', (req, res) =>
  withConnection(req, res, (conn, userId) => runSelect(conn.connection_string, req.params.table, req.query, userId)),
)
dbProxyRouter.post('/:token/:table', (req, res) =>
  withConnection(req, res, (conn, userId) =>
    // "?on_conflict=col1,col2" (ver Query.upsert() en scaffold.js) distingue un upsert de un
    // insert normal — mismo endpoint, mismo verbo, igual que en PostgREST/supabase-js.
    req.query.on_conflict
      ? runUpsert(conn.connection_string, req.params.table, req.body, req.query.on_conflict, userId)
      : runInsert(conn.connection_string, req.params.table, req.body, userId),
  ),
)
dbProxyRouter.patch('/:token/:table', (req, res) =>
  withConnection(req, res, (conn, userId) => runUpdate(conn.connection_string, req.params.table, req.body, req.query, userId)),
)
dbProxyRouter.delete('/:token/:table', (req, res) =>
  withConnection(req, res, (conn, userId) => runDelete(conn.connection_string, req.params.table, req.query, userId)),
)

// Equivalente de "supabase.rpc(fnName, params)" — 3 segmentos, mismo motivo que las rutas de
// auth de más abajo: nunca colisiona con "/:token/:table" (2 segmentos) sin importar el orden
// en que Express evalúe las rutas.
dbProxyRouter.post('/:token/rpc/:fn', (req, res) =>
  withConnection(req, res, (conn, userId) => runRpc(conn.connection_string, req.params.fn, req.body, userId)),
)

// --- Auth de usuarios finales de la app ---
// 3 segmentos ("/:token/auth/signup") nunca colisionan con las rutas de tabla de arriba (2
// segmentos, "/:token/:table") sin importar el orden en que Express las evalúe.

dbProxyRouter.post('/:token/auth/signup', async (req, res) => {
  const { token } = req.params
  if (!checkRateLimit(`auth:${token}`, 'auth')) {
    return res.status(429).json({ data: null, error: 'Demasiadas solicitudes, esperá un momento.' })
  }
  const conn = await getConnectionByToken(token)
  if (!conn) return res.status(404).json({ data: null, error: 'Token inválido o base de datos no encontrada' })
  try {
    const { email, password } = req.body || {}
    const result = await signUp(conn.connection_string, conn.auth_secret, email, password)
    res.status(201).json({ data: result, error: null })
  } catch (err) {
    sendError(res, err)
  }
})

dbProxyRouter.post('/:token/auth/login', async (req, res) => {
  const { token } = req.params
  if (!checkRateLimit(`auth:${token}`, 'auth')) {
    return res.status(429).json({ data: null, error: 'Demasiadas solicitudes, esperá un momento.' })
  }
  const conn = await getConnectionByToken(token)
  if (!conn) return res.status(404).json({ data: null, error: 'Token inválido o base de datos no encontrada' })
  try {
    const { email, password } = req.body || {}
    const result = await signIn(conn.connection_string, conn.auth_secret, email, password)
    res.json({ data: result, error: null })
  } catch (err) {
    sendError(res, err)
  }
})

dbProxyRouter.get('/:token/auth/me', async (req, res) => {
  const { token } = req.params
  const conn = await getConnectionByToken(token)
  if (!conn) return res.status(404).json({ data: null, error: 'Token inválido o base de datos no encontrada' })
  const bearer = getBearerToken(req)
  if (!bearer) return res.json({ data: { user: null }, error: null })
  const userId = verifyAuthToken(bearer, conn.auth_secret)
  if (!userId) return res.status(401).json({ data: null, error: 'Sesión inválida o vencida' })
  try {
    const user = await getUserById(conn.connection_string, userId)
    res.json({ data: { user }, error: null })
  } catch (err) {
    sendError(res, err)
  }
})
