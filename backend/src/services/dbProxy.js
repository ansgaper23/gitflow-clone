import pg from 'pg'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { supabase } from '../db/supabaseClient.js'
import { config } from '../config.js'

const { Client } = pg

// API tipo PostgREST (la capa REST que hace pública Supabase) pero casera, para que una app
// publicada con la "base de datos automática" (Postgres crudo en la VPS, sin esa capa) pueda
// leer/escribir datos reales desde el navegador — hoy solo podía gestionarla la IA por SQL vía
// el chat (propose_db_change), la app en sí no tenía ninguna forma de hablarle a un Postgres
// crudo. El "public_token" hace de anon key: viaja en el build (VITE_DB_PROXY_TOKEN), identifica
// SOLO la base de este proyecto, nunca el connection string real ni ningún otro proyecto.
//
// RLS real: si la request trae un JWT de sesión válido (emitido por signUp/signIn de ESTE
// proyecto), su "user_id" se carga en la sesión de Postgres con set_config() antes de correr la
// query — las políticas RLS que la IA escriba con propose_db_change pueden leerlo con
// current_user_id() (creada en vpsPostgres.js), igual que auth.uid() en Supabase. Sin JWT, o con
// uno inválido, la query corre sin ese contexto — una tabla SIN RLS habilitado sigue totalmente
// abierta (mismo comportamiento que Postgres/Supabase: RLS no hace nada si no se activó).

const AUTH_TOKEN_EXPIRY = '30d'
const RESERVED_TABLES = new Set(['_flowpro_users'])
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export class ProxyError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

const MAX_ROWS = 500
const DEFAULT_ROWS = 100
const OPERATORS = {
  eq: '=',
  neq: '<>',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  like: 'LIKE',
  ilike: 'ILIKE',
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`
}

export async function getConnectionByToken(token) {
  if (!token) return null
  const { data } = await supabase
    .from('repo_db_connections')
    .select('connection_string, repo_full_name, auth_secret, vps_database_name')
    .eq('connection_type', 'vps')
    .eq('public_token', token)
    .maybeSingle()
  return data || null
}

// --- Proxy "admin" (bypass de RLS) para código server-only ---
// El equivalente casero de "supabaseAdmin" (service_role de Supabase): código server-only de un
// proyecto migrado (webhooks de pago, paneles admin — .server.ts/.functions.ts, TanStack Start
// nunca los bundlea al navegador) necesita poder leer/escribir SIN pasar por RLS. La conexión que
// usa el proxy público (arriba) es dueña de las tablas, pero como la IA siempre agrega "FORCE ROW
// LEVEL SECURITY" (ver agent.js), ni siquiera el dueño puede saltarse las políticas con ella.
//
// No hace falta ningún secreto/columna nueva en "repo_db_connections": el secreto admin de cada
// proyecto se DERIVA del "public_token" que ya existe, con HMAC usando JWT_SECRET (nunca sale del
// backend) como clave. Solo quien tiene JWT_SECRET puede calcular el secreto correcto — y ESO es
// justamente lo único que se inyecta al proceso de preview SIN prefijo VITE_ (ver previewEnv.js),
// así que Vite nunca lo bundlea al navegador aunque el resto del proyecto sí sea público.
function computeAdminSecret(publicToken) {
  return crypto.createHmac('sha256', config.jwtSecret).update(`db-admin:${publicToken}`).digest('hex')
}

export function verifyAdminSecret(publicToken, providedSecret) {
  if (!publicToken || !providedSecret) return false
  const expected = Buffer.from(computeAdminSecret(publicToken))
  const given = Buffer.from(String(providedSecret))
  return expected.length === given.length && crypto.timingSafeEqual(expected, given)
}

// Solo se usa para inyectar el secreto al arrancar un preview (previewEnv.js) — nunca se manda a
// ninguna ruta HTTP como respuesta.
export { computeAdminSecret }

// Mismo rol/contraseña que ya usa vpsPostgres.js para aprovisionar bases (VPS_PG_ADMIN_URL), solo
// que apuntando a la base puntual de este proyecto en vez de la de mantenimiento. "flowpro_admin"
// necesita el atributo BYPASSRLS (se otorga una sola vez, fuera de este código — ver notas de
// deploy) para que esto realmente salte las políticas RLS y no solo actúe como el dueño.
export function buildAdminConnectionString(databaseName) {
  if (!config.vpsPgAdminUrl) throw new Error('VPS_PG_ADMIN_URL no está configurado en este servidor.')
  const url = new URL(config.vpsPgAdminUrl)
  url.pathname = `/${databaseName}`
  return url.toString()
}

// Verifica el JWT de sesión de un usuario final (emitido por signUp/signIn) contra el
// auth_secret de ESE proyecto puntual — nunca el JWT_SECRET de la plataforma. Devuelve el user
// id, o null si no hay token / es inválido / venció.
export function verifyAuthToken(token, authSecret) {
  if (!token || !authSecret) return null
  try {
    return jwt.verify(token, authSecret).sub
  } catch {
    return null
  }
}

// Si "userId" viene (sesión válida), la query corre dentro de una transacción con
// set_config('app.user_id', ...) cargado — así current_user_id() lo ve del lado de Postgres.
// set_config() (no un "SET" de texto) es lo que permite pasar el valor como parámetro bindeado
// en vez de interpolarlo en el SQL.
async function withClient(connectionString, fn, userId) {
  const client = new Client({ connectionString })
  await client.connect()
  try {
    if (userId) {
      await client.query('BEGIN')
      await client.query('SELECT set_config($1, $2, true)', ['app.user_id', userId])
    }
    const result = await fn(client)
    if (userId) await client.query('COMMIT')
    return result
  } catch (err) {
    if (userId) await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    await client.end()
  }
}

// Ninguna tabla/columna que venga de la request (nombre de tabla, columnas de "select", claves
// de filtros o de "values") se interpola nunca directo en el SQL sin pasar antes por acá —
// valida contra information_schema de ESA base puntual antes de armar cualquier query, así una
// tabla/columna inventada nunca llega a formar parte del texto SQL.
async function loadColumns(client, table) {
  const { rows } = await client.query(
    `SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  )
  const map = new Map()
  for (const r of rows) {
    map.set(r.column_name, { dataType: r.data_type, udtName: r.udt_name })
  }
  return map
}

