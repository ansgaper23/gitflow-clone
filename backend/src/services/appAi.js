import { GoogleGenAI } from '@google/genai'
import Anthropic from '@anthropic-ai/sdk'
import { supabase } from '../db/supabaseClient.js'
import { getActiveAccounts, markSuccess, markFailure, COOLDOWN_MS } from './aiAccounts.js'
import { logAiUsage } from './aiUsageLog.js'

// Límite diario "duro" por proyecto para el chat/IA embebido en las apps que construyen los
// usuarios — este endpoint es público (lo llama la app en producción, sin login de FlowPro),
// así que necesita un techo fijo para no dejar la cuota de ese proyecto expuesta a abuso.
const DAILY_LIMIT = 100

async function checkAndIncrementUsage(projectId) {
  const { data, error } = await supabase.rpc('increment_app_ai_usage', { p_project_id: projectId })
  if (error) throw error
  return data
}

// Sin esto, el modelo no tiene ni idea de qué app/negocio está representando y contesta como
// un chatbot genérico (ej. "no vendo planes, pero acá tenés los planes de ChatGPT...") en vez
// de responder sobre el negocio real del usuario. Es la IA la que construyó la app la que sabe
// ese contexto (nombre, rubro, planes/servicios, etc.), así que se lo pedimos que lo mande él
// mismo en cada request en vez de adivinarlo acá.
const DEFAULT_SYSTEM_INSTRUCTION =
  'Sos un asistente de atención al cliente integrado en un sitio web. Respondé siempre en español, de forma breve y amable. No tenés información específica sobre este negocio en particular (nombre, planes, precios, horarios) — si te preguntan algo así, decilo con honestidad y sugerí que revisen el sitio o contacten directamente, en vez de inventar datos o hablar de vos mismo como IA genérica.'

async function callProvider(account, message, history, systemContext) {
  const systemInstruction = systemContext ? systemContext.slice(0, 3000) : DEFAULT_SYSTEM_INSTRUCTION

  const startedAt = Date.now()

  if (account.provider === 'gemini') {
    const ai = new GoogleGenAI({
      apiKey: account.api_key,
      ...(account.base_url ? { httpOptions: { baseUrl: account.base_url } } : {}),
    })
    const contents = [
      ...(history || []).map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: String(m.content || '').slice(0, 4000) }],
      })),
      { role: 'user', parts: [{ text: message }] },
    ]
    let response
    try {
      response = await ai.models.generateContent({ model: account.model, contents, config: { systemInstruction } })
    } catch (err) {
      logAiUsage({ accountId: account.id, provider: 'gemini', model: account.model, scope: 'app', statusCode: 500, error: err.message, latencyMs: Date.now() - startedAt })
      throw err
    }
    logAiUsage({
      accountId: account.id,
      provider: 'gemini',
      model: account.model,
      scope: 'app',
      inputTokens: response.usageMetadata?.promptTokenCount,
      outputTokens: response.usageMetadata?.candidatesTokenCount,
      statusCode: 200,
      latencyMs: Date.now() - startedAt,
    })
    const parts = response.candidates?.[0]?.content?.parts || []
    const text = parts.map((p) => p.text || '').join('\n').trim()
    return text || '(sin respuesta)'
  }

  if (account.provider === 'anthropic') {
    const anthropic = new Anthropic({ apiKey: account.api_key, ...(account.base_url ? { baseURL: account.base_url } : {}) })
    const messages = [
      ...(history || []).map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content || '').slice(0, 4000),
      })),
      { role: 'user', content: message },
    ]
    let response
    try {
      response = await anthropic.messages.create({ model: account.model, max_tokens: 1024, system: systemInstruction, messages })
    } catch (err) {
      logAiUsage({
        accountId: account.id,
        provider: 'anthropic',
        model: account.model,
        scope: 'app',
        statusCode: err.status || 500,
        error: err.message,
        latencyMs: Date.now() - startedAt,
      })
      throw err
    }
    logAiUsage({
      accountId: account.id,
      provider: 'anthropic',
      model: account.model,
      scope: 'app',
      inputTokens: response.usage?.input_tokens,
      outputTokens: response.usage?.output_tokens,
      statusCode: 200,
      latencyMs: Date.now() - startedAt,
    })
    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim()
    return text || '(sin respuesta)'
  }

  throw new Error(`El proveedor "${account.provider}" todavía no está soportado para IA dentro de apps`)
}

export async function runAppChat({ projectId, message, history, systemContext }) {
  const count = await checkAndIncrementUsage(projectId)
  if (count > DAILY_LIMIT) {
    const err = new Error('Este proyecto alcanzó su límite diario de mensajes de IA. Probá de nuevo mañana.')
    err.status = 429
    throw err
  }

  const accounts = await getActiveAccounts('app')
  if (accounts.length === 0) {
    const err = new Error(
      'Este proyecto todavía no tiene una IA configurada para esta función. Agregá una cuenta de IA con "IA dentro de apps" en /admin.',
    )
    err.status = 503
    throw err
  }

  const now = Date.now()
  const errors = []
  for (const account of accounts) {
    const inCooldown = account.last_error_at && now - new Date(account.last_error_at).getTime() < COOLDOWN_MS
    if (inCooldown) {
      errors.push(`${account.label} (en espera tras error reciente)`)
      continue
    }
    try {
      const text = await callProvider(account, message, history, systemContext)
      await markSuccess(account.id)
      return text
    } catch (err) {
      errors.push(`${account.label}: ${err.message}`)
      await markFailure(account.id, err)
    }
  }

  const err = new Error(`No se pudo obtener respuesta de la IA en este momento:\n${errors.join('\n')}`)
  err.status = 502
  throw err
}
