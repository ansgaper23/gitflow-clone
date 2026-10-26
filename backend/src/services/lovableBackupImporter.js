import AdmZip from 'adm-zip'
import { runSql } from './repoDb.js'
import { getServiceRoleKey } from './supabaseStorage.js'
import { stripSupabaseInternalDDL, translateSupabaseAuthSql } from './sqlAuthTranslator.js'

// Backup de Lovable: NO es un dump SQL (pg_dump) como los que ya maneja dbImport.js — es un
// .zip con "database/backup_lovable.json" ({ tabla: [fila, fila, ...] }, TODAS las tablas
// incluidas aunque estén vacías) más una copia redundante en CSV por tabla. No trae ningún DDL
// (ni CREATE TABLE, ni tipos de columna, ni foreign keys) — solo los datos — así que el esquema
// se infiere de los valores reales, columna por columna.
const BACKUP_JSON_ENTRY = 'database/backup_lovable.json'

export function isLovableBackupZip(buffer) {
  try {
    const zip = new AdmZip(buffer)
    return zip.getEntries().some((e) => e.entryName === BACKUP_JSON_ENTRY)
  } catch {
    return false
  }
}

export function parseLovableBackup(buffer) {
  const zip = new AdmZip(buffer)
  const entry = zip.getEntry(BACKUP_JSON_ENTRY)
  if (!entry) throw new Error(`No se encontró "${BACKUP_JSON_ENTRY}" dentro del .zip`)
  const tables = JSON.parse(entry.getData().toString('utf-8'))
  if (!tables || typeof tables !== 'object' || Array.isArray(tables)) {
    throw new Error('El formato de "backup_lovable.json" no es el esperado (se esperaba un objeto {tabla: [filas]})')
  }
  return tables
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
// ISO 8601 con offset o "Z" — así es como Postgres/Supabase serializa timestamptz en JSON.
const TIMESTAMPTZ_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

// Sin DDL en el backup, el tipo de cada columna se infiere mirando TODOS los valores no-nulos
// que tiene en las filas reales — mejor esfuerzo, no perfecto (ej. no hay forma de saber si un
// array de strings "debería" ser text[] o jsonb en el esquema original; se elige jsonb porque
// es más flexible y nunca falla al insertar). Ver agent.js/dbClientHint para lo que se le avisa
// al usuario sobre esta limitación en el mensaje de resultado.
function inferColumnType(values) {
  const nonNull = values.filter((v) => v !== null && v !== undefined)
  if (nonNull.length === 0) return 'text'

  if (nonNull.every((v) => typeof v === 'boolean')) return 'boolean'
  if (nonNull.every((v) => typeof v === 'number')) {
    return nonNull.every((v) => Number.isInteger(v)) ? 'integer' : 'numeric'
  }
  if (nonNull.every((v) => Array.isArray(v) || (typeof v === 'object' && v !== null))) return 'jsonb'
  if (nonNull.every((v) => typeof v === 'string' && UUID_RE.test(v))) return 'uuid'
  if (nonNull.every((v) => typeof v === 'string' && TIMESTAMPTZ_RE.test(v))) return 'timestamptz'
  return 'text'
}

// { columns: [{ name, pgType, nullable }], primaryKey: 'id' | null }
export function inferTableSchema(rows) {
  const columnNames = new Set()
  for (const row of rows) for (const key of Object.keys(row)) columnNames.add(key)

  const columns = [...columnNames].map((name) => {
    const values = rows.map((r) => r[name])
    return {
      name,
      pgType: inferColumnType(values),
      nullable: rows.length === 0 || values.some((v) => v === null || v === undefined),
    }
  })

  // "id" con pinta de uuid en todas las filas = casi siempre la primary key real en un proyecto
  // Supabase/Lovable (son los que usan gen_random_uuid() por default en casi todas las tablas).
  const idCol = columns.find((c) => c.name === 'id')
  const primaryKey = idCol && idCol.pgType === 'uuid' && !idCol.nullable ? 'id' : null

  return { columns, primaryKey }
}

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`
}

function sqlLiteral(value, pgType) {
  if (value === null || value === undefined) return 'NULL'
  if (pgType === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (pgType === 'integer' || pgType === 'numeric') return String(value)
  if (pgType === 'jsonb') {
    const json = JSON.stringify(value)
    return `'${json.replace(/'/g, "''")}'::jsonb`
  }
  // text/uuid/timestamptz: todos van como literal de texto entre comillas simples — el único
  // caracter que hace falta escapar en un literal estándar de Postgres es la comilla simple
  // (duplicarla), ya que "standard_conforming_strings" viene activado por default desde hace
  // años y las barras invertidas no son caracter de escape.
  return `'${String(value).replace(/'/g, "''")}'`
}