function formatColumnValue(colMeta, val) {
  if (val === undefined) return null
  if (colMeta && (colMeta.dataType === 'json' || colMeta.dataType === 'jsonb' || colMeta.udtName === 'json' || colMeta.udtName === 'jsonb')) {
    if (val !== null && typeof val === 'object') {
      return JSON.stringify(val)
    }
  }
  return val
}

// "isAdmin" lo pasa únicamente el proxy admin (arriba) — ahí SÍ es intencional poder tocar
// "_flowpro_users" directo (gestión de usuarios tipo auth.admin.* de Supabase); el proxy público
// nunca lo pasa, así que un public_token filtrado sigue sin poder ver hashes de contraseñas.
function assertValidTable(table, isAdmin = false) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table || '')) {
    throw new ProxyError(400, `Nombre de tabla inválido: "${table}"`)
  }
  if (!isAdmin && RESERVED_TABLES.has(table)) {
    throw new ProxyError(403, `"${table}" es una tabla interna — usá los endpoints de auth en su lugar.`)
  }
}

// Filtros vienen como query params "col=op.valor" (mismo formato que usa PostgREST/supabase-js),
// ej. "?id=eq.5&done=eq.true". Cada uno se valida contra las columnas reales antes de sumarse al
// WHERE, y el valor siempre viaja como parámetro ($1, $2…), nunca interpolado.
function parseFilters(query, columns) {
  const clauses = []
  const values = []
  for (const [key, raw] of Object.entries(query)) {
    if (['select', 'limit', 'order', 'offset', 'or'].includes(key)) continue
    const match = /^([a-z]+)\.(.*)$/.exec(raw)
    if (!match) throw new ProxyError(400, `Filtro inválido para "${key}": "${raw}" (formato esperado "operador.valor")`)
    const [, op, rawValue] = match
    if (!columns.has(key)) throw new ProxyError(400, `Columna desconocida: "${key}"`)
    if (op === 'is') {
      if (rawValue !== 'null' && rawValue !== 'not.null') throw new ProxyError(400, `Valor inválido para "is": "${rawValue}"`)
      clauses.push(`${quoteIdent(key)} IS ${rawValue === 'null' ? 'NULL' : 'NOT NULL'}`)
      continue
    }
    // ".in(col, [...])" del cliente (ver scaffold.js) — el valor viaja como array JSON en vez del
    // formato "(a,b,c)" de PostgREST para no tener que lidiar con comas/comillas dentro de un
    // valor; Postgres soporta "= ANY($1)" bindeando el array directo, sin armar una lista de
    // placeholders a mano.
    if (op === 'in') {
      const arr = parseJsonArray(rawValue)
      if (!arr) throw new ProxyError(400, `Valor inválido para "in" en "${key}": se espera un array JSON`)
      if (arr.length === 0) {
        clauses.push('FALSE') // IN de lista vacía nunca matchea ninguna fila, igual que en SQL/Supabase
        continue
      }
      values.push(arr)
      clauses.push(`${quoteIdent(key)} = ANY($${values.length})`)
      continue
    }
    // ".not(col, op, valor)" del cliente — niega el operador interno. "not.is.null" y
    // "not.in.(a,b,c)" son casos especiales (misma forma que PostgREST/supabase-js), el resto usa
    // "NOT (col OP $n)" genérico.
    if (op === 'not') {
      const inner = /^([a-z]+)\.(.*)$/.exec(rawValue)
      if (!inner) throw new ProxyError(400, `Filtro "not" inválido para "${key}": "${rawValue}"`)
      const [, innerOp, innerVal] = inner
      if (innerOp === 'is') {
        if (innerVal !== 'null' && innerVal !== 'not.null') throw new ProxyError(400, `Valor inválido para "not.is": "${innerVal}"`)
        clauses.push(`${quoteIdent(key)} IS ${innerVal === 'null' ? 'NOT NULL' : 'NULL'}`)
        continue
      }
      if (innerOp === 'in') {
        const arr = parseJsonArray(innerVal) || parsePgListLiteral(innerVal)
        if (!arr) throw new ProxyError(400, `Valor inválido para "not.in" en "${key}": se espera un array JSON o "(a,b,c)"`)
        if (arr.length === 0) continue // NOT IN () vacío: ninguna fila queda excluida, no suma condición
        values.push(arr)
        clauses.push(`${quoteIdent(key)} <> ALL($${values.length})`)
        continue
      }
      const innerSqlOp = OPERATORS[innerOp]
      if (!innerSqlOp) throw new ProxyError(400, `Operador desconocido en "not": "${innerOp}"`)
      values.push(innerVal)
      clauses.push(`NOT (${quoteIdent(key)} ${innerSqlOp} $${values.length})`)
      continue
    }
    const sqlOp = OPERATORS[op]
    if (!sqlOp) throw new ProxyError(400, `Operador desconocido: "${op}"`)
    values.push(rawValue)
    clauses.push(`${quoteIdent(key)} ${sqlOp} $${values.length}`)
  }
  return { clauses, values }
}

