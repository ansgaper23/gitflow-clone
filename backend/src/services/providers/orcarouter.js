import OpenAI from 'openai'
import { logAiUsage } from '../aiUsageLog.js'

// Ver nota en providers/anthropic.js: 5 se quedaba corto para diagnósticos reales de varios pasos.
const MAX_ROUNDS = 25
const BASE_URL = 'https://api.orcarouter.ai/v1'

// OrcaRouter es un gateway compatible con el formato de OpenAI que da acceso a +200 modelos
// (OpenAI, Anthropic, Gemini, DeepSeek, Grok, Qwen, etc.) con una sola API key — se elige el
// modelo real por su nombre (ej. "gpt-4o", "claude-sonnet-4", "gemini-2.5-flash") al crear la
// cuenta en /admin. Misma interfaz que converseAnthropic/converseGemini/converseDeepseek.
export async function converseOrcarouter({
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
  // PDFs no tienen un formato estándar entre todos los modelos que OrcaRouter puede rutear
  // (a diferencia de imágenes, que sí siguen el formato image_url de OpenAI) — mejor fallar
  // rápido acá para que la rotación pase a Anthropic/Gemini, que sí lo soportan siempre.
  if (attachments.some((a) => a.kind === 'pdf')) {
    throw new Error(`El modelo ${model} vía OrcaRouter no soporta PDF adjunto (solo imágenes)`)
  }

  const client = new OpenAI({ apiKey, baseURL: BASE_URL, timeout: 240000, maxRetries: 2 })
  const openaiTools = tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }))

  const userContent =
    attachments.length > 0
      ? [
          { type: 'text', text: userMessage },
          ...attachments.map((a) => ({ type: 'image_url', image_url: { url: `data:${a.mimeType};base64,${a.base64}` } })),
        ]
      : userMessage

  const messages = [
    { role: 'system', content: system },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userContent },
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
        provider: 'orcarouter',
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
      provider: 'orcarouter',
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

    const toolResults = await Promise.allSettled(
      toolCalls.map(async (call) => {
        try {
          if (signal?.aborted) throw new DOMException('Cancelado por el usuario', 'AbortError')
          let input = {}
          try {
            input = JSON.parse(call.function.arguments || '{}')
          } catch {
            input = {}
          }
          const result = await executeTool({ name: call.function.name, input })
          return { call, result }
        } catch (error) {
          error.toolUseId = call.id
          error.toolName = call.function.name
          throw error
        }
      })
    )

    for (const res of toolResults) {
      if (res.status === 'fulfilled') {
        messages.push({
          role: 'tool',
          tool_call_id: res.value.call.id,
          content: typeof res.value.result === 'string' ? res.value.result : JSON.stringify(res.value.result),
        })
      } else {
        messages.push({
          role: 'tool',
          tool_call_id: res.reason?.toolUseId,
          content: `Error ejecutando ${res.reason?.toolName || 'herramienta'}: ${res.reason?.message || String(res.reason)}`,
        })
      }
    }

    if (choice.finish_reason !== 'tool_calls') break
  }

  return { text: finalText, usage: totalUsage }
}