// "created_at"/"updated_at" sin default (aunque vengan "not null" porque el backup no tenía
// ninguna fila con null) rompe cualquier insert nuevo de la app en cuanto no manda esa columna a
// mano — que es exactamente cómo se usa siempre en la práctica (Supabase la completa sola). Se
// detecta por NOMBRE (no alcanza con el tipo: una columna real de fecha de usuario, ej.
// "fecha_nacimiento", también puede inferirse timestamptz y NO debería auto-completarse sola).
const AUTO_NOW_COLUMNS = new Set(['created_at', 'updated_at'])

function buildCreateTableSql(tableName, schema) {
  const cols = schema.columns.map((c) => {
    // Solo la primary key queda "not null" en la tabla creada — el resto nace opcional aunque
    // el backup no tuviera ningún null observado. "Sin nulls en la muestra" no es lo mismo que
    // "la app SIEMPRE va a mandar un valor": un alta nueva del código real (no del backup)
    // fácilmente no completa un campo que en Supabase se llenaba con un trigger/RPC propio que
    // nunca se exportó (visto en producción: "profiles.referral_code" tenía las 801 filas
    // completas pero bloqueaba cualquier registro nuevo). Mejor un esquema más permisivo que un
    // alta que falla.
    const pk = schema.primaryKey === c.name ? ' primary key not null' : ''
    const def = c.pgType === 'timestamptz' && AUTO_NOW_COLUMNS.has(c.name) ? ' default now()' : ''
    return `  ${quoteIdent(c.name)} ${c.pgType}${def}${pk}`
  })
  return `create table if not exists ${quoteIdent(tableName)} (\n${(Array.isArray(cols) ? cols : []).join(',\n')}\n);`
}

const INSERT_BATCH_SIZE = 200

function buildInsertStatements(tableName, schema, rows) {
  if (rows.length === 0) return []
  const colNames = schema.columns.map((c) => c.name)
  const statements = []
  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + INSERT_BATCH_SIZE)
    const tuples = batch.map((row) => `(${schema.columns.map((c) => sqlLiteral(row[c.name], c.pgType)).join(', ')})`)
    statements.push(
      `insert into ${quoteIdent(tableName)} (${colNames.map(quoteIdent).join(', ')}) values\n${tuples.join(',\n')};`,
    )
  }
  return statements
}

// "Flow Migrador PRO" (la herramienta de export, ver README_EXPORT.md de un backup real) puede
// traer también "database/table_schema.sql" — el esquema REAL de las tablas (tipos reales,
// defaults, enums), sacado de information_schema en vez de inferido de una muestra de datos.
// Cuando está, se usa esto para el CREATE TABLE en vez de adivinar — misma calidad que un
// pg_dump --schema-only, pero generado por este export específico.
const REAL_SCHEMA_ENTRY = 'database/table_schema.sql'

// null si el .zip no trae el archivo (backups viejos, o de otra herramienta) — el llamador cae
// de vuelta a inferir de los datos, como siempre.
export function extractRealTableSchemaSql(zipBuffer) {
  try {
    const entry = new AdmZip(zipBuffer).getEntry(REAL_SCHEMA_ENTRY)
    return entry ? entry.getData().toString('utf-8') : null
  } catch {
    return null
  }
}

// Igual que con las tablas inferidas (ver buildCreateTableSql): una columna real "NOT NULL" sin
// "DEFAULT" puede depender de un trigger/RPC de Supabase que no se migra — se relaja iguial para
// no bloquear altas nuevas, PERO solo si no tiene su propio default (con default es sano dejarla
// obligatoria, Postgres la completa solo). La primary key no se toca: "PRIMARY KEY (...)" ya la
// fuerza a NOT NULL de por sí, quitarle las palabras del lado de la columna no cambia nada.
function relaxNotNullWithoutDefault(createTableSql) {
  return createTableSql
    .split('\n')
    .map((line) => (/\bDEFAULT\b/i.test(line) ? line : line.replace(/\s*\bNOT\s+NULL\b/gi, '')))
    .join('\n')
}

