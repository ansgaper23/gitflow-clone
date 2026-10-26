import { listProjectFiles, readProjectFile } from './projectStorage.js'
import { getExistingFunctionNames } from './repoDb.js'

// Escáner determinístico de referencias a Supabase en el código de un proyecto — la pieza que
// faltaba después del incidente de SuperAdminDashboard.tsx: ahí el agente automático tuvo que
// "descubrir" solo qué archivos tocaban Supabase, no encontró todo el alcance real, y terminó
// resolviendo el error borrando funcionalidad. Acá se arma la lista de archivos sospechosos de
// forma determinística (grep real sobre el contenido, no la memoria del modelo) y se la
// inyectamos al prompt del turno automático (ver connectCodePrompt en routes/dbImport.js) como
// piso mínimo de lo que hay que revisar.
//
// A propósito NO usa la API de búsqueda de código de GitHub: además del delay de indexado (justo
// después de importar el backup, el peor momento), un proyecto "virtual" (storage_type=virtual,
// sin GitHub conectado) no tiene nada que buscar ahí — leer el árbol + contenido vía
// projectStorage.js (que ya abstrae GitHub vs. virtual) es lo único que funciona para los dos casos.

const EXCLUDED_PATH_RE = /(^|\/)(node_modules|dist|build|\.git|coverage|\.next|out|\.vercel|\.netlify)(\/|$)/i
const SCANNABLE_EXT_RE = /\.(tsx?|jsx?|mjs|cjs|sql|toml)$/i
const ENV_FILENAME_RE = /(^|\/)\.env(\..+)?$/
const EDGE_FUNCTION_PATH_RE = /(^|\/)supabase\/functions\//i

const MAX_CANDIDATE_FILES = 300 // tope de archivos que de verdad se descargan y escanean, por costo/tiempo
const MAX_CONTENT_CHARS = 400_000 // por archivo — evita que un .sql gigante vuelva costosa la regex
const MAX_FILE_SIZE_BYTES = 2_000_000 // GitHub trae "size" en el árbol; virtual no, ahí no se puede filtrar antes de bajarlo
const CONCURRENCY = 6

