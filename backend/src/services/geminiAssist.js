import { getActiveAccounts, RUNNERS } from './aiAccounts.js'

async function callGemini(system, userMessage) {
  const accounts = (await getActiveAccounts('agent')).filter((a) => a.provider === 'gemini')
  for (const account of accounts) {
    const runner = RUNNERS[account.provider]
    if (!runner) continue
    try {
      const result = await runner({
        apiKey: account.api_key,
        model: account.model,
        system,
        tools: [],
        history: [],
        userMessage,
        executeTool: async () => 'n/a',
      })
      if (result.text) return result.text
    } catch {
      continue
    }
  }
  return null
}

// Por debajo de esto no vale la pena la llamada extra a Gemini: el listado ya entra cómodo en
// el prompt de la IA principal tal cual.
const TRIAGE_THRESHOLD = 40

// Antes de que la IA principal (normalmente DeepSeek) reciba el listado de archivos del
// proyecto, Gemini hace una pasada rápida para quedarse solo con los que probablemente hagan
// falta para ESE pedido puntual — en vez de mandar las 300 rutas completas siempre. No le saca
// capacidad a la IA principal: sigue teniendo "list_files" disponible si necesita ver más.
export async function triageRelevantFiles(treePaths, userMessage) {
  if (treePaths.length <= TRIAGE_THRESHOLD) return treePaths

  const system = `Te paso el pedido de un usuario y la lista completa de rutas de archivo de su proyecto. Devolvé SOLO las rutas que probablemente hagan falta para atender ese pedido — una por línea, sin numeración ni texto extra, exactamente como aparecen en la lista (no las modifiques). Sé generoso ante la duda (mejor de más que de menos) e incluí siempre archivos de configuración clave si podrían aplicar (package.json, vite.config, tailwind.config, etc.). Si el pedido es muy general o no podés decidir con confianza, devolvé la lista completa tal cual, sin recortar nada.`
  const userText = `Pedido del usuario: "${userMessage}"\n\nArchivos del proyecto (${treePaths.length}):\n${treePaths.join('\n')}`

  const text = await callGemini(system, userText).catch(() => null)
  if (!text) return treePaths

  const candidate = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const valid = candidate.filter((f) => treePaths.includes(f))

  // Filtro de cordura: si Gemini devolvió algo que no parece un recorte razonable de la lista
  // real (muy pocos resultados válidos, o "recortó" a prácticamente todo igual), no confiar
  // ciegamente — mejor mandar la lista completa que arriesgarse a que falte un archivo clave.
  if (valid.length < 3 || valid.length >= treePaths.length) return treePaths
  return valid
}

// Preservación reciente: últimos 2 turnos completos (4 mensajes: user/assistant)
const KEEP_RECENT_TURNS = 4

/**
 * Poda bloques pesados de código (> 30 líneas) o lecturas antiguas de archivos en texto
 */