function parseJsonArray(raw) {
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : null
  } catch {
    return null
  }
}

// ".not(col, 'in', '(a,b,c)')" de supabase-js manda la lista ya formateada así (no un array JSON)
// — se soporta este formato también para no obligar a reescribir ese código.
function parsePgListLiteral(raw) {
  const m = /^\((.*)\)$/.exec(raw)
  if (!m) return null
  return m[1].split(',').map((s) => s.trim()).filter(Boolean)
}

// ".or('col1.op.val,col2.op.val')" del cliente — un OR de condiciones simples, mismo formato que
// PostgREST/supabase-js. Limitación conocida (igual que en Supabase real): un valor que contenga
// una coma literal rompe el split entre condiciones.
function parseOrFilter(orString, columns) {
  const clauses = []
  const values = []
  for (const part of orString.split(',')) {
    const m = /^([a-zA-Z_][a-zA-Z0-9_]*)\.([a-z]+)\.(.*)$/.exec(part.trim())
    if (!m) throw new ProxyError(400, `Filtro "or" inválido: "${part}"`)
    const [, col, op, rawValue] = m
    if (!columns.has(col)) throw new ProxyError(400, `Columna desconocida en "or": "${col}"`)
    const sqlOp = OPERATORS[op]
    if (!sqlOp) throw new ProxyError(400, `Operador desconocido en "or": "${op}"`)
    values.push(rawValue)
    clauses.push(`${quoteIdent(col)} ${sqlOp} $${values.length}`)
  }
  return { clause: clauses.length ? `(${clauses.join(' OR ')})` : null, values }
}

