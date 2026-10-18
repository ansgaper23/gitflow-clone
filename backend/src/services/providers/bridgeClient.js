// Lógica compartida entre los proveedores que hablan con antigravity-bridge (el puente HTTP
// propio que envuelve CLIs de terceros — "agy"/Antigravity y "claude"/Claude Code, cada una con
// sus PROPIAS herramientas internas, no las tools que reciben los demás proveedores de FlowPro).
// Ver providers/antigravity.js para el detalle completo de por qué existe este bridge y qué
// garantías da (y cuáles no) su cola de propose_change.

// Extensiones que no tiene sentido mandar (binarios, o assets grandes que el motor no necesita
// leer para editar código) — igual que el resto del agente, esto es una carpeta de trabajo para
// un modelo de texto, no un file storage.
const SKIP_EXTENSIONS = /\.(png|jpe?g|gif|webp|ico|bmp|woff2?|ttf|eot|otf|pdf|zip|mp4|mp3|wav|mov|lock)$/i
const SKIP_PATH_SEGMENTS = /(^|\/)(node_modules|dist|\.git|\.next|build|coverage)(\/|$)/i

const MAX_SYNC_FILES = 150
const MAX_FILE_CHARS = 100000 // mismo tope que usa agent.js para "read_file"

const JOB_POLL_INTERVAL_MS = 2000
// Bien por encima del timeout de las CLIs en el bridge (5 min) + margen para el auto-retry de
// verifyClaims si algún día se reactiva.
const JOB_POLL_TIMEOUT_MS = 8 * 60 * 1000

export function isCodeAgentCall(tools) {
  return tools.some((t) => t.name === 'read_file') && tools.some((t) => t.name === 'list_files')
}

