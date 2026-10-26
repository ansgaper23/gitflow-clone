import { Router } from 'express'
import {
  getConnectionByToken,
  verifyAdminSecret,
  buildAdminConnectionString,
  runSelect,
  runInsert,
  runUpsert,
  runUpdate,
  runDelete,
  runRpc,
  adminListUsers,
  adminCreateUser,
  adminDeleteUser,
  adminGenerateLink,
  ProxyError,
} from '../services/dbProxy.js'

// Equivalente casero de "supabaseAdmin" (service_role de Supabase) — SOLO alcanzable desde
// código server-only del proyecto migrado (ver DB_ADMIN_CLIENT en scaffold.js), nunca desde el
// navegador: el secreto que exige cada request (header "X-Admin-Secret") se deriva con
// JWT_SECRET (ver computeAdminSecret en dbProxy.js), que jamás sale del backend de FlowPro — solo
// se lo inyecta al proceso de preview como env var SIN prefijo VITE_ (ver previewEnv.js), así que
// Vite nunca la bundlea al cliente aunque el resto del proyecto sí sea público. El "token" en la
// URL identifica el proyecto (igual que en el proxy público) pero NO autentica nada por sí solo.
export const dbAdminProxyRouter = Router()

function sendError(res, err) {
  const status = err instanceof ProxyError ? err.status : 500
  if (status === 500) console.error('dbAdminProxy error:', err)
  res.status(status).json({ data: null, error: err.message })
}

async function withAdminConnection(req, res, fn) {
  const { token } = req.params
  const secret = req.get('x-admin-secret')
  if (!verifyAdminSecret(token, secret)) {
    return res.status(403).json({ data: null, error: 'Secreto admin inválido' })
  }
  const conn = await getConnectionByToken(token)
  if (!conn?.vps_database_name) return res.status(404).json({ data: null, error: 'Token inválido o base de datos no encontrada' })

  try {
    const adminConnectionString = buildAdminConnectionString(conn.vps_database_name)
    const data = await fn(adminConnectionString, conn)
    res.json({ data, error: null })
  } catch (err) {
    sendError(res, err)
  }
}

dbAdminProxyRouter.get('/:token/:table', (req, res) =>
  withAdminConnection(req, res, (cs) => runSelect(cs, req.params.table, req.query, null, true)),
)
dbAdminProxyRouter.post('/:token/:table', (req, res) =>
  withAdminConnection(req, res, (cs) =>
    req.query.on_conflict
      ? runUpsert(cs, req.params.table, req.body, req.query.on_conflict, null, true)
      : runInsert(cs, req.params.table, req.body, null, true),
  ),
)
dbAdminProxyRouter.patch('/:token/:table', (req, res) =>
  withAdminConnection(req, res, (cs) => runUpdate(cs, req.params.table, req.body, req.query, null, true)),
)
dbAdminProxyRouter.delete('/:token/:table', (req, res) =>
  withAdminConnection(req, res, (cs) => runDelete(cs, req.params.table, req.query, null, true)),
)

dbAdminProxyRouter.post('/:token/rpc/:fn', (req, res) =>
  withAdminConnection(req, res, (cs) => runRpc(cs, req.params.fn, req.body, null)),
)

// --- Gestión de usuarios (equivalente de "supabaseAdmin.auth.admin.*") ---
// 3+ segmentos, nunca colisiona con "/:token/:table" (2 segmentos).

dbAdminProxyRouter.get('/:token/auth/users', (req, res) => withAdminConnection(req, res, (cs) => adminListUsers(cs)))

dbAdminProxyRouter.post('/:token/auth/users', (req, res) =>
  withAdminConnection(req, res, (cs) => adminCreateUser(cs, req.body?.email, req.body?.password)),
)

dbAdminProxyRouter.delete('/:token/auth/users/:userId', (req, res) =>
  withAdminConnection(req, res, async (cs) => {
    await adminDeleteUser(cs, req.params.userId)
    return { success: true }
  }),
)

dbAdminProxyRouter.post('/:token/auth/generate-link', (req, res) =>
  withAdminConnection(req, res, (cs, conn) => adminGenerateLink(cs, conn.auth_secret, req.body?.email, req.body?.redirectTo)),
)