export async function runSelect(connectionString, table, query, userId, isAdmin = false) {
  assertValidTable(table, isAdmin)
  return withClient(connectionString, async (client) => {
    const columns = await loadColumns(client, table)
    if (columns.size === 0) {
      // En vez de tirar 404 (que hace que el frontend reintente infinitamente),
      // devolvemos un arreglo vacio amigable para simular que la tabla aun no tiene datos.
      return []
    }
    const selectCols = query.select && query.select !== '*'
      ? query.select.split(',').map((c) => c.trim())
      : null
    if (selectCols) {
      for (const c of selectCols) if (!columns.has(c)) throw new ProxyError(400, `Columna desconocida: "${c}"`)
    }
    const { clauses, values } = parseFilters(query, columns)

    if (query.or) {
      // Los placeholders del "or" siguen numerándose después de los que ya sumó parseFilters —
      // por eso se resuelve acá (con "values.length" ya conocido) y no dentro de parseFilters.
      const orResult = parseOrFilter(query.or, columns)
      if (orResult.clause) {
        const offset = values.length
        values.push(...orResult.values)
        clauses.push(orResult.clause.replace(/\$(\d+)/g, (_, n) => `$${Number(n) + offset}`))
      }
    }

    let sql = `SELECT ${selectCols ? selectCols.map(quoteIdent).join(', ') : '*'} FROM ${quoteIdent(table)}`
    if (clauses.length) sql += ` WHERE ${clauses.join(' AND ')}`

    if (query.order) {
      const [col, dir] = query.order.split('.')
      if (!columns.has(col)) throw new ProxyError(400, `Columna desconocida en "order": "${col}"`)
      sql += ` ORDER BY ${quoteIdent(col)} ${dir === 'desc' ? 'DESC' : 'ASC'}`
    }

    const limit = Math.min(parseInt(query.limit, 10) || DEFAULT_ROWS, MAX_ROWS)
    sql += ` LIMIT ${limit}`
    // "offset" (equivalente a .range(from, to) del lado del cliente, ver scaffold.js) — opcional,
    // no rompe ninguna consulta vieja que no lo mande.
    const offset = parseInt(query.offset, 10)
    if (Number.isFinite(offset) && offset > 0) sql += ` OFFSET ${offset}`

    const { rows } = await client.query(sql, values)
    return rows
  }, userId)
}

export async function runInsert(connectionString, table, body, userId, isAdmin = false) {
  assertValidTable(table, isAdmin)
  const rowsIn = Array.isArray(body) ? body : [body]
  if (rowsIn.length === 0) throw new ProxyError(400, 'Nada para insertar')

  return withClient(connectionString, async (client) => {
    const columns = await loadColumns(client, table)
    if (columns.size === 0) throw new ProxyError(404, `La tabla "${table}" no existe`)

    const keys = Object.keys(rowsIn[0])
    for (const k of keys) if (!columns.has(k)) throw new ProxyError(400, `Columna desconocida: "${k}"`)

    const values = []
    const tuples = rowsIn.map((row) => {
      const placeholders = keys.map((k) => {
        values.push(formatColumnValue(columns.get(k), row[k]))
        return `$${values.length}`
      })
      return `(${placeholders.join(', ')})`
    })

    const sql = `INSERT INTO ${quoteIdent(table)} (${keys.map(quoteIdent).join(', ')}) VALUES ${tuples.join(', ')} RETURNING *`
    const { rows } = await client.query(sql, values)
    return rows
  }, userId)
}

// Columnas de la primary key de una tabla — usado como default de "on_conflict" cuando
// ".upsert(row)" no especifica una (mismo comportamiento que supabase-js/PostgREST).
async function getPrimaryKeyColumns(client, table) {
  const { rows } = await client.query(
    `SELECT a.attname AS column_name
     FROM pg_index i
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE i.indrelid = $1::regclass AND i.indisprimary`,
    [table],
  )
  return rows.map((r) => r.column_name)
}

