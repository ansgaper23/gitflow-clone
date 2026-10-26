// Wrapper de la Management API de Supabase para Edge Functions — mismo host/auth que
// supabaseOAuth.js (accessToken de la conexión OAuth del usuario), pero un archivo aparte
// porque es un dominio bien distinto (desplegar código, no CRUD de proyectos).
const API_BASE = 'https://api.supabase.com/v1'

// Mismo patrón que espera Supabase (letras/números/_/-, arrancando con letra).
const SLUG_RE = /^[A-Za-z][A-Za-z0-9_-]*$/

export function isValidFunctionSlug(slug) {
  return typeof slug === 'string' && slug.length <= 100 && SLUG_RE.test(slug)
}

export function functionInvokeUrl(projectRef, slug) {
  return `https://${projectRef}.supabase.co/functions/v1/${slug}`
}

// Despliega (crea o reemplaza) una función de un solo archivo. La Management API pide
// multipart/form-data con el/los archivo(s) + un campo "metadata" con la ruta del entrypoint —
// para una función de un archivo, el entrypoint es simplemente "index.ts".
export async function deployEdgeFunction(accessToken, projectRef, { slug, code, summary, verifyJwt = false }) {
  if (!isValidFunctionSlug(slug)) {
    throw new Error('Nombre de función inválido: solo letras, números, "_" y "-", empezando con una letra')
  }
  const metadata = { entrypoint_path: 'index.ts', verify_jwt: Boolean(verifyJwt), name: summary?.slice(0, 100) || slug }
  const form = new FormData()
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  form.append('file', new Blob([code], { type: 'application/typescript' }), 'index.ts')

  const res = await fetch(`${API_BASE}/projects/${projectRef}/functions/deploy?slug=${encodeURIComponent(slug)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  })
  if (!res.ok) throw new Error(`Supabase rechazó el despliegue de "${slug}": ${(await res.text()).slice(0, 500)}`)
  return res.json()
}

export async function deleteEdgeFunction(accessToken, projectRef, slug) {
  const res = await fetch(`${API_BASE}/projects/${projectRef}/functions/${encodeURIComponent(slug)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok && res.status !== 404) throw new Error(`No se pudo borrar la función "${slug}": ${(await res.text()).slice(0, 500)}`)
}

// secrets: [{ name, value }]. Sobrescribe (upsert) — Supabase no tiene un "delete uno solo por
// nombre" separado de esto para el caso simple de actualizar valores.
export async function setServerSecrets(accessToken, projectRef, secrets) {
  if (!secrets.length) return
  const res = await fetch(`${API_BASE}/projects/${projectRef}/secrets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(secrets),
  })
  if (!res.ok) throw new Error(`Supabase rechazó guardar los secrets de servidor: ${(await res.text()).slice(0, 500)}`)
}

export async function deleteServerSecret(accessToken, projectRef, name) {
  const res = await fetch(`${API_BASE}/projects/${projectRef}/secrets`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([name]),
  })
  if (!res.ok && res.status !== 404) throw new Error(`No se pudo borrar el secret "${name}": ${(await res.text()).slice(0, 500)}`)
}
