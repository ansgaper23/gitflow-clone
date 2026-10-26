import { Router } from 'express'
import multer from 'multer'
import AdmZip from 'adm-zip'
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { requireAuth, hasAccess } from '../middleware/auth.js'
import { supabase } from '../db/supabaseClient.js'
import { resolveDbConnection } from '../services/dbConnectionResolver.js'
import { summarizeSqlDump } from '../services/sqlSummarizer.js'
import {
  isLovableBackupZip,
  parseLovableBackup,
  runLovableBackupImport,
  extractRealTableSchemaSql,
  parseRealTableSchema,
  extractSchemaDDL,
  applySchemaDDL,
  extractLovableSecretNames,
  extractVaultSecrets,
  extractEdgeFunctions,
} from '../services/lovableBackupImporter.js'
import { listProjectServerSecrets, upsertProjectServerSecret } from '../services/projectServerSecrets.js'
import { getValidAccessToken, getOwnedAccount } from '../services/supabaseOAuth.js'
import { createVpsConnection } from '../services/vpsPostgres.js'
import { testConnection } from '../services/repoDb.js'
import { restartPreviewIfRunning, ensurePreviewRunning } from '../services/previewOrchestrator.js'
import { getOwnedProjectByRepo } from '../services/projectResolver.js'
import { runAutoConnectLoop } from '../services/conversationTurn.js'
import { translateSupabaseAuthSql, stripSupabaseInternalDDL } from '../services/sqlAuthTranslator.js'
import { importStorageFiles, importStorageFilesToSupabase, declaredStorageFileCount } from '../services/lovableStorageImporter.js'
import { getServiceRoleKey } from '../services/supabaseStorage.js'
import { scanForSupabaseReferences, formatScanForPrompt, scanForMissingRpcFunctions, formatMissingRpcNote } from '../services/supabaseReferenceScanner.js'
import { writeProjectFile, readProjectFile } from '../services/projectStorage.js'
import { DB_PROXY_CLIENT, SUPABASE_CLIENT } from '../services/scaffold.js'

const execFileAsync = promisify(execFile)

export const dbImportRouter = Router()

// Backups de Lovable (ver lovableBackupImporter.js): a diferencia de un dump SQL, no traen
// ninguna conexión asociada — hace falta preguntarle al usuario "¿Supabase o Flow Cloud?" antes
// de poder importar nada. La respuesta puede tardar (el usuario tiene que leer el mensaje,
// decidir, quizás conectar Supabase primero) así que las tablas ya parseadas se guardan acá,
// en memoria, hasta que se resuelva — mismo patrón que progressTracker.js. TTL generoso (2h) más
// una limpieza periódica para no acumular importaciones abandonadas para siempre.
const PENDING_TTL_MS = 2 * 60 * 60 * 1000
const pendingImports = new Map() // pendingImportId -> { userId, conversationId, repoFullName, tables, createdAt }

setInterval(() => {
  const cutoff = Date.now() - PENDING_TTL_MS
  for (const [id, entry] of pendingImports) {
    if (entry.createdAt < cutoff) pendingImports.delete(id)
  }
}, 10 * 60 * 1000).unref()

function tableSummaryOf(tables) {
  return Object.entries(tables).map(([name, rows]) => ({ name, rows: rows.length }))
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 40 * 1024 * 1024 }, // 40 MB (un .zip con varios dumps pesa más que uno solo)
})

const SQL_FILE_RE = /\.(sql|backup|dump|pgsql)$/i

// pg_dump en formato "custom" (el que arma pg_dump -Fc, o lo que exportan varias plataformas
// como backup) arranca siempre con estos 5 bytes ASCII — es binario, no texto SQL, y no se
// puede pegar tal cual como si fuera un script (hace falta pg_restore, o volver a exportar en
// formato "plain"). Chequea sobre el buffer crudo, antes de decodificar nada como texto.
function isPgCustomDump(buffer) {
  return buffer.subarray(0, 5).toString('ascii') === 'PGDMP'
}