// ".upsert(row, { onConflict: 'col1,col2' })" del cliente — INSERT ... ON CONFLICT (...) DO
// UPDATE, actualizando todas las columnas del row salvo las del conflicto (mismo default que
// supabase-js). Sin "onConflictCols", usa la primary key real de la tabla.
export async function runUpsert(connectionString, table, body, onConflictCols, userId, isAdmin = false) {
  assertValidTable(table, isAdmin)
  const rowsIn = Array.isArray(body) ? body : [body]
  if (rowsIn.length === 0) throw new ProxyError(400, 'Nada para upsertear')

  return withClient(connectionString, async (client) => {
    const columns = await loadColumns(client, table)
    if (columns.size === 0) throw new ProxyError(404, `La tabla "${table}" no existe`)

    let conflictCols = onConflictCols
      ? String(onConflictCols).split(',').map((c) => c.trim()).filter(Boolean)
      : await getPrimaryKeyColumns(client, table)
    for (const c of conflictCols) if (!columns.has(c)) throw new ProxyError(400, `Columna desconocida en "on_conflict": "${c}"`)
    if (conflictCols.length === 0) {
      throw new ProxyError(400, `"${table}" no tiene primary key — especificá "onConflict" explícitamente en el upsert`)
    }

    const keys = Object.keys(rowsIn[0])
    for (const k of keys) if (!columns.has(k)) throw new ProxyError(400, `Columna desconocida: "${k}"`)

    const values = []
    const tuples = rowsIn.map((row) => {
      const placeholders = keys.map((k) => {
        values.push(formatColumnValue(columns.get(k), row[k]))
        return `$${values.length}`
      })
      return `(${placeholders.join(', ')})`
    })

    const updateCols = keys.filter((k) => !conflictCols.includes(k))
    const setClause = updateCols.length
      ? updateCols.map((k) => `${quoteIdent(k)} = EXCLUDED.${quoteIdent(k)}`).join(', ')
      : null

    const sql = `INSERT INTO ${quoteIdent(table)} (${keys.map(quoteIdent).join(', ')}) VALUES ${tuples.join(', ')}
      ON CONFLICT (${conflictCols.map(quoteIdent).join(', ')}) ${setClause ? `DO UPDATE SET ${setClause}` : 'DO NOTHING'}
      RETURNING *`
    const { rows } = await client.query(sql, values)
    return rows
  }, userId)
}

export async function runUpdate(connectionString, table, body, query, userId, isAdmin = false) {
  assertValidTable(table, isAdmin)
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ProxyError(400, 'El body debe ser un objeto')

  return withClient(connectionString, async (client) => {
    const columns = await loadColumns(client, table)
    if (columns.size === 0) throw new ProxyError(404, `La tabla "${table}" no existe`)

    const { clauses, values } = parseFilters(query, columns)
    // Sin filtro, un UPDATE tocaría la tabla entera — a diferencia de Supabase (que ya bloquea
    // esto por RLS de por sí), acá no hay otra red de seguridad, así que se exige explícitamente.
    if (clauses.length === 0) throw new ProxyError(400, 'Un update necesita al menos un filtro (ej. "?id=eq.5")')

    const setKeys = Object.keys(body)
    for (const k of setKeys) if (!columns.has(k)) throw new ProxyError(400, `Columna desconocida: "${k}"`)

    const setClauses = setKeys.map((k) => {
      values.push(formatColumnValue(columns.get(k), body[k]))
      return `${quoteIdent(k)} = $${values.length}`
    })

    // Los $N de "pg" se resuelven por posición en el array "values", no por dónde aparecen en el
    // texto — no importa que el WHERE (con los primeros N índices, de "parseFilters") quede
    // después del SET (con los índices siguientes) en el SQL.
    const sql = `UPDATE ${quoteIdent(table)} SET ${setClauses.join(', ')} WHERE ${clauses.join(' AND ')} RETURNING *`
    const { rows } = await client.query(sql, values)
    return rows
  }, userId)
}

export async function runDelete(connectionString, table, query, userId, isAdmin = false) {
  assertValidTable(table, isAdmin)
  return withClient(connectionString, async (client) => {
    const columns = await loadColumns(client, table)
    if (columns.size === 0) throw new ProxyError(404, `La tabla "${table}" no existe`)

    const { clauses, values } = parseFilters(query, columns)
    if (clauses.length === 0) throw new ProxyError(400, 'Un delete necesita al menos un filtro (ej. "?id=eq.5")')

    const sql = `DELETE FROM ${quoteIdent(table)} WHERE ${clauses.join(' AND ')} RETURNING *`
    const { rows } = await client.query(sql, values)
    return rows
  }, userId)
}

