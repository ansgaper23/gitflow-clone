import { supabase } from '../db/supabaseClient.js'
import { converseAnthropic } from './providers/anthropic.js'
import { converseGemini } from './providers/gemini.js'
import { converseDeepseek } from './providers/deepseek.js'
import { converseOrcarouter } from './providers/orcarouter.js'
import { converseAntigravity } from './providers/antigravity.js'
import { converseClaudeCode } from './providers/claudecode.js'
import { converseOpenai } from './providers/openai.js'

export const COOLDOWN_MS = 5 * 60 * 1000
export const memoryCircuitBreaker = new Map() // accountId -> timestamp when cooldown expires

export const RUNNERS = {
  anthropic: converseAnthropic,
  gemini: converseGemini,
  deepseek: converseDeepseek,
  orcarouter: converseOrcarouter,
  antigravity: converseAntigravity,
  claudecode: converseClaudeCode,
  openai: converseOpenai,
}

// Los modelos de texto de DeepSeek no leen imágenes/PDF (solo una variante "-vision-exp"
// aparte). Anthropic y Gemini sí, en cualquiera de sus modelos actuales. OrcaRouter rutea a
// muchos modelos distintos elegidos por nombre en /admin — no hay forma genérica de saber de
// antemano si ESE modelo puntual ve imágenes, así que se intenta igual (si no puede, el
// proveedor.js de orcarouter falla rápido para PDF, y para imágenes que el modelo no soporte
// simplemente devuelve error y la rotación sigue con la próxima cuenta). Antigravity y Claude
// Code tampoco: su "instruccion" es texto plano, no tienen forma de recibir un adjunto.
function supportsAttachments(account) {
  if (account.provider === 'deepseek') return /vision/i.test(account.model)
  if (account.provider === 'antigravity' || account.provider === 'claudecode') return false
  return true
}

// `scope` separa el pool del agente de código ('agent') del pool para IA embebida dentro de
// las apps que construyen los usuarios ('app') — ver services/appAi.js.
export async function getActiveAccounts(scope = 'agent') {
  const { data, error } = await supabase
    .from('ai_accounts')
    .select('*')
    .eq('is_active', true)
    .eq('scope', scope)
    .order('priority', { ascending: true })
    .order('last_used_at', { ascending: true, nullsFirst: true })
  if (error) throw error
  return data
}

export async function markSuccess(id) {
  await supabase
    .from('ai_accounts')
    .update({ last_used_at: new Date().toISOString(), last_error: null, last_error_at: null })
    .eq('id', id)
}

export async function markFailure(id, err) {
  await supabase
    .from('ai_accounts')
    .update({ last_error: String(err.message || err).slice(0, 500), last_error_at: new Date().toISOString() })
    .eq('id', id)
}