// { preambleStatements: [...CREATE TYPE, etc.], tableStatements: Map<tableNameLowerCase, sql> }
// Statements separados por ";" a secas alcanza acá: este archivo es puro CREATE TYPE/CREATE
// TABLE (según su propio encabezado), nunca trae una función con cuerpo "$$...$$" que pudiera
// tener un ";" adentro.
export function parseRealTableSchema(schemaSql) {
  const chunks = schemaSql
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)

  const preambleStatements = []
  const tableStatements = new Map()
  const tableNameRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?public"?\.)?"?(\w+)"?\s*\(/i

  for (const chunk of chunks) {
    const stmt = `${chunk};`
    const match = tableNameRe.exec(stmt)
    if (match) {
      tableStatements.set(match[1].toLowerCase(), relaxNotNullWithoutDefault(stmt))
    } else if (/create\s+type|create\s+extension/i.test(stmt)) {
      preambleStatements.push(stmt)
    }
    // Cualquier otro chunk (solo comentarios sueltos entre bloques, sin ningún CREATE) se
    // descarta — no aporta nada para ejecutar.
  }

  return { preambleStatements, tableStatements }
}

// "Flow Migrador PRO" (exportador hecho a medida para FlowPro, no el export nativo de Lovable)
// además del backup de datos de siempre trae, en el mismo .zip, el DDL real de funciones/RLS/
// triggers del proyecto — justo lo que un backup de datos NUNCA trae (ver
// supabaseReferenceScanner.js#scanForMissingRpcFunctions, construido porque esto faltaba: la IA
// tenía que ADIVINAR funciones como "has_role()" en vez de tenerlas ya). Si estos archivos están
// presentes, se aplican solos como parte del import — no hace falta que la IA reconstruya nada.
const SCHEMA_DDL_ENTRIES = {
  master: 'database/full_schema_structure.sql',
  functions: 'database/postgres_functions.sql',
  rls: 'database/rls_policies.sql',
  triggers: 'database/triggers.sql',
}
const SECRETS_JSON_ENTRY = 'secrets/secrets.json'

function readZipEntry(zipBuffer, entryName) {
  try {
    const entry = new AdmZip(zipBuffer).getEntry(entryName)
    return entry ? entry.getData().toString('utf-8') : null
  } catch {
    return null
  }
}

// Prefiere el archivo maestro (funciones+RLS+triggers ya combinados) — si no está, concatena los
// 3 por separado. Nunca los dos a la vez: correrían cada función/política/trigger dos veces.
export function extractSchemaDDL(zipBuffer) {
  const master = readZipEntry(zipBuffer, SCHEMA_DDL_ENTRIES.master)
  if (master) return master
  const parts = [SCHEMA_DDL_ENTRIES.functions, SCHEMA_DDL_ENTRIES.rls, SCHEMA_DDL_ENTRIES.triggers]
    .map((name) => readZipEntry(zipBuffer, name))
    .filter(Boolean)
  return parts.length ? parts.join('\n\n') : null
}

// Nombres (no valores — Lovable nunca los expone vía ninguna API, confirmado) de los secrets que
// el proyecto original tenía configurados — para dejarlos ya "reservados" en FlowPro (Publicar >
// Secrets de servidor) con un valor vacío, en vez de que el usuario los descubra de a uno cuando
// una pantalla puntual falle con "X no configurada" (pasó de verdad con NEXUS_ADMIN_API_KEY).
// Excluye los que administra el propio Lovable (ej. LOVABLE_API_KEY) — no le sirven a la app.
export function extractLovableSecretNames(zipBuffer) {
  const raw = readZipEntry(zipBuffer, SECRETS_JSON_ENTRY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return (parsed.lovable_secrets || [])
      .filter((s) => s.is_user_secret && s.name && /^[A-Za-z_][A-Za-z0-9_]*$/.test(s.name) && !s.name.startsWith('SUPABASE_'))
      .map((s) => s.name)
  } catch {
    return []
  }
}