// Nombre de función válido en Postgres sin comillar — mismo criterio que assertValidTable, pero
// separado (una función NO puede estar en RESERVED_TABLES, ese chequeo no aplica acá).
function assertValidIdentifier(name, kind) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name || '')) {
    throw new ProxyError(400, `Nombre de ${kind} inválido: "${name}"`)
  }
}

// Parámetros REALES de una función (por nombre y posición ordinal) desde information_schema —
// se valida el "params" que mandó el cliente contra esto antes de armar la llamada, igual que
// loadColumns valida columnas: un nombre de parámetro inventado nunca llega a formar parte del
// SQL. pg_proc.proargnames (vía information_schema.parameters) es lo único confiable acá: una
// función puede tener parámetros con default, y supabase-js/PostgREST llaman por NOMBRE
// (fn(param := valor)), no por posición, así que hace falta el nombre real de cada uno.
async function loadFunctionParams(client, fnName) {
  const { rows } = await client.query(
    `SELECT parameter_name FROM information_schema.parameters
     WHERE specific_schema = 'public' AND specific_name IN (
       SELECT specific_name FROM information_schema.routines
       WHERE routine_schema = 'public' AND routine_name = $1 AND routine_type = 'FUNCTION'
     )
     ORDER BY ordinal_position`,
    [fnName],
  )
  return rows.map((r) => r.parameter_name).filter(Boolean)
}

// Equivalente de "supabase.rpc(fnName, params)": llama una función SQL real (creada por la IA
// vía propose_db_change, ej. "has_role", o cualquier lógica de negocio) por nombre, con
// parámetros nombrados — misma forma de uso que supabase-js, para no obligar a reescribir el
// código de la app que ya llama funciones así. "SELECT * FROM fn(...)" funciona tanto para
// funciones que devuelven una tabla/set como para las que devuelven un escalar (Postgres arma
// una sola columna en ese caso) — no hace falta distinguir de antemano cuál es cuál.
export async function runRpc(connectionString, fnName, params, userId) {
  assertValidIdentifier(fnName, 'función')
  const args = params && typeof params === 'object' && !Array.isArray(params) ? params : {}

  return withClient(connectionString, async (client) => {
    const { rows: existsRows } = await client.query(
      `SELECT 1 FROM information_schema.routines WHERE routine_schema = 'public' AND routine_name = $1 AND routine_type = 'FUNCTION'`,
      [fnName],
    )
    if (existsRows.length === 0) throw new ProxyError(404, `La función "${fnName}" no existe`)

    const realParams = await loadFunctionParams(client, fnName)
    const values = []
    const callArgs = []
    for (const [key, value] of Object.entries(args)) {
      if (!realParams.includes(key)) throw new ProxyError(400, `Parámetro desconocido en "${fnName}": "${key}"`)
      values.push(value === undefined ? null : value)
      callArgs.push(`${quoteIdent(key)} := $${values.length}`)
    }

    const sql = `SELECT * FROM ${quoteIdent(fnName)}(${callArgs.join(', ')})`
    const { rows } = await client.query(sql, values)
    return rows
  }, userId)
}

// --- Auth de usuarios finales de la app (no confundir con las cuentas de FlowPro) ---
// "_flowpro_users" vive en la base de CADA proyecto (bootstrap en vpsPostgres.js), separado de
// todo lo demás. El JWT se firma con el "auth_secret" de ESE proyecto — nunca con el JWT_SECRET
// de la plataforma.

export async function signUp(connectionString, authSecret, email, password) {
  if (!EMAIL_RE.test(email || '')) throw new ProxyError(400, 'Email inválido')
  if (!password || password.length < 6) throw new ProxyError(400, 'La contraseña debe tener al menos 6 caracteres')

  const client = new Client({ connectionString })
  await client.connect()
  try {
    const hash = await bcrypt.hash(password, 10)
    let row
    try {
      const { rows } = await client.query(
        'INSERT INTO _flowpro_users (email, password_hash) VALUES ($1, $2) RETURNING id, email, created_at',
        [email.toLowerCase().trim(), hash],
      )
      row = rows[0]
    } catch (err) {
      if (err.code === '23505') throw new ProxyError(409, 'Ya existe una cuenta con ese email')
      throw err
    }
    const token = jwt.sign({ sub: row.id }, authSecret, { expiresIn: AUTH_TOKEN_EXPIRY })
    return { user: row, token }
  } finally {
    await client.end()
  }
}