export async function runAgentWithRotation({ system, tools, history, userMessage, executeTool, signal, attachments = [], preferProvider, projectId, toolChoice }) {
  const allAccounts = await getActiveAccounts('agent')
  if (allAccounts.length === 0) {
    throw new Error('No hay cuentas de IA activas configuradas. Ve al panel de administración en /admin.')
  }

  // Si el mensaje trae adjuntos, filtramos ANTES de intentar nada: así una cuenta que no puede
  // leerlos (ej. DeepSeek) ni se prueba, y no entra en cooldown por algo que nunca iba a poder
  // hacer — lo cual también dejaría sin esa cuenta a los mensajes de texto normales durante los
  // siguientes 5 minutos.
  let accounts = attachments.length > 0 ? allAccounts.filter(supportsAttachments) : allAccounts
  if (attachments.length > 0 && accounts.length === 0) {
    throw new Error('Ninguna cuenta de IA activa puede leer archivos adjuntos (imágenes/PDF) en este momento.')
  }

  // Para charla casual (saludos, "quién sos") no hace falta gastar la cuenta principal de
  // código: se prueba primero una cuenta del proveedor preferido (si hay una activa y no está
  // en cooldown) y, si falla o no existe, sigue el orden de prioridad normal como siempre.
  if (preferProvider) {
    const idx = accounts.findIndex((a) => a.provider === preferProvider)
    if (idx > 0) accounts = [accounts[idx], ...accounts.slice(0, idx), ...accounts.slice(idx + 1)]
  }

  const now = Date.now()
  const errors = []

  for (const account of accounts) {
    if (signal?.aborted) throw new DOMException('Cancelado por el usuario', 'AbortError')

    const memCooldown = memoryCircuitBreaker.get(account.id)
    if (memCooldown && now < memCooldown) {
      errors.push(`${account.label} (circuit breaker en memoria activo): cooldown hasta ${new Date(memCooldown).toISOString()}`)
      continue
    }

    const inCooldown = account.last_error_at && now - new Date(account.last_error_at).getTime() < COOLDOWN_MS
    if (inCooldown) {
      errors.push(`${account.label} (en espera tras error reciente): ${account.last_error}`)
      continue
    }

    const runner = RUNNERS[account.provider]
    if (!runner) continue

    const maxAttemptsForAccount = accounts.length === 1 ? 2 : 1
    for (let attempt = 1; attempt <= maxAttemptsForAccount; attempt++) {
      if (signal?.aborted) throw new DOMException('Cancelado por el usuario', 'AbortError')
      try {
        const result = await runner({
          apiKey: account.api_key,
          baseURL: account.base_url || undefined,
          model: account.model,
          system,
          tools,
          history,
          userMessage,
          executeTool,
          signal,
          attachments,
          projectId,
          accountId: account.id,
          // Distinto de "accountId" de arriba (el id de FlowPro, para loguear uso) — este es el
          // id de la cuenta DENTRO del bridge (antigravity-bridge/lib/accountLogins.js), que le
          // dice con qué credencial de Antigravity llamar. undefined para la cuenta original de
          // producción (nunca pasó por el alta guiada), que sigue usando el $HOME real de siempre.
          bridgeAccountId: account.bridge_account_id || undefined,
          scope: 'agent',
          toolChoice,
        })
        await markSuccess(account.id)
        return result
      } catch (err) {
        // Solo lanzamos AbortError si el usuario canceló explícitamente el turno
        if (signal?.aborted) {
          throw new DOMException('Cancelado por el usuario', 'AbortError')
        }

        // Si es un error de código interno de Node.js (ReferenceError, TypeError, SyntaxError),
        // no tiene que ver con la salud de la cuenta ni con la API externa.
        // NUNCA penalizar la cuenta en cooldown ni activar el Circuit Breaker.
        if (err instanceof ReferenceError || err instanceof TypeError || err instanceof SyntaxError) {
          console.error(`[aiAccounts] Error interno de código local (${err.name}): ${err.message}\n${err.stack}`)
          throw err
        }

        // Si la señal NO está abortada, cualquier "Request was aborted", timeout o error de socket
        // es transitorio del proveedor / red. NO abortamos el turno del usuario: hacemos failover
        // transparente o reintento automático.
        console.warn(`[aiAccounts] Error en cuenta ${account.label} (${account.provider}/${account.model}, intento ${attempt}/${maxAttemptsForAccount}): ${err.message}`)
        const errStr = String(err?.message || err || '')
        const isSevere = /500|502|503|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|timeout/i.test(errStr) || (err?.status >= 500 && err?.status <= 504)
        if (isSevere) {
          memoryCircuitBreaker.set(account.id, Date.now() + COOLDOWN_MS)
        }
        if (attempt < maxAttemptsForAccount) {
          console.info(`[aiAccounts] Reintentando misma cuenta ${account.label} en 2s tras fallo de red/timeout...`)
          await new Promise(r => setTimeout(r, 2000))
          continue
        }
        errors.push(`${account.label}: ${err.message}`)
        await markFailure(account.id, err)
      }
    }
  }

  // El detalle técnico completo (con JSON crudo de cada proveedor, links de billing, etc.) es
  // útil en el log del servidor pero es ruido para el usuario final — el mensaje que se
  // muestra en el chat tiene que quedar corto y legible. Se distingue "todos saturados/en
  // cooldown" (algo transitorio, sugiere reintentar) de una falla real, sin asumir cuál pasó.
  const allBusy = errors.every((e) => /429|RESOURCE_EXHAUSTED|capacity|espera tras error reciente|insufficient balance|402/i.test(e))
  const aggregateErr = new Error(
    allBusy
      ? 'Los modelos de IA disponibles están saturados en este momento. Probá de nuevo en unos minutos.'
      : 'No se pudo obtener respuesta de la IA. Probá de nuevo en unos minutos.',
  )
  aggregateErr.rawDetail = errors.join('\n')
  throw aggregateErr
}