// A DIFERENCIA de "lovable_secrets" (nombre nada más — Lovable nunca expone el valor), los de
// Supabase Vault SÍ vienen con el valor real: el exportador arma una vista temporal sobre
// "vault.decrypted_secrets"/"vault.secrets" (ver su script SQL) para poder leerlos por la REST
// API, y la borra al terminar — el valor que llega acá es el secreto de verdad, no un
// placeholder. Se puede aplicar directo en vez de solo reservar el nombre.
export function extractVaultSecrets(zipBuffer) {
  const raw = readZipEntry(zipBuffer, SECRETS_JSON_ENTRY)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return (parsed.vault_secrets || [])
      .filter((s) => s.name && s.decrypted_secret != null && /^[A-Za-z_][A-Za-z0-9_]*$/.test(s.name))
      .map((s) => ({ name: s.name, value: String(s.decrypted_secret) }))
  } catch {
    return []
  }
}

// El manifiesto SIEMPRE está presente si el zip trae la carpeta "edge_functions/" (aunque sea
// vacío, ver deploy_instructions.md del propio exportador) — pero el CÓDIGO de cada función
// puede faltar: la API de Lovable que lo expone no siempre lo devuelve (confirmado con un
// backup real: el manifiesto listaba 2 funciones con sus paths, pero los ".ts" pesaban 0 bytes).
// Nunca hay que asumir que "aparece en el manifiesto" == "hay código para recrearla".
const EDGE_FUNCTIONS_MANIFEST_ENTRY = 'edge_functions/functions_manifest.json'

// { functions: [{ name, files: [{ path, content }] }], namesOnly: string[] } — "namesOnly" son
// las funciones de las que solo se pudo recuperar el nombre (sin código real que copiar).
export function extractEdgeFunctions(zipBuffer) {
  const raw = readZipEntry(zipBuffer, EDGE_FUNCTIONS_MANIFEST_ENTRY)
  if (!raw) return null
  let manifest
  try {
    manifest = JSON.parse(raw)
  } catch {
    return null
  }
  const names = manifest.functions || []
  if (names.length === 0) return { functions: [], namesOnly: [] }

  const zip = new AdmZip(zipBuffer)
  const byFunction = new Map(names.map((n) => [n, []]))
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    const match = /^edge_functions\/([^/]+)\/(.+)$/.exec(entry.entryName)
    if (!match) continue
    const [, fnName, filePath] = match
    if (!byFunction.has(fnName)) continue
    const content = entry.getData().toString('utf-8')
    if (content.trim()) byFunction.get(fnName).push({ path: filePath, content })
  }

  const functions = []
  const namesOnly = []
  for (const name of names) {
    const files = byFunction.get(name) || []
    if (files.length > 0) functions.push({ name, files })
    else namesOnly.push(name)
  }
  return { functions, namesOnly }
}

// "CREATE POLICY"/"CREATE TRIGGER" no soportan "OR REPLACE" (a diferencia de "CREATE OR REPLACE
// FUNCTION", que ya es idempotente de por sí) — sin esto, reimportar el mismo backup una segunda
// vez (pasó de verdad hoy, con la migración de auth) rompería TODO el bloque de golpe con "ya
// existe" apenas la primera política/trigger repetido. Le antepone su propio DROP IF EXISTS.
function makeSchemaDdlIdempotent(sql) {
  let out = sql.replace(
    /CREATE\s+POLICY\s+("(?:[^"]|"")*")\s+ON\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)/gi,
    (full, name, table) => `DROP POLICY IF EXISTS ${name} ON ${table};\n${full}`,
  )
  out = out.replace(
    /CREATE\s+TRIGGER\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)([\s\S]*?)\bON\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)/gi,
    (full, name, mid, table) => `DROP TRIGGER IF EXISTS ${name} ON ${table};\n${full}`,
  )
  // "CREATE TYPE ... AS ENUM" no tiene equivalente a "CREATE OR REPLACE"/"IF NOT EXISTS" en
  // Postgres, y a diferencia de policies/triggers no conviene resolverlo con un DROP previo (un
  // DROP TYPE de un enum en uso arrastra (CASCADE) las columnas que lo usan). Ante una
  // reimportación del mismo backup (retry tras un error a mitad de camino, o reconectar el mismo
  // repo a una base que ya tiene este esquema) esto es lo único que faltaba para que
  // applySchemaDDL sea idempotente de punta a punta — se envuelve en un DO block que ignora
  // "ya existe" y deja cualquier otro error real sin silenciar.
  out = out.replace(
    /CREATE\s+TYPE\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)\s+AS\s+ENUM\s*\([^;]*\)\s*;/gi,
    (full) => `DO $do$ BEGIN\n${full}\nEXCEPTION WHEN duplicate_object THEN NULL;\nEND $do$;`,
  )
  return out
}