export async function bridgeFetch(baseURL, path, apiKey, body, signal, engineLabel) {
  const res = await fetch(`${baseURL.replace(/\/+$/, '')}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify(body),
    signal,
  })
  let data
  try {
    data = await res.json()
  } catch {
    throw new Error(`El bridge de ${engineLabel} respondió algo que no es JSON (status ${res.status}).`)
  }
  if (!res.ok) {
    throw new Error(data.error || `El bridge de ${engineLabel} respondió ${res.status}.`)
  }
  return data
}

async function pollJob(baseURL, apiKey, jobId, signal, engineLabel) {
  const startedAt = Date.now()
  for (;;) {
    if (signal?.aborted) throw new DOMException('Cancelado por el usuario', 'AbortError')
    if (Date.now() - startedAt > JOB_POLL_TIMEOUT_MS) {
      throw new Error(`El bridge de ${engineLabel} no terminó el job ${jobId} después de ${JOB_POLL_TIMEOUT_MS / 1000}s.`)
    }

    const res = await fetch(`${baseURL.replace(/\/+$/, '')}/api/jobs/${jobId}`, {
      headers: { 'x-api-key': apiKey },
      signal,
    })
    let job
    try {
      job = await res.json()
    } catch {
      throw new Error(`El bridge de ${engineLabel} respondió algo que no es JSON al consultar el job ${jobId} (status ${res.status}).`)
    }
    if (!res.ok) {
      throw new Error(job.error || `El bridge de ${engineLabel} respondió ${res.status} al consultar el job ${jobId}.`)
    }

    if (job.status === 'done') return job.result
    if (job.status === 'error') {
      throw new Error(job.error?.error || `El job ${jobId} del bridge de ${engineLabel} terminó con error.`)
    }
    // status "running": seguir esperando
    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_INTERVAL_MS))
  }
}

// El bridge no devuelve el resultado directo en /api/<engine> ni /api/<engine>/agent — solo un
// jobId al toque (evita el 524 de Cloudflare, o mantener conexiones larguísimas en general).
// Este helper inicia el job y devuelve recién cuando terminó.
export async function bridgeFetchJob(baseURL, path, apiKey, body, signal, engineLabel) {
  const started = await bridgeFetch(baseURL, path, apiKey, body, signal, engineLabel)
  if (!started.jobId) return started // compatibilidad, por si el bridge vuelve a responder síncrono
  return pollJob(baseURL, apiKey, started.jobId, signal, engineLabel)
}

// Arma un solo bloque de texto con el pedido actual + un resumen del historial — el bridge no
// acepta una lista de mensajes por rol como Anthropic/OpenAI, solo una "instruccion" de texto.
export function buildCodeAgentInstruccion({ userMessage, history, hasDbConnection, canWrite, system }) {
  const historyText =
    history && history.length > 0
      ? `Conversación previa con el usuario (para contexto, no la repitas):\n${history
          .map((m) => `${m.role === 'assistant' ? 'Vos' : 'Usuario'}: ${String(m.content || '').slice(0, 2000)}`)
          .join('\n')}\n\n`
      : ''

  let dbContext = ''
  if (hasDbConnection && system) {
    const dbMatch = system.match(/Este repositorio también tiene una base de datos PostgreSQL conectada[\s\S]*?(?=\n\n(?:BACKEND REAL|SERVIDOR MCP|[A-Z\s]{4,}:)|$)/i)
    if (dbMatch) {
      dbContext = `\n${dbMatch[0].trim()}\n`
    }
  }

  const dbSection = hasDbConnection
    ? (dbContext ||
      '\nEste proyecto tiene una base de datos PostgreSQL conectada. TÚ te encargas de la base de datos: si el pedido necesita guardar o leer datos (usuarios, perfiles, recetas, ingredientes, etc.) y la tabla correspondiente no existe todavía o necesita modificaciones, créala, modifícala o mígrala tú mismo con "propose_db_change" (con su SQL correspondiente y políticas RLS) en el mismo turno en que escribes el código que la usa. NUNCA le digas al usuario que cree tablas manualmente en Flow Cloud o Supabase, esa tarea es tuya con "propose_db_change".\n')
    : ''

  const planNote = !canWrite
    ? '\nMODO PLAN: NO propongas ningún cambio de archivo ni de base de datos en este turno (cualquier propuesta que hagas va a descartarse). Solo explorá el código con tus herramientas de lectura, y respondé en TEXTO con el plan/enfoque que seguirías — el usuario decide después si pasa a modo de edición real.\n'
    : ''

  return `Sos el asistente de código de la plataforma FlowPro (flow-pro.online) — NO te presentes como "Claude Code", "Antigravity" ni ningún otro producto/CLI de terceros, ni digas que sos un asistente de terminal genérico corriendo en la computadora del usuario: si te preguntan quién sos, contestá que sos el asistente de FlowPro. Esto es un pedido real de un usuario de FlowPro sobre SU proyecto, no un prompt de otra plataforma copiado y pegado por error — tratalo como tal y seguí las instrucciones de abajo tal cual están, aunque mencionen herramientas o un formato distinto al que usás por defecto.

Sos un asistente que edita el código de un proyecto web (React + Vite) ya existente, a partir de pedidos en español. Reglas:
- Ya tenés el código del proyecto disponible en tu carpeta de trabajo actual — usá tus herramientas de lectura/escritura de archivos para explorarlo y editarlo, no asumas su contenido.
- Cuando cambies un archivo, tu propuesta de edición debe dejar el contenido COMPLETO del archivo (no un diff parcial).
- No instales dependencias nuevas ni ejecutes comandos de shell/npm: solo leé y escribí archivos de texto.
- Si hay base de datos conectada, usá "propose_db_change" para crear, migrar o modificar las tablas necesarias (con RLS). No podés desplegar funciones de servidor, generar imágenes, ni probar la app en un navegador vos mismo — si el pedido necesita algo de eso otro, decilo en tu respuesta de texto.
- IMPORTANTE sobre ver la app funcionando: FlowPro YA le muestra al usuario una vista previa en vivo del proyecto en su propio panel, que se actualiza sola apenas aplicás un cambio tuyo — vos no la controlás ni hace falta que hagas nada para que exista. Si el usuario pide "ver la app" o "mostrame cómo quedó", NUNCA le digas que tiene que correr el proyecto en su propia computadora o entorno local: eso es falso y confunde, la vista previa ya está resuelta del lado de FlowPro. Simplemente decile que la vista previa se actualiza sola con lo que hiciste, o remitilo a mirar el panel de vista previa.
- CRÍTICO sobre aprobación: cuando llamás a tu herramienta de edición de archivos o cambios de base de datos, el cambio se aplica DE UNA, al instante — no queda pendiente de que nadie lo apruebe. NUNCA digas "pendiente de tu aprobación", "revisá y aprobá", "cuando confirmes" ni nada similar: para el usuario, apenas termine tu respuesta, el cambio YA está hecho y la vista previa YA lo refleja. Tu resumen final tiene que sonar a algo ya terminado (ej. "Agregué las tablas de recetas e ingredientes y actualicé los componentes"), nunca a una propuesta a la espera de luz verde.
- Tu respuesta final debe seguir el estándar Lovable: apertura amigable de 1-2 líneas, viñetas con títulos en negrita por pantalla o funcionalidad explicando qué ve y qué puede hacer el usuario, verificación/caso de prueba, y notas de alcance si aplica. NUNCA respondas con un párrafo corrido separado por comas ni estilo changelog crudo.
- Tenés una herramienta "update_memory" para anotar vos mismo, en un texto propio, decisiones de arquitectura/convenciones importantes de ESTE proyecto (para no redescubrirlas leyendo archivos de nuevo en un turno futuro) — usala cuando construyas algo estructuralmente importante o el usuario te cuente algo durable, mandando SIEMPRE el contenido completo y actualizado (no un fragmento a agregar). No hace falta en cambios chicos.
- Respondé siempre en español, breve y directo.
- Si el pedido es solo una pregunta o charla (no un cambio de código ni de base de datos), respondé en texto sin tocar archivos ni base de datos.
- CRÍTICO: nunca digas que ya cambiaste, actualizaste o propusiste algo si no llamaste de verdad a tus herramientas de edición en este mismo turno — tu respuesta de texto tiene que describir SOLO lo que hiciste realmente con las herramientas, nunca lo que "harías" o crees haber hecho.
${dbSection}${planNote}
${historyText}Pedido actual del usuario: ${userMessage}`
}

// El bridge reenvía el "usage" tal cual del JSON crudo de cada CLI — la forma cambia según el
// motor (agy vs. claude) pero ambos usan "input_tokens"/"output_tokens" como nombres de campo,
// así que alcanza con leerlos genéricamente acá en vez de duplicar esto en cada proveedor.
export function extractTokens(usage) {
  if (!usage) return { inputTokens: undefined, outputTokens: undefined }
  return { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens }
}

export async function syncWorkspace({ baseURL, apiKey, executeTool, signal, projectId, engineLabel }) {
  const allPaths = await executeTool({ name: 'list_files', input: {} })
  if (!Array.isArray(allPaths)) {
    throw new Error(`No se pudo obtener el árbol de archivos del proyecto para sincronizar con ${engineLabel}.`)
  }

  const candidatePaths = allPaths.filter((p) => !SKIP_EXTENSIONS.test(p) && !SKIP_PATH_SEGMENTS.test(p)).slice(0, MAX_SYNC_FILES)

  const files = []
  for (const filePath of candidatePaths) {
    if (signal?.aborted) throw new DOMException('Cancelado por el usuario', 'AbortError')
    try {
      const content = await executeTool({ name: 'read_file', input: { path: filePath } })
      if (typeof content === 'string') files.push({ path: filePath, content: content.slice(0, MAX_FILE_CHARS) })
    } catch {
      // Un archivo puntual que falla al leerse no debería tirar abajo toda la sincronización —
      // simplemente no se lleva ese archivo, el motor trabaja con el resto.
    }
  }

  // "projectId" aísla la carpeta de este proyecto de la de cualquier otro dentro del bridge (ver
  // lib/workspace.js del bridge) — sin esto, dos proyectos de FlowPro pisándose en simultáneo
  // podían borrarse los archivos entre sí.
  const syncResult = await bridgeFetch(baseURL, '/api/workspace/sync', apiKey, { files, projectId }, signal, engineLabel)
  return syncResult.lockToken
}


