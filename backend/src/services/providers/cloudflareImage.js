// Cloudflare Workers AI: cuota gratis real y diaria (no créditos que se agotan), a diferencia
// de los modelos de imagen de Gemini que ya no tienen free tier. Necesita DOS credenciales
// (account id + API token), no una sola API key — se guardan juntas en el campo api_key de
// ai_accounts como "accountId:apiToken" para no tener que agregar una columna nueva.
export async function generateCloudflareImage({ accountId, apiToken, model, prompt }) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, steps: 4 }),
    signal: AbortSignal.timeout(20000),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || json?.success === false) {
    const detail = json?.errors?.map((e) => e.message).join('; ') || `HTTP ${res.status}`
    throw new Error(detail)
  }
  // La API REST envuelve todo en { result, success, errors }, pero documentamos ambas formas
  // por las dudas (algunos ejemplos de Cloudflare muestran el binding de Worker, que devuelve
  // { image } directo, sin el sobre).
  const base64 = json?.result?.image || json?.image
  if (!base64) throw new Error('Cloudflare no devolvió ninguna imagen.')
  return { mimeType: 'image/jpeg', base64 }
}
