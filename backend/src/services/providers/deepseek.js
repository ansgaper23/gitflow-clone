import OpenAI from 'openai'
import { logAiUsage } from '../aiUsageLog.js'

// Ver nota en providers/anthropic.js: 5 se quedaba corto para diagnósticos reales de varios pasos.
const MAX_ROUNDS = 25
const BASE_URL = 'https://api.deepseek.com'

// La API de DeepSeek es compatible con el formato de OpenAI, así que reusamos su SDK
// apuntando al baseURL de DeepSeek en vez de escribir el cliente HTTP a mano.
// Misma interfaz que converseAnthropic/converseGemini: ver anthropic.js.
export async function converseDeepseek({
  apiKey,
  model,
  system,
  tools,
  history,
  userMessage,
  executeTool,
  signal,
  attachments = [],
  accountId,
  scope = 'agent',
  toolChoice = undefined,
}) {
  // Los modelos de texto de DeepSeek (deepseek-v4-flash, deepseek-v4-pro) no entienden
  // imágenes ni PDF — solo la variante experimental "-vision-exp" sí. Si el turno trae
  // adjuntos, mejor fallar rápido acá para que la rotación pase a otra cuenta que sí pueda
  // verlos, en vez de mandarlos igual y que el modelo responda como si no hubiera recibido nada.
  if (attachments.length > 0) {
    throw new Error(`El modelo ${model} de DeepSeek no soporta archivos adjuntos (imágenes/PDF)`)
  }

  const client = new OpenAI({ apiKey, baseURL: BASE_URL, timeout: 240000, maxRetries: 2 })
  const openaiTools = tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }))

  const messages = [
    { role: 'system', content: system },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ]

  let finalText = '';
  let totalUsage = { inputTokens: 0, outputTokens: 0, latencyMs: 0 };

  const DB_TOOL_NAMES = new Set(['execute_ddl', 'propose_migration', 'read_table_rows', 'list_tables', 'execute_query'])
  let dbBonusRounds = 0
  const MAX_DB_BONUS = 10

  for (let round = 0; round < MAX_ROUNDS + dbBonusRounds; round++) {
    if (signal?.aborted) throw new DOMException('Cancelado por el usuario', 'AbortError')

    const startedAt = Date.now()
    let response
    try {
      response = await client.chat.completions.create({ model, messages, tools: openaiTools }, { signal })
    } catch (err) {
      logAiUsage({
        accountId,
        provider: 'deepseek',
        model,
        scope,
        statusCode: err.status || 500,
        error: err.message,
        latencyMs: Date.now() - startedAt,
      })
      throw err
    }
    logAiUsage({
      accountId,
      provider: 'deepseek',
      model,
      scope,
      inputTokens: response.usage?.prompt_tokens,
      outputTokens: response.usage?.completion_tokens,
      statusCode: 200,
      latencyMs: Date.now() - startedAt,
    })
    totalUsage.inputTokens += (response.usage?.prompt_tokens || 0);
    totalUsage.outputTokens += (response.usage?.completion_tokens || 0);
    totalUsage.latencyMs += (Date.now() - startedAt);

    const choice = response.choices[0]
    const message = choice.message
    finalText = message.content?.trim() || finalText

    const toolCalls = message.tool_calls || []
    if (toolCalls.length === 0) break

    // Presupuesto independiente: herramientas de base de datos no agotan pasos de React
    if (toolCalls.some((t) => DB_TOOL_NAMES.has(t.function?.name)) && dbBonusRounds < MAX_DB_BONUS) {
      dbBonusRounds++;
    }

    messages.push(message)

    // ── HERRAMIENTAS PARALELAS VS MUTACIONES SERIALIZADAS POR ARCHIVO ──
    const FILE_MUTATION_TOOLS = new Set(['propose_patch', 'replace_file_content', 'propose_change'])
    const isFileMutation = (name) => FILE_MUTATION_TOOLS.has(name)
    const getTargetFilePath = (input) => input?.file_path || input?.path || 'unknown'

    const parsedCalls = toolCalls.map((call) => {
      let input = {}
      try {
        input = JSON.parse(call.function.arguments || '{}')
      } catch {
        input = {}
      }
      return { call, input, name: call.function.name, id: call.id }
    })

    const resultMap = new Map()

    const executeOne = async (item) => {
      if (signal?.aborted) throw new DOMException('Cancelado por el usuario', 'AbortError')
      const result = await executeTool({ name: item.name, input: item.input })
      return result
    }

    const readAndOther = parsedCalls.filter((c) => !isFileMutation(c.name))
    const fileMutations = parsedCalls.filter((c) => isFileMutation(c.name))

    // 1. Ejecutar herramientas de lectura / informativas en paralelo
    await Promise.allSettled(
      readAndOther.map(async (item) => {
        try {
          const result = await executeOne(item)
          resultMap.set(item.id, { status: 'fulfilled', item, result })
        } catch (error) {
          error.toolUseId = item.id
          error.toolName = item.name
          resultMap.set(item.id, { status: 'rejected', item, error })
        }
      })
    )

    // 2. Agrupar herramientas de mutación por file_path y ejecutarlas secuencialmente
    const mutationsByFile = new Map()
    for (const item of fileMutations) {
      const filePath = getTargetFilePath(item.input)
      if (!mutationsByFile.has(filePath)) {
        mutationsByFile.set(filePath, [])
      }
      mutationsByFile.get(filePath).push(item)
    }

    await Promise.all(
      Array.from(mutationsByFile.values()).map(async (fileQueue) => {
        for (const item of fileQueue) {
          try {
            const result = await executeOne(item)
            if (typeof result === 'string' && result.startsWith('Conflicto de parche secuencial')) {
              resultMap.set(item.id, {
                status: 'rejected',
                item,
                error: { toolUseId: item.id, toolName: item.name, message: result },
              })
            } else {
              resultMap.set(item.id, { status: 'fulfilled', item, result })
            }
          } catch (error) {
            error.toolUseId = item.id
            error.toolName = item.name
            resultMap.set(item.id, { status: 'rejected', item, error })
          }
        }
      })
    )

    // 3. Reensamblar en el orden original
    for (const item of parsedCalls) {
      const res = resultMap.get(item.id)
      if (res && res.status === 'fulfilled') {
        messages.push({
          role: 'tool',
          tool_call_id: item.id,
          content: typeof res.result === 'string' ? res.result : JSON.stringify(res.result),
        })
      } else {
        const err = res?.error
        messages.push({
          role: 'tool',
          tool_call_id: item.id,
          content: `Error ejecutando ${err?.toolName || item.name}: ${err?.message || String(err)}`,
        })
      }
    }

    const hasTerminatingTool = parsedCalls.some(c => 
      c.name === 'ask_question' || 
      c.name === 'ask_questions' || 
      c.name === 'propose_tasks' || 
      c.name === 'roadmap--propose_tasks' ||
      c.name === 'message_user' ||
      c.name === 'user_messaging--message_user'
    );
    if (choice.finish_reason !== 'tool_calls' || hasTerminatingTool) break
  }

  return { text: finalText, usage: totalUsage }
}
