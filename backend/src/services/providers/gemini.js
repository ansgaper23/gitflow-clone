import { GoogleGenAI } from '@google/genai'
import { logAiUsage } from '../aiUsageLog.js'

// Ver nota en providers/anthropic.js: 5 se quedaba corto para diagnósticos reales de varios pasos.
const MAX_ROUNDS = 25

// Misma interfaz que converseAnthropic: ver anthropic.js.
export async function converseGemini({
  apiKey,
  baseURL,
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
  // Gemini requires uppercase types (e.g. 'OBJECT', 'STRING') on the official API,
  // but proxies might break if we send uppercase.
  function fixSchema(schema) {
    if (baseURL) return schema; // Do not touch schema if using a proxy
    if (!schema) return schema;
    if (Array.isArray(schema)) return schema.map(fixSchema);
    if (typeof schema !== 'object') return schema;
    const newSchema = {};
    for (const [k, v] of Object.entries(schema)) {
      if (k === 'type' && typeof v === 'string') newSchema[k] = v.toUpperCase();
      else newSchema[k] = fixSchema(v);
    }
    return newSchema;
  }

  const ai = new GoogleGenAI({ apiKey, ...(baseURL ? { httpOptions: { baseUrl: baseURL, timeout: 240000 } } : { httpOptions: { timeout: 240000 } }) })
  const geminiTools = [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: fixSchema(t.input_schema),
      })),
    },
  ]

  const userParts = [{ text: userMessage }]
  for (const attachment of attachments) {
    const mimeType = attachment.kind === 'pdf' ? 'application/pdf' : attachment.mimeType
    userParts.unshift({ inlineData: { mimeType, data: attachment.base64 } })
  }

  const contents = [
    ...history.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    { role: 'user', parts: userParts },
  ]

  let finalText = '';
  let totalUsage = { inputTokens: 0, outputTokens: 0, latencyMs: 0 };

  const DB_TOOL_NAMES = new Set(['execute_ddl', 'propose_migration', 'read_table_rows', 'list_tables', 'execute_query'])
  let dbBonusRounds = 0
  const MAX_DB_BONUS = 10

  for (let round = 0; round < MAX_ROUNDS + dbBonusRounds; round++) {
    if (signal?.aborted) throw new DOMException('Cancelado por el usuario', 'AbortError')

    const startedAt = Date.now()
    console.log('GEMINI SYSTEM PROMPT LENGTH:', system ? system.length : 0);
    let response
    try {
      response = await ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: system,
          tools: geminiTools,
          abortSignal: signal,
          ...((round === 0 && toolChoice?.type === 'any') ? { toolConfig: { functionCallingConfig: { mode: 'ANY' } } } : {})
        },
      })
      console.log('--- GEMINI RAW RESPONSE ---', JSON.stringify(response, null, 2))
    } catch (err) {
      logAiUsage({ accountId, provider: 'gemini', model, scope, statusCode: 500, error: err.message, latencyMs: Date.now() - startedAt })
      throw err
    }
    logAiUsage({
      accountId,
      provider: 'gemini',
      model,
      scope,
      inputTokens: response.usageMetadata?.promptTokenCount,
      outputTokens: response.usageMetadata?.candidatesTokenCount,
      statusCode: 200,
      latencyMs: Date.now() - startedAt,
    })
    totalUsage.inputTokens += (response.usageMetadata?.promptTokenCount || 0);
    totalUsage.outputTokens += (response.usageMetadata?.candidatesTokenCount || 0);
    totalUsage.latencyMs += (Date.now() - startedAt);

    const parts = response.candidates?.[0]?.content?.parts || []
    const functionCalls = parts.filter((p) => p.functionCall)
    const textParts = parts.filter((p) => p.text)
    finalText = textParts.map((p) => p.text).join('\n').trim() || finalText

    if (functionCalls.length === 0) break

    // Presupuesto independiente: herramientas de base de datos no agotan pasos de React
    if (functionCalls.some((p) => DB_TOOL_NAMES.has(p.functionCall?.name)) && dbBonusRounds < MAX_DB_BONUS) {
      dbBonusRounds++;
    }

    contents.push({ role: 'model', parts })

    const toolExecutions = await Promise.allSettled(
      functionCalls.map(async (part) => {
        try {
          if (signal?.aborted) throw new DOMException('Cancelado por el usuario', 'AbortError')
          const { name, args } = part.functionCall
          const result = await executeTool({ name, input: args })
          return { part, result }
        } catch (error) {
          error.toolName = part.functionCall.name
          throw error
        }
      })
    )

    const responseParts = []
    const directImageParts = []
    for (const res of toolExecutions) {
      if (res.status === 'fulfilled') {
        const { name } = res.value.part.functionCall
        const raw = res.value.result
        const contentStr = (typeof raw === 'object' && raw !== null && raw.output !== undefined)
          ? (typeof raw.output === 'string' ? raw.output : JSON.stringify(raw.output))
          : (typeof raw === 'string' ? raw : JSON.stringify(raw))
        responseParts.push({
          functionResponse: { name, response: { result: contentStr } },
        })

        // Extraer bloques de imagen multimodal para visión nativa en Gemini
        if (Array.isArray(raw?.multimodalBlocks)) {
          for (const block of raw.multimodalBlocks) {
            if (block.type === 'image' && block.source?.data) {
              directImageParts.push({
                inlineData: {
                  mimeType: block.source.media_type || 'image/jpeg',
                  data: block.source.data,
                },
              })
            }
          }
        }
      } else {
        responseParts.push({
          functionResponse: { name: res.reason?.toolName || 'unknown', response: { result: `Error ejecutando herramienta: ${res.reason?.message || String(res.reason)}` } },
        })
      }
    }
    // Entregar tanto las respuestas de función como las imágenes capturadas directamente en el turno
    contents.push({ role: 'user', parts: [...responseParts, ...directImageParts] })
  }

  return { text: finalText, usage: totalUsage }
}

// Modelos de imagen (ej. gemini-2.5-flash-image / "Nano Banana") no usan tool-calling — se les
// pide directamente que devuelvan una imagen. Piden 'TEXT' además de 'IMAGE' en responseModalities
// porque varios de estos modelos fallan o devuelven solo texto explicativo si se pide únicamente
// IMAGE.
export async function generateGeminiImage({ apiKey, baseURL, model, prompt }) {
  const ai = new GoogleGenAI({ apiKey, ...(baseURL ? { httpOptions: { baseUrl: baseURL } } : {}) })
  const response = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { responseModalities: ['TEXT', 'IMAGE'] },
  })
  const parts = response.candidates?.[0]?.content?.parts || []
  const imagePart = parts.find((p) => p.inlineData)
  if (!imagePart) {
    const textPart = parts.find((p) => p.text)
    throw new Error(textPart?.text?.slice(0, 300) || 'El modelo no devolvió ninguna imagen.')
  }
  return { mimeType: imagePart.inlineData.mimeType || 'image/png', base64: imagePart.inlineData.data }
}