const REFERENCE_PATTERNS = [
  { label: '@supabase/supabase-js', re: /@supabase\/supabase-js/ },
  { label: 'supabase.auth.', re: /supabase\.auth\./ },
  { label: 'supabase.storage.', re: /supabase\.storage\./ },
  { label: 'supabase.rpc(', re: /supabase\.rpc\(/ },
  { label: 'supabase.from(', re: /supabase\.from\(/ },
  { label: 'supabase.functions.invoke(', re: /supabase\.functions\.invoke\(/ },
  { label: 'context.supabase / ctx.supabase', re: /\b(?:context|ctx)\.supabase\b/ },
  { label: '.auth.getClaims(', re: /\.auth\.getClaims\(/ },
  { label: '.auth.getUser(', re: /\.auth\.getUser\(/ },
  { label: 'SUPABASE_SERVICE_ROLE_KEY', re: /SUPABASE_SERVICE_ROLE_KEY/ },
  { label: 'SUPABASE_URL', re: /SUPABASE_URL/ },
  { label: 'SUPABASE_ANON_KEY / SUPABASE_PUBLISHABLE_KEY', re: /SUPABASE_(ANON|PUBLISHABLE)_KEY/ },
]
// Catch-all de baja precisión pero alta cobertura: si nada de lo específico matcheó pero el
// archivo igual menciona "supabase" en algún lado, mejor listarlo de más (el modelo lo revisa y
// descarta si no aplica) que dejarlo afuera silenciosamente — eso es justo lo que falló antes.
const GENERIC_MENTION_RE = /supabase/i

function isCandidate(entry) {
  if (EXCLUDED_PATH_RE.test(entry.path)) return false
  if (typeof entry.size === 'number' && entry.size > MAX_FILE_SIZE_BYTES) return false
  return SCANNABLE_EXT_RE.test(entry.path) || ENV_FILENAME_RE.test(entry.path)
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

// { totalFileCount, candidateFileCount, scannedFileCount, truncated, matches: [{ path, labels, isEdgeFunction }] }
export async function scanForSupabaseReferences(project, accessToken, signal) {
  const allFiles = await listProjectFiles(project, accessToken, signal)
  const candidates = allFiles.filter(isCandidate)
  const truncated = candidates.length > MAX_CANDIDATE_FILES
  const toScan = truncated ? candidates.slice(0, MAX_CANDIDATE_FILES) : candidates

  const matches = []
  await mapWithConcurrency(toScan, CONCURRENCY, async (entry) => {
    let content
    try {
      content = await readProjectFile(project, accessToken, entry.path, signal)
    } catch {
      return // archivo ilegible (borrado justo ahora, binario mal detectado por extensión, etc.) — no rompe el resto del escaneo
    }
    if (typeof content !== 'string') return
    const sample = content.slice(0, MAX_CONTENT_CHARS)
    const isEdgeFunction = EDGE_FUNCTION_PATH_RE.test(entry.path)
    const labels = REFERENCE_PATTERNS.filter((p) => p.re.test(sample)).map((p) => p.label)
    if (isEdgeFunction && labels.length === 0) labels.push('función edge de Supabase')
    if (labels.length === 0 && GENERIC_MENTION_RE.test(sample)) labels.push('menciona "supabase" (revisar)')
    if (labels.length > 0) matches.push({ path: entry.path, labels, isEdgeFunction })
  })

  matches.sort((a, b) => a.path.localeCompare(b.path))
  return { totalFileCount: allFiles.length, candidateFileCount: candidates.length, scannedFileCount: toScan.length, truncated, matches }
}

// Arma el bloque de texto para inyectar en el prompt del turno automático — lista concreta de
// archivos en vez de dejar que el modelo "descubra" el alcance solo (ver comentario de arriba).
export function formatScanForPrompt(scan, maxLines = 40) {
  if (!scan || scan.matches.length === 0) return ''
  const lines = scan.matches.slice(0, maxLines).map((m) => `- ${m.path} (${m.labels.join(', ')})`)
  let text = `\n\nEscaneé el código del repositorio y encontré ${scan.matches.length} archivo(s) con referencias reales a Supabase que probablemente necesitan cambiar:\n${lines.join('\n')}`
  if (scan.matches.length > maxLines) {
    text += `\n... y ${scan.matches.length - maxLines} archivo(s) más (no listados acá por espacio) — seguí buscando "supabase" en el resto del repo, no asumas que ya viste todos.`
  }
  if (scan.truncated) {
    text += `\n\n(El repo tiene ${scan.candidateFileCount} archivos candidatos y solo se escanearon los primeros ${scan.scannedFileCount} — puede haber más referencias sin listar acá.)`
  }
  text += '\nUsá esta lista como piso mínimo, no como techo: si mientras trabajás encontrás otra referencia a Supabase que no está acá, migrala también.'
  return text
}

const RPC_CALL_RE = /\.rpc\(\s*["'`]([a-zA-Z_][a-zA-Z0-9_]*)["'`]/g

// Un backup de Lovable trae TABLAS (datos, y si acaso su esquema), nunca funciones/triggers
// propios de Postgres — así que cualquier función custom que el código llame vía
// "supabase.rpc(...)" (ej. "has_role", un chequeo de permisos, un cálculo server-side) queda
// faltante en la base nueva en silencio: no rompe la conexión ni el import, recién falla más
// tarde con un "Forbidden"/error genérico cuando alguien usa esa pantalla puntual — confirmado
// en un caso real (has_role() para RLS de rol, el patrón más común de Lovable, faltaba después
// de migrar a otro Supabase). Esto detecta esos casos DE ANTEMANO, en el mismo escaneo
// determinístico que ya hace scanForSupabaseReferences, en vez de esperar a que un usuario
// tropiece con el error.
export async function scanForMissingRpcFunctions(project, accessToken, dbConnection, signal) {
  if (!dbConnection) return { called: [], missing: [] }
  const allFiles = await listProjectFiles(project, accessToken, signal)
  const candidates = allFiles.filter(isCandidate)
  const toScan = candidates.length > MAX_CANDIDATE_FILES ? candidates.slice(0, MAX_CANDIDATE_FILES) : candidates

  const calledNames = new Set()
  await mapWithConcurrency(toScan, CONCURRENCY, async (entry) => {
    let content
    try {
      content = await readProjectFile(project, accessToken, entry.path, signal)
    } catch {
      return
    }
    if (typeof content !== 'string') return
    for (const m of content.slice(0, MAX_CONTENT_CHARS).matchAll(RPC_CALL_RE)) calledNames.add(m[1])
  })
  if (calledNames.size === 0) return { called: [], missing: [] }

  let existing = []
  try {
    existing = await getExistingFunctionNames(dbConnection, [...calledNames])
  } catch {
    // Si falla la consulta a la base, mejor no afirmar nada (ni "falta" ni "existe") — se
    // devuelve sin faltantes en vez de una lista posiblemente falsa que mande a la IA a crear
    // de nuevo funciones que en realidad sí están.
    return { called: [...calledNames].sort(), missing: [] }
  }
  const existingSet = new Set(existing)
  const missing = [...calledNames].filter((name) => !existingSet.has(name)).sort()
  return { called: [...calledNames].sort(), missing }
}

// Ídem formatScanForPrompt pero para el resultado de arriba — bloque aparte porque la acción
// que le pide a la IA es distinta (crear una función, no migrar un archivo de cliente).
export function formatMissingRpcNote(scan) {
  if (!scan || scan.missing.length === 0) return ''
  return `\n\nADEMÁS: el código llama vía "supabase.rpc(...)" a est${scan.missing.length === 1 ? 'a función' : 'as funciones'} SQL, que NO existe${scan.missing.length === 1 ? '' : 'n'} en la base conectada: ${scan.missing.join(', ')}. Los backups de datos nunca traen funciones/triggers propios, solo tablas — tenés que CREAR cada una con "propose_db_change" como parte de conectar el código, antes de dar el trabajo por terminado (si no, cualquier pantalla que dependa de ella va a fallar con "Forbidden" o un error parecido, aunque el resto de la conexión esté perfecta). Para inferir qué debería hacer cada función, mirá CÓMO y CON QUÉ PARÁMETROS se la llama en el código real — por ejemplo "has_role(_user_id, _role)" casi siempre es el patrón estándar de Lovable para chequear roles contra una tabla "user_roles" (columna "role", devuelve boolean, "security definer" para evitar problemas de recursión con RLS) — pero confirmá contra las columnas/tipos reales de las tablas involucradas en vez de asumir ciegamente. Si de verdad no podés inferir con confianza qué debería hacer alguna, decilo explícitamente en tu resumen (qué función y por qué no se pudo recrear) en vez de inventarla o dejarla faltante en silencio.`
}