// pg_restore puede traducir un dump "custom" a SQL de texto plano sin necesitar ninguna
// conexión a una base de datos — solo lee el archivo. Así no hace falta que la plataforma de
// origen (ej. Lovable Cloud) dé un connection string de Postgres: alcanza con el .backup que
// el usuario ya se pudo descargar.
async function convertPgCustomDump(buffer, originalname) {
  const dir = await mkdtemp(join(tmpdir(), 'gf-pgdump-'))
  const inputPath = join(dir, 'input.backup')
  try {
    await writeFile(inputPath, buffer)
    // --schema=public: un dump completo de un proyecto Supabase trae también toda su
    // infraestructura interna (auth, storage, realtime, graphql, pgbouncer, vault…) — igual
    // en cualquier proyecto Supabase, así que es ruido puro para la IA, y encima ROMPERÍA el
    // import (el proyecto Supabase nuevo ya tiene esos esquemas creados). Con esto, pg_restore
    // filtra y deja solo las tablas/tipos/funciones/datos de la app real del usuario.
    const { stdout } = await execFileAsync(
      'pg_restore',
      ['--no-owner', '--no-privileges', '--no-comments', '--schema=public', '-f', '-', inputPath],
      { maxBuffer: 200 * 1024 * 1024, encoding: 'utf8' },
    )
    return stdout
  } catch (err) {
    throw new Error(`No se pudo convertir "${originalname}" (dump binario de Postgres) a SQL: ${err.stderr || err.message}`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

// Un archivo suelto (.sql/.backup/.dump) se toma tal cual, salvo que sea un dump binario de
// Postgres — ahí se convierte a SQL de texto plano con pg_restore antes de seguir. Un .zip se
// abre y se procesa cada archivo de ese tipo que tenga adentro de la misma forma (ignora
// cualquier otra cosa — imágenes, carpetas, etc.).
async function extractSqlFiles(buffer, originalname) {
  if (!/\.zip$/i.test(originalname)) {
    if (isPgCustomDump(buffer)) {
      const content = await convertPgCustomDump(buffer, originalname)
      return [{ name: originalname.replace(/\.(backup|dump)$/i, '.sql'), content }]
    }
    return [{ name: originalname, content: buffer.toString('utf-8') }]
  }

  const zip = new AdmZip(buffer)
  
  // Filter out system and junk files (__MACOSX, hidden files, node_modules)
  const validEntries = zip.getEntries().filter(e => {
    const name = e.entryName;
    return !e.isDirectory && 
           !name.startsWith('__MACOSX/') && 
           !name.includes('/.DS_Store') && 
           !name.includes('node_modules/');
  });

  const hasPackageJson = validEntries.some(e => e.entryName.split('/').pop() === 'package.json');
  
  const sqlEntries = validEntries.filter((e) => SQL_FILE_RE.test(e.entryName));

  if (sqlEntries.length === 0) {
    if (hasPackageJson) {
      throw new Error('SOURCE_CODE_ZIP_DETECTED');
    }
    throw new Error('NO_SQL_FOUND');
  }

  const files = []
  for (const entry of sqlEntries) {
    const data = entry.getData()
    if (isPgCustomDump(data)) {
      const content = await convertPgCustomDump(data, entry.entryName)
      files.push({ name: entry.entryName.replace(/\.(backup|dump)$/i, '.sql'), content })
      continue
    }
    files.push({ name: entry.entryName, content: data.toString('utf-8') })
  }
  return files
}

dbImportRouter.post('/', requireAuth, upload.single('file'), async (req, res) => {
  const { conversationId } = req.body
  if (!conversationId) return res.status(400).json({ error: 'Falta conversationId' })
  if (!req.file) return res.status(400).json({ error: 'Falta el archivo (campo "file")' })
  if (!hasAccess(req.user)) {
    return res.status(402).json({ error: 'Tu demo gratis o tu plan terminaron. Elige un plan para seguir usando el agente.' })
  }

  const { data: convo, error: convoErr } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .eq('user_id', req.user.id)
    .single()
  if (convoErr || !convo) return res.status(404).json({ error: 'Conversación no encontrada' })

  let dbConnection
  try {
    dbConnection = await resolveDbConnection(req.user, convo.repo_full_name)
  } catch (err) {
    return res.status(400).json({ error: 'No se pudo preparar la conexión de base de datos', detail: err.message })
  }

  // Backup de Lovable (JSON+CSV, sin conexión ni DDL asociados) — se detecta ANTES de exigir una
  // base ya conectada, porque acá el flujo normal es preguntar Supabase/Flow Cloud en vez de
  // mostrar el error de "conectala primero" (ver POST /choose-backup-db más abajo).
  if (/\.zip$/i.test(req.file.originalname) && isLovableBackupZip(req.file.buffer)) {
    return handleLovableBackupUpload(req, res, convo, dbConnection)
  }

  if (!dbConnection) {
    // "code" para que el frontend abra el panel de conectar base de datos en vez de mostrar un
    // error sin salida — antes el usuario veía este mensaje sin ninguna forma de actuar sobre él.
    return res.status(400).json({
      error: 'No hay una base de datos conectada para este repositorio. Conéctala primero.',
      code: 'no_db_connection',
    })
  }

let files
  try {
    files = await extractSqlFiles(req.file.buffer, req.file.originalname)
  } catch (err) {
    if (err.message === 'SOURCE_CODE_ZIP_DETECTED') {
      return res.status(400).json({ error: 'Detectamos c?digo fuente (package.json). Para la base de datos, exporta y sube el ZIP de Flow Migrador, no el proyecto web.' });
    }
    if (err.message === 'NO_SQL_FOUND') {
      return res.status(400).json({ error: 'No se encontr? ning?n archivo de base de datos (.sql, .dump o .backup) dentro del ZIP. Aseg?rate de incluir el archivo DDL de tu esquema.' });
    }
    return res.status(400).json({ error: err.message })
  }
  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'No se encontr? ning?n archivo de base de datos dentro del ZIP.' })
  }

  // Un export tipo "Flow Migrador PRO" trae "full_schema_structure.sql" (funciones + triggers +
  // RLS ya combinados) JUNTO a esos mismos 3 por separado ("postgres_functions.sql",
  // "rls_policies.sql", "triggers.sql") — son el mismo contenido. Importar los 4 correría cada
  // política/función/trigger dos veces (la segunda vez fallando con "ya existe", o peor,
  // duplicando filas si algo no es idempotente). Si está el archivo maestro, se usa SOLO ese.
  const masterFile = files.find((f) => /(^|\/)full_schema_structure\.sql$/i.test(f.name))
  if (masterFile && files.length > 1) {
    files = [masterFile]
  }

  // Un pg_dump/export completo de Supabase trae políticas RLS/funciones que llaman a
  // "auth.uid()" y similares (no existen en Flow Cloud), MEZCLADAS con la infraestructura
  // interna de Supabase (funciones propias de "storage.*", la implementación real de
  // "auth.jwt()", etc. — el introspector que arma ese export no filtra por esquema). Antes de
  // guardar el SQL en "proposed_db_changes" para Flow Cloud: 1) se saca lo que es de Supabase
  // (nunca tiene sentido recrearlo ahí) y 2) se traduce lo mecánicamente seguro que quede (ver
  // sqlAuthTranslator.js) — así lo que el usuario aprueba ya es lo que realmente va a poder
  // correr, no algo que falla con "function auth.uid() does not exist" o "schema storage
  // does not exist".
  let authWarnings = []
  let ddlSkippedSamples = []
  let sawUnresolvedAuthUsersTrigger = false
  let translatedAuthTriggerFns = []
  if (dbConnection?.isVps) {
    for (const f of files) {
      const stripped = stripSupabaseInternalDDL(f.content)
      if (stripped.skippedCount) ddlSkippedSamples.push(...stripped.skippedSamples)
      if (stripped.sawUnresolvedAuthUsersTrigger) sawUnresolvedAuthUsersTrigger = true
      translatedAuthTriggerFns.push(...stripped.translatedAuthTriggerFns)

      const { sql: translatedSql, replacedCount, warnings } = translateSupabaseAuthSql(stripped.sql)
      f.content = translatedSql
      f.authReplacedCount = replacedCount
      if (warnings.length) authWarnings.push(...warnings.map((w) => `${w} (en "${f.name}")`))
    }
    authWarnings = [...new Set(authWarnings)]
    ddlSkippedSamples = [...new Set(ddlSkippedSamples)]
  }

  const sizeKb = Math.round(req.file.size / 1024)
  const isMulti = files.length > 1

  const { data: userMsg, error: userMsgErr } = await supabase
    .from('messages')
    .insert({
      conversation_id: convo.id,
      role: 'user',
      content: isMulti
        ? `📎 Subí un .zip para importar: ${req.file.originalname} (${sizeKb} KB) — ${files.length} archivos .sql: ${files.map((f) => f.name).join(', ')}`
        : `📎 Subí un archivo para importar: ${req.file.originalname} (${sizeKb} KB, ~${files[0].content.split('\n').length} líneas)`,
    })
    .select('*')
    .single()
  if (userMsgErr) return res.status(500).json({ error: userMsgErr.message })

  // Un resumen de Gemini por archivo (en paralelo) — si alguno falla, sigue con el resto en
  // vez de tirar toda la importación abajo por un solo archivo problemático.
  const summaries = await Promise.all(files.map((f) => summarizeSqlDump(f.content).catch(() => null)))

  let assistantContent
  if (!isMulti) {
    const lineCount = files[0].content.split('\n').length
    assistantContent = summaries[0]
      ? `Analicé "${files[0].name}" (~${lineCount} líneas, ${sizeKb} KB) con Gemini:\n\n${summaries[0]}\n\nRevisa y aprueba el cambio de abajo para importarlo tal cual a la base de datos conectada. Si en cambio querés que use estos datos para escribir código (sin importarlos todavía), decímelo en el chat y sigo desde acá.`
      : `Preparé la importación de "${files[0].name}" (~${lineCount} líneas, ${sizeKb} KB). Revisa y aprueba el cambio para ejecutarlo contra la base de datos conectada. No lo ejecuté todavía.`
  } else {
    const parts = files.map((f, i) => `— ${f.name} —\n${summaries[i] || '(no se pudo analizar este archivo)'}`)
    assistantContent = `Encontré ${files.length} archivos .sql en "${req.file.originalname}" y los analicé con Gemini:\n\n${parts.join('\n\n')}\n\nAbajo tenés un cambio propuesto por cada archivo — revisalos y aprobá los que quieras importar (en orden, si son migraciones). Si preferís que use estos datos para escribir código en vez de importarlos, decímelo en el chat.`
  }

  const totalReplaced = files.reduce((sum, f) => sum + (f.authReplacedCount || 0), 0)
  if (totalReplaced > 0) {
    assistantContent += `\n\n🔧 Traduje ${totalReplaced} referencia${totalReplaced === 1 ? '' : 's'} a funciones de autenticación de Supabase (\`auth.uid()\`/\`auth.email()\`/\`auth.jwt()\`/\`auth.role()\`) a su equivalente de Flow Cloud, para que el SQL corra tal cual acá.`
  }
  if (ddlSkippedSamples.length > 0) {
    assistantContent += `\n\n🗑️ Saqué ${ddlSkippedSamples.length} función${ddlSkippedSamples.length === 1 ? '' : 'es'}/política${ddlSkippedSamples.length === 1 ? '' : 's'}/trigger${ddlSkippedSamples.length === 1 ? '' : 's'} propios de la infraestructura interna de Supabase (esquemas \`storage\`/\`auth\`) — no existen en Flow Cloud y no hace falta recrearlos:\n${ddlSkippedSamples.map((s) => `— ${s}`).join('\n')}`
  }
  if (translatedAuthTriggerFns.length > 0) {
    assistantContent += `\n\n✅ Encontré ${translatedAuthTriggerFns.length === 1 ? 'un trigger' : 'triggers'} que corría${translatedAuthTriggerFns.length === 1 ? '' : 'n'} en cada alta de usuario en Supabase (\`ON auth.users\`, función${translatedAuthTriggerFns.length === 1 ? '' : 'es'}: ${translatedAuthTriggerFns.map((f) => `\`${f}\``).join(', ')}) y lo${translatedAuthTriggerFns.length === 1 ? '' : 's'} adapté para que corra${translatedAuthTriggerFns.length === 1 ? '' : 'n'} sobre \`_flowpro_users\` — cualquier columna que esa función usara y que Flow Cloud no tiene (ej. metadata del registro) quedó en NULL, dejando que el resto de la lógica de la función (valores por defecto, etc.) se haga cargo, igual que ya hacía en Supabase para esos casos.`
  }
  if (sawUnresolvedAuthUsersTrigger) {
    assistantContent += `\n\n⚠️ Importante: había un trigger que corría en cada alta de usuario en Supabase (\`ON auth.users\`) cuya función no encontré en este mismo archivo, así que no lo pude traducir con seguridad — lo saqué. Si esa lógica es importante, pedime que la recree apuntando a \`_flowpro_users\` y reviso primero qué hace.`
  }
  if (authWarnings.length > 0) {
    assistantContent += `\n\n⚠️ Encontré ${authWarnings.length} referencia${authWarnings.length === 1 ? '' : 's'} que NO pude traducir automáticamente (necesitan revisión manual antes de aprobar, podrían romper la política de seguridad si se corren tal cual):\n${authWarnings.map((w) => `— ${w}`).join('\n')}`
  }

  const { data: assistantMsg, error: assistantErr } = await supabase
    .from('messages')
    .insert({
      conversation_id: convo.id,
      role: 'assistant',
      content: assistantContent,
    })
    .select('*')
    .single()
  if (assistantErr) return res.status(500).json({ error: assistantErr.message })

  const changeRows = files.map((f) => ({
    message_id: assistantMsg.id,
    conversation_id: convo.id,
    repo_full_name: convo.repo_full_name,
    sql: f.content,
    summary: `Importar dump SQL: ${f.name}`,
    status: 'pending',
  }))
  const { data: changes, error: changesErr } = await supabase.from('proposed_db_changes').insert(changeRows).select('*')
  if (changesErr) return res.status(500).json({ error: changesErr.message })

  res.json({ userMessage: userMsg, assistantMessage: assistantMsg, changes: [], dbChanges: changes })
})