// Corre el DDL de funciones/RLS/triggers contra la conexión ya resuelta — mismo tratamiento para
// los dos destinos posibles:
// - SIEMPRE saca la infraestructura interna de Supabase (funciones/triggers/políticas propios de
//   "auth"/"storage"/etc., ver sqlAuthTranslator.js#stripSupabaseInternalDDL) — nunca tiene
//   sentido recrearla, ni siquiera yendo a OTRO Supabase real (ya la trae de fábrica, y
//   sobreescribirla a ciegas es un riesgo innecesario para cero beneficio).
// - SOLO si el destino es Flow Cloud, además traduce las referencias a "auth.uid()"/"auth.email()"
//   que sí queden (ver translateSupabaseAuthSql) — yendo a Supabase real esas funciones existen
//   tal cual, traducirlas ahí sería lo que rompería el SQL, no lo que lo arregla.
export async function applySchemaDDL(conn, rawSql) {
  const stripped = stripSupabaseInternalDDL(rawSql, Boolean(conn.isVps))
  let sql = stripped.sql
  let authReplacedCount = 0
  let roleReplacedCount = 0
  let authWarnings = []
  if (conn.isVps) {
    const translated = translateSupabaseAuthSql(sql)
    sql = translated.sql
    authReplacedCount = translated.replacedCount
    roleReplacedCount = translated.roleReplacedCount
    authWarnings = translated.warnings
  }
  sql = makeSchemaDdlIdempotent(sql)

  let ok = true
  let error = null
  if (sql.trim()) {
    try {
      await runSql(conn, sql)
    } catch (err) {
      ok = false
      error = err.message
    }
  }

  return {
    ok,
    error,
    skippedCount: stripped.skippedCount,
    skippedSamples: stripped.skippedSamples,
    translatedAuthTriggerFns: stripped.translatedAuthTriggerFns,
    sawUnresolvedAuthUsersTrigger: stripped.sawUnresolvedAuthUsersTrigger,
    authReplacedCount,
    roleReplacedCount,
    authWarnings,
  }
}

const AUTH_PASSWORD_COLS = ['encrypted_password', 'password_hash']

// "auth.users" de Supabase vive en un esquema protegido que Lovable NUNCA incluye en el backup
// (confirmado inspeccionando el formato real) — pero algunos proyectos arman a mano, ANTES de
// exportar, una tabla espejo en el esquema público (ej. vía un edge function propio tipo
// "migrate-helper") con los usuarios reales para poder migrarlos a otra plataforma. No se
// detecta por nombre (varía entre proyectos) sino por forma: id + email + un hash de contraseña
// con el nombre de columna que usa Supabase Auth o el de Flow Cloud.
function findAuthMirrorTable(tables) {
  for (const [name, rows] of Object.entries(tables)) {
    if (rows.length === 0) continue
    const sample = rows[0]
    const passwordCol = AUTH_PASSWORD_COLS.find((c) => c in sample)
    if ('id' in sample && 'email' in sample && passwordCol) return { tableName: name, rows, passwordCol }
  }
  return null
}