export function pruneStaleCode(text) {
  if (!text || typeof text !== 'string') return text

  let result = text

  // 1. Detectar bloques markdown con código de más de 30 líneas
  result = result.replace(/```(?:[a-zA-Z0-9_.-]+)?\s*\n([\s\S]*?)\n```/g, (match, code) => {
    const lines = code.split('\n')
    if (lines.length > 30) {
      // Buscar mención de ruta de archivo en el código o antes del bloque
      const pathMatch = match.match(/(?:path|file|archivo)[\s:="']*([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)/i)
        || code.match(/(?:\/\/|\/\*)\s*([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)/)
      const filePath = pathMatch ? pathMatch[1] : null
      if (filePath) {
        return `[Código histórico de ${filePath} omitido para optimizar contexto. Consulta la versión actual si necesitas editarlo]`
      }
      return `[Código histórico omitido para optimizar contexto. Consulta la versión actual si necesitas editarlo]`
    }
    return match
  })

  // 2. Detectar resultados voluminosos de lectura o payloads de propose_change/patch
  result = result.replace(/(?:Contenido de|read_file|Archivo|propose_change|propose_patch)[\s:="']+([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)["']?[\s\S]*?(?=\n\n|$)/gi, (match, filePath) => {
    const lines = match.split('\n')
    if (lines.length > 30) {
      return `[Código histórico de ${filePath.trim()} omitido para optimizar contexto. Consulta la versión actual si necesitas editarlo]`
    }
    return match
  })

  return result
}

/**
 * Aplica la poda sobre el contenido de un mensaje (sea string o array de partes)
 */
export function pruneMessageContent(content) {
  if (typeof content === 'string') {
    return pruneStaleCode(content)
  }
  if (Array.isArray(content)) {
    return content.map((item) => {
      if (item && typeof item === 'object') {
        if (typeof item.text === 'string') {
          return { ...item, text: pruneStaleCode(item.text) }
        }
        if (item.type === 'tool_result' && typeof item.content === 'string') {
          return { ...item, content: pruneStaleCode(item.content) }
        }
      }
      return item
    })
  }
  return content
}

/**
 * Poda quirúrgica de contexto obsoleto:
 * 1. Mantiene el contenido íntegro de los últimos 2 turnos completos (4 mensajes).
 * 2. En mensajes más antiguos poda bloques de código > 30 líneas conservando el texto conversacional.
 * 3. Mantiene intacta la estructura y roles de mensajes de Anthropic/OpenAI/Gemini.
 */
export async function compressHistory(history) {
  if (!Array.isArray(history) || history.length === 0) return history

  // Si toda la conversación cabe en los últimos 2 turnos (4 mensajes), conservar íntegro
  if (history.length <= KEEP_RECENT_TURNS) {
    return history
  }

  const olderCount = history.length - KEEP_RECENT_TURNS
  const olderMessages = history.slice(0, olderCount)
  const recentMessages = history.slice(olderCount)

  // Poda quirúrgica de código obsoleto en los turnos antiguos
  const prunedOlder = olderMessages.map((msg) => ({
    ...msg,
    content: pruneMessageContent(msg.content),
  }))

  // Si el historial antiguo aún es muy largo (>= 16 mensajes) y Gemini está disponible,
  // se puede condensar el inicio preservando la alternancia estricta de roles
  if (prunedOlder.length >= 16) {
    try {
      const transcript = prunedOlder
        .map((m) => `${m.role === 'user' ? 'Usuario' : 'Asistente'}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
        .join('\n\n')

      const system = `Te paso el inicio de una conversación larga entre un usuario y un agente de IA que construye una app. Resumí en español, en 1 o 2 párrafos densos, qué se construyó, qué decisiones importantes se tomaron y cualquier dato que haga falta para seguir la conversación. No inventes nada, y no omitas nombres de tablas, archivos o componentes clave.`
      const summary = await callGemini(system, transcript).catch(() => null)
      if (summary) {
        return [
          { role: 'user', content: `[Resumen de turnos anteriores para contexto]:\n${summary}` },
          { role: 'assistant', content: 'Entendido, tengo presente el resumen de los cambios y decisiones previas.' },
          ...recentMessages,
        ]
      }
    } catch (_) {}
  }

  return [...prunedOlder, ...recentMessages]
}

// Formato de texto con delimitadores en vez de JSON: un mockup HTML completo adentro de un
// string JSON casi siempre trae comillas/saltos de línea que rompen el parseo. Con delimitadores
// simples no hace falta escapar nada.
const DIRECTION_RE = /===DIRECTION===\s*\nNAME:\s*(.*)\nDESCRIPTION:\s*(.*)\nHTML:\s*\n([\s\S]*?)\n===END===/g
const MAX_DIRECTIONS = 3

// Selector de dirección de diseño (estilo Lovable): antes de generar el proyecto completo, le
// pedimos a la IA 2-3 mockups visuales autocontenidos (sin build, sin npm) para la misma idea,
// con paletas/tipografías distintas — el usuario elige uno y esa dirección se inyecta en el
// primer mensaje real al agente (ver routes/projects.js).
export async function generateDesignDirections(prompt) {
  const system = `Te paso la idea de una app/sitio que un usuario quiere construir. Generá EXACTAMENTE 3 direcciones visuales distintas y contrastantes para esa idea (paleta de colores, tipografía, densidad, estilo general) — pensalas como 3 propuestas de un estudio de diseño para LA MISMA idea, no 3 ideas de producto distintas.

Para cada una, armá un mockup HTML autocontenido de una sola pantalla (navbar + hero + 1-2 secciones cortas de ejemplo) con textos de ejemplo realistas para esa idea puntual, usando SOLO HTML y CSS inline en un <style> — nada de JavaScript, nada de imports externos ni imágenes externas (usá gradientes/colores/formas con CSS en vez de imágenes). Tiene que reflejar de verdad esa dirección visual, no ser un placeholder genérico.

Respondé ÚNICAMENTE en este formato exacto, repetido para las 3 direcciones, sin nada de texto antes, entre medio o después:

===DIRECTION===
NAME: <nombre corto de la dirección, 2-4 palabras>
DESCRIPTION: <una frase describiendo el estilo>
HTML:
<!doctype html>
<html>...documento HTML completo autocontenido...</html>
===END===`

  const text = await callGemini(system, `Idea del usuario: "${prompt}"`).catch(() => null)
  if (!text) return null

  const directions = []
  for (const match of text.matchAll(DIRECTION_RE)) {
    const [, name, description, html] = match
    if (!name?.trim() || !html?.trim()) continue
    directions.push({ name: name.trim().slice(0, 60), description: description?.trim().slice(0, 200) || '', html: html.trim() })
    if (directions.length >= MAX_DIRECTIONS) break
  }
  return directions.length > 0 ? directions : null
}