// "intro" es la frase inicial (distinta según si la base ya estaba conectada o se acaba de
// crear/elegir en este mismo paso) — el resto (tablas, filas, avisos) es siempre igual.
function summarizeImportResults(results, intro, usedRealSchemaCount = 0) {
  const ok = results.filter((r) => r.ok)
  const failed = results.filter((r) => !r.ok)
  const lines = ok.map((r) => `— ${r.table}: ${r.rows} filas, ${r.columns} columnas`)
  let text = `${intro} Armé ${ok.length} tabla${ok.length === 1 ? '' : 's'}:\n\n${lines.join('\n')}`
  if (failed.length) {
    text += `\n\nNo se pudieron crear ${failed.length} tabla${failed.length === 1 ? '' : 's'}:\n${failed
      .map((r) => `— ${r.table}: ${r.error}`)
      .join('\n')}`
  }
  // El backup trae "database/table_schema.sql" (esquema real de Postgres) desde que la propia
  // herramienta de export lo agregó — cuando está, se usa ese en vez de inferir de los datos, así
  // que la advertencia de siempre ya no aplica (o solo aplica a una parte, si algunas tablas no
  // tenían su esquema real ahí).
  const dataTableCount = results.filter((r) => !r.isAuthMigration).length
  if (usedRealSchemaCount === 0) {
    text += '\n\nOjo: los tipos de columna se infirieron de los datos (no venían en el backup), así que convendría revisarlos si algo no encaja.'
  } else if (usedRealSchemaCount < dataTableCount) {
    text += `\n\n✅ Usé el esquema real (tipos exactos de Postgres) para ${usedRealSchemaCount} de ${dataTableCount} tablas. Las demás no tenían esquema real en el backup, así que sus tipos se infirieron de los datos — convendría revisarlas si algo no encaja.`
  } else {
    text += '\n\n✅ Usé el esquema real de Postgres (tipos, defaults y claves exactos) que trajo el backup — no tuve que inferir nada.'
  }
  return text
}