// Copia esa tabla a "_flowpro_users" (el login real de Flow Cloud, ver vpsPostgres.js) — el hash
// es bcrypt en los dos lados (Supabase Auth y bcryptjs implementan el mismo algoritmo estándar),
// así que se copia tal cual: los usuarios que ya existían pueden seguir entrando con la misma
// contraseña, sin tener que registrarse de nuevo. Se conserva el mismo "id" a propósito, para
// que las demás tablas importadas (ej. "profiles.id") sigan apuntando al usuario correcto.
// En lotes de a "INSERT_BATCH_SIZE" (una sola sentencia INSERT multi-fila por lote) — antes era
// una llamada a runSql POR FILA (801 llamadas para un backup normal), que además de lento
// arriesgaba pegarle al límite de tasa de la Management API de Supabase (ver runLovableBackupImport).
async function migrateAuthMirrorUsers(conn, mirror) {
  const valid = mirror.rows.filter((row) => row.id && row.email && row[mirror.passwordCol])
  let created = 0
  let failedBatches = 0
  for (let i = 0; i < valid.length; i += INSERT_BATCH_SIZE) {
    const batch = valid.slice(i, i + INSERT_BATCH_SIZE)
    const tuples = batch.map(
      (row) =>
        `(${sqlLiteral(row.id, 'uuid')}, ${sqlLiteral(String(row.email).toLowerCase().trim(), 'text')}, ${sqlLiteral(row[mirror.passwordCol], 'text')}, ${row.created_at ? sqlLiteral(row.created_at, 'timestamptz') : 'now()'})`,
    )
    const sql = `insert into _flowpro_users (id, email, password_hash, created_at) values\n${tuples.join(',\n')}\non conflict (email) do nothing`
    try {
      // "rowCount" (Flow Cloud siempre es conexión directa a Postgres, ver runSql) cuenta las
      // filas que de VERDAD se insertaron — el "on conflict do nothing" hace que un email
      // repetido no sume acá, a diferencia de contar "batch.length" a ciegas (que antes
      // reportaba como "migrado" incluso a los que en realidad se saltearon por ya existir).
      const result = await runSql(conn, sql)
      created += result.rowCount ?? 0
    } catch (err) {
      // Un lote con un dato raro (ej. un id repetido con datos distintos, algo fuera de forma)
      // no debería tirar abajo el resto del import — se cuenta aparte y se sigue con el
      // siguiente lote, en vez de perder TODOS los lotes que faltaban.
      failedBatches++
    }
  }
  return { created, failedBatches, total: valid.length }
}

// Equivalente de migrateAuthMirrorUsers, pero para cuando la conexión nueva es OTRO proyecto de
// Supabase real (oauth) — ahí no hay "_flowpro_users" propio a donde copiar, el destino es
// directamente el auth.users REAL de ese proyecto, vía su Admin API (Management API/SQL no
// puede tocar el esquema "auth" protegido). Confirmado contra la guía oficial de Supabase
// (migrating-to-supabase/auth0): admin.createUser() acepta "password_hash" (el bcrypt tal cual,
// sin re-hashear) y "id" (para preservar el mismo id que ya tienen las demás tablas importadas,
// ej. "profiles.id") — se crea la cuenta YA lista para entrar con la contraseña de siempre, sin
// resetear nada. A diferencia de la copia a Flow Cloud (una sola sentencia SQL en lotes), acá
// cada usuario es un request HTTP aparte al Admin API — no hay forma de hacerlo en lote — así
// que un usuario que falla no aborta a los demás, solo queda contado aparte.
async function migrateAuthMirrorUsersToSupabase(conn, mirror) {
  const serviceKey = await getServiceRoleKey(conn.accessToken, conn.projectRef)
  const adminUrl = `https://${conn.projectRef}.supabase.co/auth/v1/admin/users`

  // Por si el mismo mail aparece más de una vez en el espejo (backups re-importados encima de
  // uno viejo, por ejemplo) — se queda con la primera fila de cada email, Supabase de última
  // rechazaría el duplicado igual pero mejor no gastar el request.
  const seen = new Set()
  const valid = mirror.rows.filter((row) => {
    if (!row.id || !row.email || !row[mirror.passwordCol]) return false
    const email = String(row.email).toLowerCase().trim()
    if (seen.has(email)) return false
    seen.add(email)
    return true
  })

  let created = 0
  let existed = 0
  let failed = 0
  for (const row of valid) {
    try {
      const res = await fetch(adminUrl, {
        method: 'POST',
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: row.id,
          email: String(row.email).toLowerCase().trim(),
          password_hash: row[mirror.passwordCol],
          email_confirm: true,
        }),
      })
      if (res.ok) {
        created++
      } else {
        const data = await res.json().catch(() => ({}))
        if (res.status === 422 || /already been registered|already exists/i.test(data?.msg || data?.message || '')) {
          existed++
        } else {
          failed++
        }
      }
    } catch {
      failed++
    }
  }
  return { created, existed, failed, total: valid.length }
}

