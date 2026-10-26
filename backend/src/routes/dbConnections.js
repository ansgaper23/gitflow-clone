import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { supabase } from '../db/supabaseClient.js'
import { testConnection, listTables, getTableRows, fetchTableColumns, insertTableRow, updateTableRow, deleteTableRow } from '../services/repoDb.js'
import { isSupabaseOAuthConfigured, isVpsPgConfigured } from '../config.js'
import { getValidAccessToken, listProjects, listAccountsForUser, getOwnedAccount } from '../services/supabaseOAuth.js'
import { detectRepoSupabaseRef, extractRefFromConnectionString } from '../services/dbMatchCheck.js'
import { resolveDbConnection } from '../services/dbConnectionResolver.js'
import { createVpsConnection, dropVpsDatabase } from '../services/vpsPostgres.js'
import { restartPreviewIfRunning } from '../services/previewOrchestrator.js'
import { getOwnedProjectByRepo } from '../services/projectResolver.js'
import { dropAllStorage } from '../services/flowStorage.js'

export const dbConnectionsRouter = Router()

function serialize(conn) {
  const base = {
    id: conn.id,
    repoFullName: conn.repo_full_name,
    label: conn.label,
    connectionType: conn.connection_type,
    createdAt: conn.created_at,
  }
  if (conn.connection_type === 'oauth') {
    return { ...base, projectRef: conn.project_ref, projectName: conn.project_name, supabaseAccountId: conn.supabase_account_id }
  }
  const masked = (conn.connection_string || '').replace(/:\/\/([^:]+):([^@]+)@/, '://$1:••••@')
  return { ...base, connectionStringMasked: masked }
}

dbConnectionsRouter.get('/vps-status', requireAuth, (req, res) => {
  res.json({ available: isVpsPgConfigured })
})

dbConnectionsRouter.get('/', requireAuth, async (req, res) => {
  const { repo } = req.query
  if (!repo) return res.status(400).json({ error: 'Falta el parámetro repo' })

  const { data, error } = await supabase
    .from('repo_db_connections')
    .select('*')
    .eq('user_id', req.user.id)
    .eq('repo_full_name', repo)
    .maybeSingle()
  if (error) return res.status(500).json({ error: error.message })
  res.json(data ? serialize(data) : null)
})