// Resultado de applySchemaDDL (funciones/RLS/triggers reales — ver lovableBackupImporter.js) en
// texto para el chat. Solo se llama cuando el backup de verdad traía ese DDL (Flow Migrador PRO),
// un backup común de Lovable no tiene nada de esto y esta nota ni aparece.
function formatSchemaDdlNote(result) {
  if (!result) return ''
  let text = result.ok
    ? '\n\n✅ El backup traía las funciones/políticas RLS/triggers reales del proyecto — las recreé tal cual, no tuve que adivinar ninguna (esto es lo que antes fallaba en silencio con errores tipo "Forbidden" hasta que alguien los pisaba).'
    : `\n\n⚠️ El backup traía funciones/políticas/triggers reales, pero no pude aplicarlos por completo: ${result.error}. Puede que alguna pantalla necesite que la revise a mano.`
  if (result.skippedCount) {
    text += ` Saqué ${result.skippedCount} objeto${result.skippedCount === 1 ? '' : 's'} propio${result.skippedCount === 1 ? '' : 's'} de la infraestructura interna de Supabase (esquemas \`auth\`/\`storage\`/etc.) — no aplican acá.`
  }
  if (result.authReplacedCount) {
    text += ` Traduje ${result.authReplacedCount} referencia${result.authReplacedCount === 1 ? '' : 's'} de autenticación de Supabase a su equivalente de Flow Cloud.`
  }
  if (result.roleReplacedCount) {
    text += ` Saqué ${result.roleReplacedCount} referencia${result.roleReplacedCount === 1 ? '' : 's'} a roles de Postgres que solo existen en Supabase (\`authenticated\`/\`anon\`/etc., en políticas y permisos) — Flow Cloud no los tiene, así que quedaron abiertas a cualquier conexión (el filtro real sigue siendo la condición de la política, no el rol).`
  }
  if (result.sawUnresolvedAuthUsersTrigger) {
    text += ' Había un trigger de alta de usuario que no pude traducir con seguridad — avisame si hace falta recrearlo.'
  }
  if (result.authWarnings?.length) {
    text += ` ⚠️ ${result.authWarnings.length} referencia${result.authWarnings.length === 1 ? '' : 's'} de auth no se ${result.authWarnings.length === 1 ? 'tradujo' : 'tradujeron'} automáticamente, convendría revisarla${result.authWarnings.length === 1 ? '' : 's'}: ${result.authWarnings.join(', ')}.`
  }
  return text
}

// Deja "reservado" cada nombre de secret que el proyecto original usaba, con valor vacío — NUNCA
// pisa uno que el usuario ya haya cargado a mano (upsertProjectServerSecret sobreescribiría, por
// eso se filtra contra los ya existentes primero). Devuelve solo los que de verdad se agregaron.
async function reserveProjectSecretPlaceholders(projectId, names) {
  if (!names.length) return []
  const existing = new Set((await listProjectServerSecrets(projectId)).map((s) => s.key))
  const added = []
  for (const name of names) {
    if (existing.has(name)) continue
    try {
      await upsertProjectServerSecret(projectId, name, '')
      added.push(name)
    } catch {
      // Nombre que el validador de secrets rechaza (raro, ya se filtró antes) — se saltea en vez
      // de tirar abajo el resto del import por un solo nombre problemático.
    }
  }
  return added
}

// Escribe el cliente de datos correcto de forma DETERMINÍSTICA, apenas se conecta la base — no
// se le deja esto a la IA. Confirmado en un caso real: aunque el prompt YA le mostraba el
// contenido exacto de este archivo con instrucciones de "nunca lo reinventes", terminó
// escribiendo su propio cliente con nombres de variables de entorno inventados, y la app entera
// se rompía al arrancar. Como este archivo tiene un único contenido válido posible por destino
// (Flow Cloud vs. Supabase real), no hay nada que "decidir" — se dejar ya puesto ANTES de que el
// turno automático de conectar código siquiera arranque, para que a la IA ya no le quede otra
// que usarlo tal cual. Best-effort: si falla, no corta el import (el prompt sigue igual pidiendo
// que la IA lo revise como respaldo).
async function ensureDbClientFile(project, accessToken, dbConnection) {
  const path = dbConnection.isVps ? 'src/lib/db.js' : 'src/lib/supabase.js'
  const content = dbConnection.isVps ? DB_PROXY_CLIENT : SUPABASE_CLIENT
  try {
    const existing = await readProjectFile(project, accessToken, path).catch(() => null)
    if (existing === content) return false // ya está exactamente así, no hace falta un commit de más
    await writeProjectFile(project, accessToken, {
      path,
      newContent: content,
      summary: `Conectar ${dbConnection.isVps ? 'Flow Cloud' : 'Supabase'}: cliente de datos`,
    })
    return true
  } catch (err) {
    console.error(`No se pudo escribir "${path}" de forma automática:`, err.message)
    return false
  }
}

function formatSecretsPlaceholderNote(addedNames) {
  if (!addedNames.length) return ''
  return `\n\n🔑 El proyecto original usaba ${addedNames.length} secret${addedNames.length === 1 ? '' : 's'} de servidor que dejé reservado${addedNames.length === 1 ? '' : 's'} en "Publicar → Secrets de servidor" (sin valor todavía — Lovable nunca expone los valores reales, solo los nombres): ${addedNames.join(', ')}. Cargá los valores reales ahí cuando los tengas a mano.`
}

// A diferencia de reserveProjectSecretPlaceholders (nombre nada más), acá SÍ hay un valor real
// que cargar (ver lovableBackupImporter.js#extractVaultSecrets) — mismo cuidado de no pisar uno
// que el usuario ya haya cargado a mano.
async function applyVaultSecretValues(projectId, vaultSecrets) {
  if (!vaultSecrets.length) return []
  const existing = new Set((await listProjectServerSecrets(projectId)).map((s) => s.key))
  const applied = []
  for (const { name, value } of vaultSecrets) {
    if (existing.has(name)) continue
    try {
      await upsertProjectServerSecret(projectId, name, value)
      applied.push(name)
    } catch {
      // Nombre que el validador de secrets rechaza — se saltea en vez de tirar abajo el resto.
    }
  }
  return applied
}

function formatVaultSecretsNote(appliedNames) {
  if (!appliedNames.length) return ''
  return `\n\n🔓 El proyecto original tenía ${appliedNames.length} secret${appliedNames.length === 1 ? '' : 's'} en Supabase Vault — a diferencia de los de Lovable, estos SÍ traían el valor real, así que ya quedaron cargados con su valor (no vacíos) en "Publicar → Secrets de servidor": ${appliedNames.join(', ')}.`
}

// Ver lovableBackupImporter.js#extractEdgeFunctions: "functions" trae código real (se lo paso a
// la IA para que lo adapte — Flow Cloud no corre Deno/Edge Functions nativas, así que la propia
// migración de código tiene que convertir esta lógica a lo que corresponda del lado del cliente
// conectado), "namesOnly" son las que el exportador solo pudo nombrar, sin poder recuperar el
// código (pasa seguido: la API de Lovable que lo expone no siempre lo devuelve).
function formatEdgeFunctionsNote(edgeFns, isVps) {
  if (!edgeFns || (edgeFns.functions.length === 0 && edgeFns.namesOnly.length === 0)) return ''
  let text = ''
  if (edgeFns.functions.length > 0) {
    const destino = isVps
      ? 'Flow Cloud no ejecuta Edge Functions de Deno — revisá si esta lógica hace falta del lado del cliente (ya migrada a como corresponda) o avisame si necesitás que la convierta a otra cosa'
      : 'si el proyecto quedó conectado a Supabase real, se pueden desplegar tal cual con "supabase functions deploy" (no lo hago automático, hay que correrlo a mano)'
    text += `\n\n⚡ El backup traía el código real de ${edgeFns.functions.length} Edge Function${edgeFns.functions.length === 1 ? '' : 's'} (${edgeFns.functions.map((f) => f.name).join(', ')}) — no se aplica solo (${destino}). Le paso el código a la IA para que lo tenga en cuenta al conectar el resto del proyecto.`
  }
  if (edgeFns.namesOnly.length > 0) {
    text += `\n\n⚡ El backup nombraba ${edgeFns.namesOnly.length} Edge Function${edgeFns.namesOnly.length === 1 ? '' : 's'} más (${edgeFns.namesOnly.join(', ')}) pero sin código recuperable — si las necesitás, describíselas a la IA en el chat.`
  }
  return text
}

