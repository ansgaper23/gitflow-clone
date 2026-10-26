import { getActiveAccounts, markSuccess, markFailure, COOLDOWN_MS } from './aiAccounts.js'
import { generateGeminiImage } from './providers/gemini.js'
import { generateCloudflareImage } from './providers/cloudflareImage.js'
import { generateOpenaiImage } from './providers/openai.js'
import { logAiUsage } from './aiUsageLog.js'

// Cada proveedor de imagen tiene una forma de credenciales distinta (Gemini: una API key;
// Cloudflare: account id + API token) — este mapa aísla esa diferencia del loop de rotación.
const IMAGE_RUNNERS = {
  gemini: (account, prompt) =>
    generateGeminiImage({ apiKey: account.api_key, baseURL: account.base_url || undefined, model: account.model, prompt }),
  openai: (account, prompt) =>
    generateOpenaiImage({ apiKey: account.api_key, baseURL: account.base_url || undefined, model: account.model, prompt }),
  cloudflare: (account, prompt) => {
    const [accountId, apiToken] = String(account.api_key || '').split(':')
    if (!accountId || !apiToken) {
      throw new Error('API key de Cloudflare inválida — debe tener el formato "accountId:apiToken"')
    }
    return generateCloudflareImage({ accountId, apiToken, model: account.model, prompt })
  },
}

export function isImageProvider(provider) {
  return Boolean(IMAGE_RUNNERS[provider])
}

// Único punto de paso tanto para generación real (generateImage, abajo) como para el botón
// "Probar" del admin — loguear acá adentro cubre ambos casos sin duplicar la instrumentación.
// Sin "tokens" reales que reportar (no aplican a imágenes), el log de este scope se apoya en
// status + latencia, igual de útil para ver si una cuenta está sana.
export async function generateImageWithAccount(account, prompt) {
  const startedAt = Date.now()
  try {
    const result = await IMAGE_RUNNERS[account.provider](account, prompt)
    logAiUsage({
      accountId: account.id,
      provider: account.provider,
      model: account.model,
      scope: 'image',
      statusCode: 200,
      latencyMs: Date.now() - startedAt,
    })
    return result
  } catch (err) {
    logAiUsage({
      accountId: account.id,
      provider: account.provider,
      model: account.model,
      scope: 'image',
      statusCode: err.status || 500,
      error: err.message,
      latencyMs: Date.now() - startedAt,
    })
    throw err
  }
}

// Cuentas con scope 'image' (separadas de las de texto): mismo patrón de rotación por
// prioridad + cooldown que usa el agente de código, pero para modelos de imagen — que suelen
// tener otra cuota/facturación que el resto (y, con Cloudflare, otro formato de credenciales).
export async function generateImage(prompt) {
  const accounts = (await getActiveAccounts('image')).filter((a) => IMAGE_RUNNERS[a.provider])
  if (accounts.length === 0) {
    throw new Error(
      'No hay ninguna cuenta de IA para generación de imágenes configurada. Agregá una en /admin con uso "Generación de imágenes".',
    )
  }

  const now = Date.now()
  const errors = []
  for (const account of accounts) {
    const inCooldown = account.last_error_at && now - new Date(account.last_error_at).getTime() < COOLDOWN_MS
    if (inCooldown) {
      errors.push(`${account.label}: en espera tras error reciente (${account.last_error})`)
      continue
    }
    try {
      let timer;
      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('TIMEOUT: El proveedor de imagen tardó más de 20s')), 20000);
      });
      const result = await Promise.race([
        IMAGE_RUNNERS[account.provider](account, prompt),
        timeoutPromise,
      ]).finally(() => {
        clearTimeout(timer);
      });
      await markSuccess(account.id)
      return result
    } catch (err) {
      errors.push(`${account.label}: ${err.message}`)
      await markFailure(account.id, err)
    }
  }
  throw new Error(`No se pudo generar la imagen:\n${errors.join('\n')}`)
}