// Corre la creación de esquema + carga de datos completa contra la conexión ya resuelta (oauth
// o manual/vps — mismo "conn" que ya usa el resto de repoDb.js). Devuelve un resumen por tabla
// para armar el mensaje de resultado — nunca tira a mitad de camino sin avisar cuál tabla falló.
// "migrateAuthUsers" aplica a los dos destinos posibles, por caminos distintos: yendo a Flow
// Cloud copia a "_flowpro_users" (su propio login); yendo a otro proyecto de Supabase real
// (oauth) recrea las cuentas de verdad en SU auth.users vía Admin API — ver dbImport.js.
export async function runLovableBackupImport(conn, tables, { migrateAuthUsers = false, realSchema = null } = {}) {
  const results = []
  const authMirror = migrateAuthUsers ? findAuthMirrorTable(tables) : null
  let usedRealSchemaCount = 0

  // Los tipos/enums propios (ej. "CREATE TYPE app_role AS ENUM (...)") tienen que existir antes
  // de cualquier CREATE TABLE que los use — se corren una sola vez, aparte del loop por tabla.
  if (realSchema?.preambleStatements?.length) {
    try {
      await runSql(conn, realSchema.preambleStatements.join('\n'))
    } catch (err) {
      results.push({ table: 'tipos/enums propios', rows: 0, ok: false, error: err.message })
    }
  }

  for (const [tableName, rows] of Object.entries(tables)) {
    // El esquema real (si vino) decide el CREATE TABLE — mejor tipado que inferir de una
    // muestra (tipos exactos, defaults reales, enums). El formateo de cada valor en el INSERT
    // sigue basado en el JS real de cada fila (inferColumnType) sea cual sea el origen del
    // CREATE TABLE: un literal entre comillas o un booleano/número se castea solo al tipo real
    // de la columna gracias al cast de asignación implícito de Postgres, así que no hace falta
    // re-derivar tipos del DDL real para el INSERT.
    const schema = inferTableSchema(rows)
    const realCreateSql = realSchema?.tableStatements.get(tableName.toLowerCase())
    if (realCreateSql) usedRealSchemaCount++
    try {
      // Una sola llamada por tabla (CREATE + todos los lotes de INSERT juntos) en vez de una
      // por sentencia — con una tabla de 1000+ filas eran 6-7 llamadas solo para ella; sumado a
      // las ~20 tablas de un backup típico, se acumulaban decenas de llamadas a runSql. Contra
      // la Management API de Supabase (conexión oauth) eso arriesgaba pegarle a su límite de
      // tasa a mitad del import; contra Postgres directo (vps/manual) cada llamada abre y cierra
      // su propia conexión (ver withClient en repoDb.js), así que esto también evita ese costo.
      const createSql = realCreateSql || buildCreateTableSql(tableName, schema)
      const statements = [createSql, ...buildInsertStatements(tableName, schema, rows)]
      await runSql(conn, statements.join('\n'))
      results.push({ table: tableName, rows: rows.length, columns: schema.columns.length, ok: true })
    } catch (err) {
      results.push({ table: tableName, rows: rows.length, ok: false, error: err.message })
    }
  }

  if (authMirror) {
    try {
      if (conn.type === 'oauth') {
        const { created, existed, failed, total } = await migrateAuthMirrorUsersToSupabase(conn, authMirror)
        results.push({
          table: 'usuarios reales (login)',
          rows: created + existed,
          columns: 3,
          ok: failed === 0,
          isAuthMigration: true,
          error: failed > 0 ? `${failed} de ${total} no se pudieron crear en Supabase Auth (revisar logs del servidor)` : undefined,
        })
      } else {
        const { created, failedBatches, total } = await migrateAuthMirrorUsers(conn, authMirror)
        results.push({
          table: 'usuarios reales (login)',
          rows: created,
          columns: 3,
          ok: failedBatches === 0,
          isAuthMigration: true,
          error: failedBatches > 0 ? `${failedBatches} lote(s) de ${total} usuarios no se pudieron insertar (revisar logs del servidor)` : undefined,
        })
      }
    } catch (err) {
      results.push({ table: 'usuarios reales (login)', rows: authMirror.rows.length, ok: false, error: err.message })
    }
  }

  return { results, authMigrated: Boolean(authMirror), usedRealSchemaCount }
}