// Texto con el código real, para agregar al prompt del turno de "conectar el código" (no al
// mensaje del chat — sería demasiado largo para mostrar ahí, pero la IA sí lo necesita completo).
function edgeFunctionsCodeForPrompt(edgeFns) {
  if (!edgeFns?.functions.length) return ''
  let text = '\n\nCódigo real de las Edge Functions que tenía el proyecto original (para que decidas cómo migrar esa lógica):\n'
  for (const fn of edgeFns.functions) {
    for (const file of fn.files) {
      text += `\n--- edge_functions/${fn.name}/${file.path} ---\n${file.content.slice(0, 8000)}\n`
    }
  }
  return text
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Antes esto solo estaba resuelto para Flow Cloud — un backup con Storage real conectado a un
// Supabase real (oauth) perdía los archivos en silencio, ni un aviso. Ahora cubre los dos
// destinos: Flow Cloud usa su propio storage local (flowStorage.js), Supabase real sube los
// archivos de verdad al proyecto conectado (necesita su service_role key, ver supabaseStorage.js
// — si el scope OAuth no la expone, se avisa en vez de fallar en silencio). "declaredCount" es lo
// que el manifiesto del export decía que había (puede no venir, exports viejos no lo traen) —
// permite avisar si algo no se pudo traer, en vez de asumir en silencio que el zip tenía todo.
async function importStorageIfPresent(dbConnection, zipBuffer) {
  const declaredCount = declaredStorageFileCount(zipBuffer)

  let result
  let destinoLabel
  if (dbConnection.isVps) {
    result = await importStorageFiles(dbConnection.vpsDatabaseName, zipBuffer)
    destinoLabel = 'Flow Cloud'
  } else {
    let serviceRoleKey
    try {
      serviceRoleKey = await getServiceRoleKey(dbConnection.accessToken, dbConnection.projectRef)
    } catch (err) {
      return `\n\n⚠️ El backup traía archivos de Storage, pero no los pude subir al Supabase conectado: no pude leer su service_role key (${err.message}).`
    }
    result = await importStorageFilesToSupabase(dbConnection.projectRef, serviceRoleKey, zipBuffer)
    destinoLabel = 'el Supabase que acabo de conectar'
  }
  if (result.totalFiles === 0) return null

  const lines = result.buckets.map((b) => `— ${b.bucket}: ${b.ok} archivo${b.ok === 1 ? '' : 's'} (${formatBytes(b.bytes)})${b.failed ? `, ${b.failed} fallaron` : ''}`)
  let text = `\n\n📁 Importé ${result.totalFiles} archivo${result.totalFiles === 1 ? '' : 's'} de Storage a ${destinoLabel}:\n${lines.join('\n')}`
  if (declaredCount !== null && declaredCount > result.totalFiles) {
    text += `\n\n⚠️ El backup decía que había ${declaredCount} archivos, pero solo encontré ${result.totalFiles} en el .zip — puede que algunos no se hayan podido descargar al armar el backup.`
  }
  return text
}

// El código del proyecto no se queda apuntando a la base vieja ni un turno más: apenas termina
// de importarse, se dispara un turno del agente (sin que nadie lo pida) para que reescriba el
// acceso a datos — y, si se migraron usuarios reales, también el login/registro. Ver
// services/conversationTurn.js/runAutoConnectLoop.
function connectCodePrompt(authMigrated, storageMigrated, scanNote, isVps) {
  // El destino real cambia según a qué se conectó el proyecto — antes esto decía "Flow Cloud"
  // siempre, aunque la conexión nueva fuera OTRO proyecto de Supabase (vía OAuth): instrucción
  // contradictoria que empujaba al agente a migrar a un cliente/base que no correspondía.
  const destination = isVps
    ? 'Flow Cloud (la base de datos automática de FlowPro) — usá el cliente que exporta "src/lib/db.js" (mismo patrón que supabase-js: "db.from(\'tabla\').select()", "auth.signUp/signIn" para cuentas de usuario)'
    : 'el proyecto de Supabase que acabo de conectar — usá supabase-js apuntando a ESA conexión (el cliente ya armado en el proyecto, ej. "src/lib/supabase.ts"/"src/integrations/supabase/client.ts" — si hay más de uno, dejalos todos apuntando a la misma conexión actual), no inventes uno nuevo ni dejes ninguno apuntando al proyecto de Supabase viejo'
  let base =
    'Conectá el código de este proyecto para que lea y escriba en las tablas que acabo de importar, usando el cliente de base de datos que corresponda a la conexión actual en vez de cualquier acceso viejo que haya quedado.' +
    ` Esto tiene que cubrir TODO el proyecto, no solo la pantalla de login o la primera que veas: cualquier archivo que hoy llame a Supabase (auth, tablas, storage, una función server-side) tiene que quedar hablando con ${destination}. Si en algún archivo la migración es difícil o no tiene un equivalente directo, NUNCA lo resuelvas borrando, comentando o reemplazando esa funcionalidad por una versión vacía/simplificada para que el error desaparezca — dejala como está y contame explícitamente en tu resumen qué archivo y por qué no se pudo migrar, para revisarlo aparte.` +
    ' Si el pedido es grande, seguí normalmente tu protocolo de etapas (proponer, pausar y esperar confirmación antes de la siguiente) — está resuelto: algo del otro lado va a contestarte "seguí" automáticamente en cuanto pauses, así que no hace falta que evites pausar ni que intentes forzar todo en una sola etapa.'
  if (storageMigrated) {
    base += isVps
      ? ' También importé archivos reales a Storage (imágenes/videos que el proyecto ya tenía) — revisá dónde el código muestra o sube esos archivos (probablemente con "supabase.storage", del cliente viejo) y conectalo al "storage" que exporta el mismo "src/lib/db.js" de Flow Cloud, con los mismos nombres de bucket que ya tenían.'
      : ' También hay archivos reales en Supabase Storage del proyecto (imágenes/videos que el proyecto ya tenía) — revisá dónde el código los muestra o sube (probablemente con "supabase.storage") y confirmá que sigan apuntando a la conexión actual, con los mismos nombres de bucket.'
  }
  if (scanNote) base += scanNote
  if (!authMigrated) {
    return `${base} Cuando termines, probá el resultado de verdad con "test_preview" (no alcanza con decir que ya quedó) antes de dar el cambio por terminado.`
  }
  if (isVps) {
    return `${base} Además, ya migré una copia real de los usuarios (con sus contraseñas) a la tabla de login de esta base — actualizá el login y el registro de cuentas para que lean de ahí en vez de Supabase, así los usuarios existentes pueden entrar con la misma contraseña de siempre. Revisá TODOS los archivos que llamen a "supabase.auth" directamente (la pantalla de login/registro en sí, no solo un hook o helper compartido) — no alcanza con arreglar un solo lugar si el formulario que el usuario realmente usa sigue llamando al Supabase viejo. Si el registro de cuentas nuevas depende de una función con permisos de administrador de Supabase (crear usuarios sin verificar el email, chequeo de fraude por IP, etc.), simplificalo a un registro normal ya que esa función no tiene equivalente en la base nueva. Cuando termines, probá el login de verdad con "test_preview" (registrate con un usuario de prueba y volvé a entrar con esa misma contraseña) antes de decir que está listo — si "test_preview" no está disponible porque la vista previa no está corriendo, decilo explícitamente en vez de asumir que funciona.`
  }
  // Conexión oauth: ya recreé las cuentas de verdad en el auth.users REAL del proyecto de
  // Supabase (vía su Admin API, con el mismo hash de contraseña — nunca se resetea nada) — el
  // login existente YA debería funcionar tal cual está el código, sin que haga falta cambiar el
  // cliente de auth ni a dónde apunta. A diferencia del caso Flow Cloud, acá NO hay que migrar
  // código de login — solo confirmar que de verdad funciona.
  return `${base} Además, ya recreé las cuentas reales de los usuarios (con la misma contraseña de siempre) directamente en el sistema de autenticación del proyecto de Supabase que acabo de conectar — no hace falta que cambies el login ni el registro de cuentas para esto, ya deberían funcionar tal cual el código los tenía armados contra "supabase.auth". Cuando termines de conectar el resto del código, probá el login de verdad con "test_preview" (con alguno de los usuarios migrados, o registrando uno nuevo de prueba) antes de decir que está listo — si "test_preview" no está disponible porque la vista previa no está corriendo, decilo explícitamente en vez de asumir que funciona.`
}

// Envuelve runAutoConnectLoop: se asegura de que haya un preview corriendo ANTES de disparar el
// turno (ver ensurePreviewRunning) — sin uno, el agente no tiene forma de usar "test_preview"
// para comprobar de verdad el resultado, y termina confiando en su propia palabra. Fire-and-
// forget completo (incluye el arranque del preview, que puede tardar hasta 100s) — nunca bloquea
// la respuesta HTTP que ya se mandó antes de llamar esto.
async function triggerConnectCodeTurn(user, conversationId, repoFullName, authMigrated, storageMigrated, isVps, edgeFns) {
  let project = null
  try {
    project = await getOwnedProjectByRepo(user.id, repoFullName)
    if (project) await ensurePreviewRunning(user, project)
  } catch (err) {
    console.error('No se pudo asegurar el preview antes del turno automático:', err.message)
  }
  if (!project) {
    console.error(`No se encontró el proyecto de "${repoFullName}" — no se puede disparar el turno automático de conectar código.`)
    return
  }

  // Escaneo determinístico de referencias a Supabase (ver supabaseReferenceScanner.js) — se le
  // pasa al modelo la lista real de archivos sospechosos en vez de confiar en que la descubra
  // solo. Best-effort: si falla (repo enorme, error de GitHub, etc.) el turno sigue igual, solo
  // que sin la lista.
  let scanNote = ''
  try {
    const scan = await scanForSupabaseReferences(project, user.github_access_token)
    scanNote = formatScanForPrompt(scan)
  } catch (err) {
    console.error('No se pudo escanear referencias a Supabase antes del turno automático:', err.message)
  }

  // Ídem, pero para funciones SQL propias que el código llama vía supabase.rpc(...) y que un
  // backup de datos nunca trae (ver supabaseReferenceScanner.js#scanForMissingRpcFunctions) —
  // confirmado en un caso real: "has_role()" faltaba después de migrar y rompía paneles enteros
  // con "Forbidden" en silencio hasta que alguien tropezaba con el error. Necesita la conexión
  // ya resuelta para poder consultar qué funciones existen de verdad en la base nueva.
  try {
    const dbConnection = await resolveDbConnection(user, repoFullName)
    if (dbConnection) {
      const rpcScan = await scanForMissingRpcFunctions(project, user.github_access_token, dbConnection)
      scanNote += formatMissingRpcNote(rpcScan)
    }
  } catch (err) {
    console.error('No se pudo escanear funciones RPC faltantes antes del turno automático:', err.message)
  }

  // El código real de las Edge Functions (si el backup lo traía, ver extractEdgeFunctions) va acá
  // adentro del prompt del turno, no en el mensaje visible del chat — es texto de lógica de
  // servidor, no algo que tenga sentido mostrarle al usuario tal cual.
  scanNote += edgeFunctionsCodeForPrompt(edgeFns)

  await runAutoConnectLoop(user, conversationId, project, connectCodePrompt(authMigrated, storageMigrated, scanNote, isVps))
}

// Sube el backup, lo parsea y decide entre 2 caminos: si el repo YA tiene una base conectada, se
// importa directo ahí (el usuario ya eligió su base al conectarla, no hace falta preguntar de
// nuevo); si no tiene ninguna, se guarda en memoria y se le pregunta al usuario Supabase o Flow
// Cloud con una tarjeta dedicada (ver DbChoiceCard.jsx) — a diferencia de QuestionCard, esto NO
// pasa por un turno de IA: la elección dispara directo POST /choose-backup-db.
async function handleLovableBackupUpload(req, res, convo, dbConnection) {
  let tables
  try {
    tables = parseLovableBackup(req.file.buffer)
  } catch (err) {
    return res.status(400).json({ error: `No se pudo leer el backup de Lovable: ${err.message}` })
  }

  const summary = tableSummaryOf(tables)
  const sizeKb = Math.round(req.file.size / 1024)
  const totalRows = summary.reduce((sum, t) => sum + t.rows, 0)

  const { data: userMsg, error: userMsgErr } = await supabase
    .from('messages')
    .insert({
      conversation_id: convo.id,
      role: 'user',
      content: `📎 Subí un backup de Lovable: ${req.file.originalname} (${sizeKb} KB) — ${summary.length} tablas, ${totalRows} filas en total`,
    })
    .select('*')
    .single()
  if (userMsgErr) return res.status(500).json({ error: userMsgErr.message })

  if (dbConnection) {
    const realSchemaSql = extractRealTableSchemaSql(req.file.buffer)
    const realSchema = realSchemaSql ? parseRealTableSchema(realSchemaSql) : null
    const { results, authMigrated, usedRealSchemaCount } = await runLovableBackupImport(dbConnection, tables, {
      // Antes solo se intentaba yendo a Flow Cloud — runLovableBackupImport ya sabe elegir el
      // camino correcto según conn.type (Flow Cloud vs. Admin API de Supabase real), así que
      // siempre vale la pena intentarlo si el backup trae una tabla espejo de auth.
      migrateAuthUsers: true,
      realSchema,
    })
    // Storage real (si el .zip lo trae) — antes solo se intentaba yendo a Flow Cloud, ahora
    // también sube los archivos de verdad a un Supabase real conectado (ver importStorageIfPresent).
    const storageNote = (await importStorageIfPresent(dbConnection, req.file.buffer).catch(() => null)) || ''

    // "Flow Migrador PRO" (a diferencia del export nativo de Lovable) trae, en el mismo .zip, el
    // DDL real de funciones/RLS/triggers, los nombres/valores de los secrets que usaba el
    // proyecto, y hasta el código de sus Edge Functions — justo lo que hoy había que ir
    // descubriendo error por error. Si el .zip los trae, se aplican solos acá; si no (un backup
    // común de Lovable), esto no hace nada.
    let ddlNote = ''
    try {
      const ddlSql = extractSchemaDDL(req.file.buffer)
      if (ddlSql) ddlNote = formatSchemaDdlNote(await applySchemaDDL(dbConnection, ddlSql))
    } catch (err) {
      console.error('No se pudo aplicar el DDL de funciones/RLS/triggers del backup:', err.message)
    }
    let secretsNote = ''
    try {
      const secretNames = extractLovableSecretNames(req.file.buffer)
      if (secretNames.length && convo.project_id) {
        secretsNote = formatSecretsPlaceholderNote(await reserveProjectSecretPlaceholders(convo.project_id, secretNames))
      }
      const vaultSecrets = extractVaultSecrets(req.file.buffer)
      if (vaultSecrets.length && convo.project_id) {
        secretsNote += formatVaultSecretsNote(await applyVaultSecretValues(convo.project_id, vaultSecrets))
      }
    } catch (err) {
      console.error('No se pudieron reservar los secrets del backup:', err.message)
    }
    let edgeFns = null
    let edgeFnsNote = ''
    try {
      edgeFns = extractEdgeFunctions(req.file.buffer)
      edgeFnsNote = formatEdgeFunctionsNote(edgeFns, dbConnection.isVps)
    } catch (err) {
      console.error('No se pudieron leer las Edge Functions del backup:', err.message)
    }

    // Cliente de datos correcto ya puesto en el código ANTES de que la IA toque nada — ver
    // ensureDbClientFile. Necesita el objeto "project" (esta función solo tenía "convo" hasta
    // acá) para poder leer/escribir archivos del repo.
    let clientNote = ''
    const project = await getOwnedProjectByRepo(req.user.id, convo.repo_full_name).catch(() => null)
    if (project) {
      const wrote = await ensureDbClientFile(project, req.user.github_access_token, dbConnection)
      if (wrote) {
        clientNote = dbConnection.isVps
          ? '\n\n🔌 Dejé "src/lib/db.js" (el cliente de Flow Cloud) ya puesto y correcto — no hace falta que la IA lo escriba, solo que conecte el resto del código a él.'
          : '\n\n🔌 Dejé "src/lib/supabase.js" ya puesto y correcto — no hace falta que la IA lo escriba, solo que conecte el resto del código a él.'
      }
    }

    const intro = 'Listo, importé el backup a la base ya conectada de este proyecto.'
    const autoConnectNote = ' Ya arranqué a conectar el código a estos datos automáticamente (puede tardar unos minutos) — te aviso acá cuando termine.'
    const { data: assistantMsg, error: assistantErr } = await supabase
      .from('messages')
      .insert({
        conversation_id: convo.id,
        role: 'assistant',
        content: summarizeImportResults(results, intro, usedRealSchemaCount) + storageNote + ddlNote + secretsNote + edgeFnsNote + clientNote + autoConnectNote,
      })
      .select('*')
      .single()
    if (assistantErr) return res.status(500).json({ error: assistantErr.message })
    // "autoTurn: true" le avisa al frontend que dispare acá mismo el mismo polling de actividad
    // que usa un turno normal (ver Chat.jsx) — sin esto, el turno de "conectar el código" queda
    // corriendo en el servidor sin que nadie en el chat se entere de que arrancó ni de cuándo
    // termina, aunque el mensaje diga "te aviso acá cuando termine".
    res.json({ userMessage: userMsg, assistantMessage: assistantMsg, changes: [], dbChanges: [], autoTurn: true })
    triggerConnectCodeTurn(req.user, convo.id, convo.repo_full_name, authMigrated, Boolean(storageNote), dbConnection.isVps, edgeFns)
    return
  }

  const pendingImportId = crypto.randomUUID()
  pendingImports.set(pendingImportId, {
    userId: req.user.id,
    conversationId: convo.id,
    repoFullName: convo.repo_full_name,
    tables,
    // Se guarda el .zip entero (no solo las tablas ya parseadas) para poder importar también los
    // archivos de Storage reales que pueda traer (ver lovableStorageImporter.js) una vez que se
    // sepa a qué conexión van — recién se sabe en /choose-backup-db, no acá.
    zipBuffer: req.file.buffer,
    createdAt: Date.now(),
  })

  const { data: assistantMsg, error: assistantErr } = await supabase
    .from('messages')
    .insert({
      conversation_id: convo.id,
      role: 'assistant',
      content: `Detecté que este .zip es un backup de Lovable (${summary.length} tablas, ${totalRows} filas). Este proyecto todavía no tiene una base de datos conectada — ¿con cuál querés armarla?`,
      question: { kind: 'db_choice_backup', pendingImportId, tables: summary },
    })
    .select('*')
    .single()
  if (assistantErr) return res.status(500).json({ error: assistantErr.message })

  res.json({ userMessage: userMsg, assistantMessage: assistantMsg, changes: [], dbChanges: [] })
}

// Segundo paso del flujo de arriba: el usuario ya eligió Supabase o Flow Cloud desde
// DbChoiceCard.jsx. Crea (Flow Cloud) o usa (Supabase, ya elegido de una lista de proyectos
// reales) la conexión, corre la importación completa, y la deja guardada como la base
// conectada de este repo — mismo efecto final que conectarla a mano desde Integraciones.
dbImportRouter.post('/choose-backup-db', requireAuth, async (req, res) => {
  const { pendingImportId, type, projectRef, projectName, supabaseAccountId } = req.body
  if (!pendingImportId || !type) return res.status(400).json({ error: 'Falta pendingImportId o type' })

  const entry = pendingImports.get(pendingImportId)
  if (!entry || entry.userId !== req.user.id) {
    return res.status(404).json({ error: 'Esta importación ya no está disponible. Subí el backup de nuevo.' })
  }
  if (!hasAccess(req.user)) {
    return res.status(402).json({ error: 'Tu demo gratis o tu plan terminaron. Elige un plan para seguir usando el agente.' })
  }

  let conn
  let connRow

  if (type === 'vps') {
    const { data: existing } = await supabase
      .from('repo_db_connections')
      .select('id')
      .eq('user_id', req.user.id)
      .eq('repo_full_name', entry.repoFullName)
      .maybeSingle()
    if (existing) {
      return res.status(409).json({ error: 'Este proyecto ya tiene una base de datos conectada. Borrala primero si querés reemplazarla.' })
    }
    try {
      connRow = await createVpsConnection(req.user.id, entry.repoFullName, 'Base de datos automática')
    } catch (err) {
      return res.status(500).json({ error: 'No se pudo crear la base de datos automática', detail: err.message })
    }
    // "isVps: true" (mismo shape que ya arma resolveDbConnection.js) — sin esto, applySchemaDDL
    // más abajo no tendría forma de saber que ESTE "manual" es Flow Cloud (y por lo tanto necesita
    // traducir auth.uid()/auth.email()) y no una conexión manual genérica a un Postgres cualquiera
    // (donde traducir sería incorrecto: podría ser un Supabase real pegado a mano).
    conn = { type: 'manual', connectionString: connRow.connection_string, isVps: true }
  } else if (type === 'oauth') {
    if (!projectRef) return res.status(400).json({ error: 'Falta projectRef' })
    if (!supabaseAccountId) return res.status(400).json({ error: 'Falta supabaseAccountId' })
    let accessToken
    let account
    try {
      account = await getOwnedAccount(req.user.id, supabaseAccountId)
      if (!account) throw new Error('Cuenta de Supabase no encontrada')
      accessToken = await getValidAccessToken(account)
      await testConnection({ type: 'oauth', accessToken, projectRef })
    } catch (err) {
      return res.status(400).json({ error: 'No se pudo conectar a ese proyecto de Supabase', detail: err.message })
    }
    conn = { type: 'oauth', accessToken, projectRef }
    const { data, error } = await supabase
      .from('repo_db_connections')
      .upsert(
        {
          user_id: req.user.id,
          repo_full_name: entry.repoFullName,
          label: projectName || 'Supabase',
          connection_type: 'oauth',
          project_ref: projectRef,
          project_name: projectName || null,
          connection_string: null,
          supabase_account_id: account.id,
        },
        { onConflict: 'user_id,repo_full_name' },
      )
      .select('*')
      .single()
    if (error) return res.status(500).json({ error: error.message })
    connRow = data
  } else {
    return res.status(400).json({ error: 'type inválido (esperado "vps" u "oauth")' })
  }

  const realSchemaSql = entry.zipBuffer ? extractRealTableSchemaSql(entry.zipBuffer) : null
  const realSchema = realSchemaSql ? parseRealTableSchema(realSchemaSql) : null
  const { results, authMigrated, usedRealSchemaCount } = await runLovableBackupImport(conn, entry.tables, {
    // Ídem el otro call site: runLovableBackupImport ya elige Flow Cloud vs. Admin API de
    // Supabase real según el tipo de conexión, siempre vale la pena intentarlo.
    migrateAuthUsers: true,
    realSchema,
  })
  pendingImports.delete(pendingImportId)

  // Storage real (si el .zip lo trae) — ahora funciona para los dos destinos, ver
  // importStorageIfPresent.
  const storageNote = entry.zipBuffer ? (await importStorageIfPresent(conn, entry.zipBuffer).catch(() => null)) || '' : ''

  // Se necesita ANTES de responder (a diferencia del uso de más abajo, fire-and-forget) para
  // poder reservar los secrets contra el project_id real.
  const project = await getOwnedProjectByRepo(req.user.id, entry.repoFullName).catch(() => null)

  // "Flow Migrador PRO": ídem el otro call site — funciones/RLS/triggers reales, secrets (nombres
  // de Lovable + valores reales de Vault) y código de Edge Functions, si el .zip los trae (un
  // backup común de Lovable no los trae, esto no hace nada ahí).
  let ddlNote = ''
  if (entry.zipBuffer) {
    try {
      const ddlSql = extractSchemaDDL(entry.zipBuffer)
      if (ddlSql) ddlNote = formatSchemaDdlNote(await applySchemaDDL(conn, ddlSql))
    } catch (err) {
      console.error('No se pudo aplicar el DDL de funciones/RLS/triggers del backup:', err.message)
    }
  }
  let secretsNote = ''
  if (entry.zipBuffer && project) {
    try {
      const secretNames = extractLovableSecretNames(entry.zipBuffer)
      if (secretNames.length) secretsNote = formatSecretsPlaceholderNote(await reserveProjectSecretPlaceholders(project.id, secretNames))
      const vaultSecrets = extractVaultSecrets(entry.zipBuffer)
      if (vaultSecrets.length) secretsNote += formatVaultSecretsNote(await applyVaultSecretValues(project.id, vaultSecrets))
    } catch (err) {
      console.error('No se pudieron reservar los secrets del backup:', err.message)
    }
  }
  let edgeFns = null
  let edgeFnsNote = ''
  if (entry.zipBuffer) {
    try {
      edgeFns = extractEdgeFunctions(entry.zipBuffer)
      edgeFnsNote = formatEdgeFunctionsNote(edgeFns, type === 'vps')
    } catch (err) {
      console.error('No se pudieron leer las Edge Functions del backup:', err.message)
    }
  }

  // Cliente de datos correcto ya puesto en el código ANTES de que la IA toque nada — ver
  // ensureDbClientFile.
  let clientNote = ''
  if (project) {
    const wrote = await ensureDbClientFile(project, req.user.github_access_token, conn)
    if (wrote) {
      clientNote = conn.isVps
        ? '\n\n🔌 Dejé "src/lib/db.js" (el cliente de Flow Cloud) ya puesto y correcto — no hace falta que la IA lo escriba, solo que conecte el resto del código a él.'
        : '\n\n🔌 Dejé "src/lib/supabase.js" ya puesto y correcto — no hace falta que la IA lo escriba, solo que conecte el resto del código a él.'
    }
  }

  const intro =
    type === 'vps'
      ? 'Conecté la base de datos automática (Flow Cloud).'
      : `Conecté tu proyecto de Supabase "${connRow.label}".`
  const autoConnectNote = ' Ya arranqué a conectar el código a estos datos automáticamente (puede tardar unos minutos) — te aviso acá cuando termine.'

  const { data: assistantMsg, error: assistantErr } = await supabase
    .from('messages')
    .insert({
      conversation_id: entry.conversationId,
      role: 'assistant',
      content: summarizeImportResults(results, intro, usedRealSchemaCount) + storageNote + ddlNote + secretsNote + edgeFnsNote + clientNote + autoConnectNote,
    })
    .select('*')
    .single()
  if (assistantErr) return res.status(500).json({ error: assistantErr.message })

  res.json({ assistantMessage: assistantMsg, connection: connRow, results, autoTurn: true })

  // Ver nota en previewOrchestrator.js/restartPreviewIfRunning: si el preview de este proyecto
  // ya estaba corriendo, se había levantado sin estas credenciales (o con las de otra conexión).
  if (project) restartPreviewIfRunning(req.user, project).catch(() => {})

  triggerConnectCodeTurn(req.user, entry.conversationId, entry.repoFullName, authMigrated, Boolean(storageNote), type === 'vps', edgeFns)
})