export async function signIn(connectionString, authSecret, email, password) {
  const client = new Client({ connectionString })
  await client.connect()
  try {
    const { rows } = await client.query(
      'SELECT id, email, password_hash, created_at FROM _flowpro_users WHERE email = $1',
      [(email || '').toLowerCase().trim()],
    )
    const user = rows[0]
    if (!user || !(await bcrypt.compare(password || '', user.password_hash))) {
      throw new ProxyError(401, 'Email o contraseña incorrectos')
    }
    delete user.password_hash
    const token = jwt.sign({ sub: user.id }, authSecret, { expiresIn: AUTH_TOKEN_EXPIRY })
    return { user, token }
  } finally {
    await client.end()
  }
}

export async function getUserById(connectionString, userId) {
  if (!userId) return null
  const client = new Client({ connectionString })
  await client.connect()
  try {
    const { rows } = await client.query('SELECT id, email, created_at FROM _flowpro_users WHERE id = $1', [userId])
    return rows[0] || null
  } finally {
    await client.end()
  }
}

// --- Gestión de usuarios server-only (equivalente de "supabaseAdmin.auth.admin.*") ---
// Solo se llega acá a través del proxy admin (routes/dbAdminProxy.js, gateado por el secreto
// derivado de arriba) — nunca expuesto al público. "password_hash" nunca sale de estas funciones.

export async function adminListUsers(connectionString) {
  const client = new Client({ connectionString })
  await client.connect()
  try {
    const { rows } = await client.query('SELECT id, email, created_at FROM _flowpro_users ORDER BY created_at DESC')
    return rows
  } finally {
    await client.end()
  }
}

// "email_confirm"/"user_metadata" de Supabase no tienen equivalente en "_flowpro_users" (no hay
// tabla de metadata ni de confirmación de email acá) — se ignoran en silencio, el resto del
// comportamiento (crear usuario con password ya hasheado) es igual que signUp.
export async function adminCreateUser(connectionString, email, password) {
  if (!EMAIL_RE.test(email || '')) throw new ProxyError(400, 'Email inválido')
  const client = new Client({ connectionString })
  await client.connect()
  try {
    const hash = await bcrypt.hash(password || crypto.randomBytes(16).toString('hex'), 10)
    try {
      const { rows } = await client.query(
        'INSERT INTO _flowpro_users (email, password_hash) VALUES ($1, $2) RETURNING id, email, created_at',
        [email.toLowerCase().trim(), hash],
      )
      return rows[0]
    } catch (err) {
      if (err.code === '23505') throw new ProxyError(409, 'Ya existe una cuenta con ese email')
      throw err
    }
  } finally {
    await client.end()
  }
}

export async function adminDeleteUser(connectionString, userId) {
  const client = new Client({ connectionString })
  await client.connect()
  try {
    await client.query('DELETE FROM _flowpro_users WHERE id = $1', [userId])
  } finally {
    await client.end()
  }
}

// Equivalente best-effort de "auth.admin.generateLink({type:'magiclink', email})": no existe un
// flujo de verificación de email propio (Supabase Auth lo resuelve con su propio backend), así
// que el "link" es directamente un JWT de sesión válido (mismo formato que emite signIn) pegado
// como query param — el frontend necesita leerlo y guardarlo como sesión (ver auth.setSessionFromToken
// en scaffold.js). Sirve para el caso de uso real (admin manda un link para que el usuario entre
// sin poner contraseña), no para un flujo de verificación de email genuino.
export async function adminGenerateLink(connectionString, authSecret, email, redirectTo) {
  const client = new Client({ connectionString })
  await client.connect()
  let user
  try {
    const { rows } = await client.query('SELECT id, email FROM _flowpro_users WHERE email = $1', [(email || '').toLowerCase().trim()])
    user = rows[0]
  } finally {
    await client.end()
  }
  if (!user) throw new ProxyError(404, 'No existe un usuario con ese email')
  const token = jwt.sign({ sub: user.id }, authSecret, { expiresIn: '1h' })
  const base = redirectTo || ''
  const actionLink = `${base}${base.includes('?') ? '&' : '?'}flowpro_token=${token}`
  return { actionLink, properties: { actionLink } }
}