dbConnectionsRouter.get('/supabase-status', requireAuth, async (req, res) => {
  try {
    const accounts = await listAccountsForUser(req.user.id)
    res.json({ oauthAvailable: isSupabaseOAuthConfigured, connected: accounts.length > 0 })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Cuentas de Supabase que este usuario ya vinculó (nunca los tokens) — un usuario puede tener
// varias (una propia, una de un cliente, etc.) y elegir cuál usar en cada proyecto por separado.
dbConnectionsRouter.get('/supabase-accounts', requireAuth, async (req, res) => {
  try {
    const accounts = await listAccountsForUser(req.user.id)
    res.json(accounts.map((a) => ({ id: a.id, label: a.label, createdAt: a.created_at })))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

dbConnectionsRouter.delete('/supabase-accounts/:id', requireAuth, async (req, res) => {
  const { data: inUse } = await supabase
    .from('repo_db_connections')
    .select('repo_full_name')
    .eq('supabase_account_id', req.params.id)
    .limit(1)
  if (inUse?.length) {
    return res.status(409).json({ error: `Esta cuenta todavía la usa el proyecto "${inUse[0].repo_full_name}" — desconectala ahí primero.` })
  }
  const { error } = await supabase.from('supabase_oauth_accounts').delete().eq('id', req.params.id).eq('user_id', req.user.id)
  if (error) return res.status(500).json({ error: error.message })
  res.status(204).end()
})

// "accountId" es obligatorio: ya no hay UN token global del usuario, cada cuenta vinculada tiene
// el suyo — sin esto no habría forma de saber a cuál de las varias posibles consultarle.
dbConnectionsRouter.get('/supabase-projects', requireAuth, async (req, res) => {
  const { accountId } = req.query
  if (!accountId) return res.status(400).json({ error: 'Falta el parámetro accountId' })
  try {
    const account = await getOwnedAccount(req.user.id, accountId)
    if (!account) return res.status(404).json({ error: 'Cuenta de Supabase no encontrada' })
    const accessToken = await getValidAccessToken(account)
    const projects = await listProjects(accessToken)
    res.json(projects.map((p) => ({ ref: p.id ?? p.ref, name: p.name })))
  } catch (err) {
    res.status(400).json({ error: 'No se pudieron listar tus proyectos de Supabase', detail: err.message })
  }
})

dbConnectionsRouter.get('/match-check', requireAuth, async (req, res) => {
  const { repo } = req.query
  if (!repo) return res.status(400).json({ error: 'Falta el parámetro repo' })

  const { data: conn } = await supabase
    .from('repo_db_connections')
    .select('*')
    .eq('user_id', req.user.id)
    .eq('repo_full_name', repo)
    .maybeSingle()

  if (!conn) return res.json({ repoRef: null, repoRefSource: null, connectedRef: null, match: null })

  const connectedRef = conn.connection_type === 'oauth' ? conn.project_ref : extractRefFromConnectionString(conn.connection_string)

  const [owner, repoName] = repo.split('/')
  let detected = null
  try {
    detected = await detectRepoSupabaseRef(req.user.github_access_token, owner, repoName)
  } catch {
    detected = null
  }

  if (!detected || !connectedRef) {
    return res.json({ repoRef: detected?.ref || null, repoRefSource: detected?.source || null, connectedRef, match: null })
  }

  res.json({
    repoRef: detected.ref,
    repoRefSource: detected.source,
    connectedRef,
    match: detected.ref === connectedRef,
  })
})

// Ver datos reales de la base conectada (estilo Lovable Cloud): no solo que está conectada,
// las tablas y sus filas — sin salir del editor a entrar a Supabase aparte.
dbConnectionsRouter.get('/tables', requireAuth, async (req, res) => {
  const { repo } = req.query
  if (!repo) return res.status(400).json({ error: 'Falta el parámetro repo' })
  try {
    const conn = await resolveDbConnection(req.user, repo)
    if (!conn) return res.status(404).json({ error: 'Este proyecto no tiene una base de datos conectada' })
    const tables = await listTables(conn)
    res.json({ tables })
  } catch (err) {
    res.status(502).json({ error: 'No se pudo leer el esquema de la base de datos', detail: err.message })
  }
})

dbConnectionsRouter.get('/tables/:table/rows', requireAuth, async (req, res) => {
  const { repo, limit } = req.query
  if (!repo) return res.status(400).json({ error: 'Falta el parámetro repo' })
  try {
    const conn = await resolveDbConnection(req.user, repo)
    if (!conn) return res.status(404).json({ error: 'Este proyecto no tiene una base de datos conectada' })
    const [rows, columns] = await Promise.all([
      getTableRows(conn, req.params.table, limit),
      fetchTableColumns(conn, req.params.table)
    ])
    let effectiveColumns = columns || []
    if (effectiveColumns.length === 0 && rows && rows.length > 0) {
      effectiveColumns = Object.keys(rows[0]).map((k) => ({
        name: k,
        column_name: k,
        type: typeof rows[0][k] === 'number' ? 'integer' : typeof rows[0][k] === 'boolean' ? 'boolean' : 'text',
        data_type: typeof rows[0][k] === 'number' ? 'integer' : typeof rows[0][k] === 'boolean' ? 'boolean' : 'text',
        is_nullable: true,
        is_primary: k === 'id'
      }))
    }
    res.json({ rows, columns: effectiveColumns })
  } catch (err) {
    res.status(502).json({ error: `No se pudieron leer las filas de "${req.params.table}"`, detail: err.message })
  }
})

dbConnectionsRouter.post('/tables/:table/rows', requireAuth, async (req, res) => {
  const { repo } = req.query
  if (!repo) return res.status(400).json({ error: 'Falta el parámetro repo' })
  try {
    const conn = await resolveDbConnection(req.user, repo)
    if (!conn) return res.status(404).json({ error: 'No hay base conectada' })
    const inserted = await insertTableRow(conn, req.params.table, req.body)
    res.json({ row: inserted })
  } catch (err) {
    res.status(400).json({ error: 'Error al insertar fila', detail: err.message })
  }
})

dbConnectionsRouter.put('/tables/:table/rows/:pkColumn/:pkValue', requireAuth, async (req, res) => {
  const { repo } = req.query
  if (!repo) return res.status(400).json({ error: 'Falta el parámetro repo' })
  try {
    const conn = await resolveDbConnection(req.user, repo)
    if (!conn) return res.status(404).json({ error: 'No hay base conectada' })
    const updated = await updateTableRow(conn, req.params.table, req.params.pkColumn, req.params.pkValue, req.body)
    res.json({ row: updated })
  } catch (err) {
    res.status(400).json({ error: 'Error al actualizar fila', detail: err.message })
  }
})

dbConnectionsRouter.delete('/tables/:table/rows/:pkColumn/:pkValue', requireAuth, async (req, res) => {
  const { repo } = req.query
  if (!repo) return res.status(400).json({ error: 'Falta el parámetro repo' })
  try {
    const conn = await resolveDbConnection(req.user, repo)
    if (!conn) return res.status(404).json({ error: 'No hay base conectada' })
    const deleted = await deleteTableRow(conn, req.params.table, req.params.pkColumn, req.params.pkValue)
    res.json({ row: deleted })
  } catch (err) {
    res.status(400).json({ error: 'Error al borrar fila', detail: err.message })
  }
})

dbConnectionsRouter.post('/', requireAuth, async (req, res) => {
  const { repoFullName, label, connectionString, projectRef, projectName, supabaseAccountId } = req.body
  if (!repoFullName) return res.status(400).json({ error: 'Falta repoFullName' })

  let row
  if (projectRef) {
    if (!supabaseAccountId) return res.status(400).json({ error: 'Falta supabaseAccountId' })
    let account
    try {
      account = await getOwnedAccount(req.user.id, supabaseAccountId)
      if (!account) throw new Error('Cuenta de Supabase no encontrada')
      const accessToken = await getValidAccessToken(account)
      await testConnection({ type: 'oauth', accessToken, projectRef })
    } catch (err) {
      return res.status(400).json({ error: 'No se pudo conectar a ese proyecto de Supabase', detail: err.message })
    }
    row = {
      user_id: req.user.id,
      repo_full_name: repoFullName,
      label: label || projectName || 'Supabase',
      connection_type: 'oauth',
      project_ref: projectRef,
      project_name: projectName || null,
      connection_string: null,
      supabase_account_id: account.id,
    }
  } else if (connectionString) {
    try {
      await testConnection({ type: 'manual', connectionString })
    } catch (err) {
      return res.status(400).json({ error: 'No se pudo conectar a la base de datos', detail: err.message })
    }
    row = {
      user_id: req.user.id,
      repo_full_name: repoFullName,
      label: label || 'Base de datos',
      connection_type: 'manual',
      connection_string: connectionString,
      project_ref: null,
      project_name: null,
    }
  } else {
    return res.status(400).json({ error: 'Falta connectionString o projectRef' })
  }

  const { data, error } = await supabase
    .from('repo_db_connections')
    .upsert(row, { onConflict: 'user_id,repo_full_name' })
    .select('*')
    .single()
  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(serialize(data))

  // Fire-and-forget, después de responder: si el usuario ya tiene un preview corriendo para
  // este proyecto, lo reinicia solo para que tome las env vars de la conexión recién hecha (ver
  // restartPreviewIfRunning) — antes se quedaba con las viejas hasta que algo lo reiniciara.
  getOwnedProjectByRepo(req.user.id, repoFullName)
    .then((project) => project && restartPreviewIfRunning(req.user, project))
    .catch(() => {})
})

// "Base de datos automática": crea una base+rol nuevos en el Postgres del VPS (nunca expuesto a
// internet) sin que el usuario tenga que traer su propia cuenta de Supabase ni pegar ningún
// connection string. Tercera alternativa a las dos de arriba, no las reemplaza.
dbConnectionsRouter.post('/vps', requireAuth, async (req, res) => {
  if (!isVpsPgConfigured) {
    return res.status(503).json({ error: 'La base de datos automática no está configurada en este servidor.' })
  }
  const { repoFullName, label } = req.body
  if (!repoFullName) return res.status(400).json({ error: 'Falta repoFullName' })

  const { data: existing } = await supabase
    .from('repo_db_connections')
    .select('id')
    .eq('user_id', req.user.id)
    .eq('repo_full_name', repoFullName)
    .maybeSingle()
  if (existing) {
    return res.status(409).json({ error: 'Este proyecto ya tiene una base de datos conectada. Borrala primero si querés reemplazarla.' })
  }

  try {
    const data = await createVpsConnection(req.user.id, repoFullName, label)
    res.status(201).json(serialize(data))
    getOwnedProjectByRepo(req.user.id, repoFullName)
      .then((project) => project && restartPreviewIfRunning(req.user, project))
      .catch(() => {})
  } catch (err) {
    res.status(500).json({ error: 'No se pudo crear la base de datos automática', detail: err.message })
  }
})

dbConnectionsRouter.delete('/:id', requireAuth, async (req, res) => {
  const { data: existing } = await supabase
    .from('repo_db_connections')
    .select('connection_type, vps_database_name')
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .maybeSingle()

  const { error } = await supabase
    .from('repo_db_connections')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
  if (error) return res.status(500).json({ error: error.message })

  // Borrar la fila no borra la base real en el Postgres del VPS — sin esto, cada "desconectar"
  // de una base automática dejaría un rol y una base huérfanos acumulándose para siempre. Mismo
  // motivo para los archivos de Storage (ver flowStorage.js).
  if (existing?.connection_type === 'vps' && existing.vps_database_name) {
    dropVpsDatabase(existing.vps_database_name).catch((err) => {
      console.error(`No se pudo borrar la base VPS "${existing.vps_database_name}":`, err.message)
    })
    dropAllStorage(existing.vps_database_name).catch((err) => {
      console.error(`No se pudo borrar el storage de "${existing.vps_database_name}":`, err.message)
    })
  }

  res.status(204).end()
})
