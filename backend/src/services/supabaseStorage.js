const API_BASE = 'https://api.supabase.com/v1'

async function getApiKeys(accessToken, projectRef) {
  const res = await fetch(`${API_BASE}/projects/${projectRef}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    throw new Error(
      `No se pudo leer la API key del proyecto (¿falta el scope "Secrets: Read" en la OAuth App?): ${await res.text()}`,
    )
  }
  return res.json()
}

// Requiere el scope "Secrets: Read" en la OAuth App para poder leer la
// service_role key del proyecto (necesaria para subir a Storage saltando RLS).
export async function getServiceRoleKey(accessToken, projectRef) {
  const keys = await getApiKeys(accessToken, projectRef)
  const serviceKey = keys.find((k) => k.name === 'service_role' || k.type === 'secret')
  if (!serviceKey) throw new Error('El proyecto no tiene una service_role key disponible')
  return serviceKey.api_key
}

// La anon key es pública por diseño (se embebe en el frontend), pero la API de Supabase
// la sirve por el mismo endpoint que la service_role, así que requiere el mismo scope.
export async function getAnonKey(accessToken, projectRef) {
  const keys = await getApiKeys(accessToken, projectRef)
  const anonKey = keys.find((k) => k.name === 'anon' || k.type === 'publishable' || k.type === 'legacy')
  if (!anonKey) throw new Error('El proyecto no tiene una anon key disponible')
  return anonKey.api_key
}

export async function listBuckets(projectRef, serviceRoleKey) {
  const res = await fetch(`https://${projectRef}.supabase.co/storage/v1/bucket`, {
    headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey },
  })
  if (!res.ok) throw new Error(`No se pudieron listar los buckets de Storage: ${await res.text()}`)
  return res.json() // [{ id, name, public, ... }]
}

// Idempotente a propósito (para reimportar el mismo backup sin romper): si el bucket ya existe,
// Supabase devuelve 400 "Bucket already exists" — se trata como éxito, no como error.
export async function createBucketIfMissing(projectRef, serviceRoleKey, bucket) {
  const res = await fetch(`https://${projectRef}.supabase.co/storage/v1/bucket`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ id: bucket, name: bucket, public: true }),
  })
  if (res.ok) return
  const text = await res.text().catch(() => '')
  if (res.status === 400 && /already exists/i.test(text)) return
  throw new Error(`No se pudo crear el bucket "${bucket}": ${text}`)
}

export async function uploadToStorage({ projectRef, serviceRoleKey, bucket, path, buffer, mimeType }) {
  const res = await fetch(
    `https://${projectRef}.supabase.co/storage/v1/object/${bucket}/${path}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        'Content-Type': mimeType,
        'x-upsert': 'true',
      },
      body: buffer,
    },
  )
  if (!res.ok) throw new Error(`No se pudo subir el archivo a Storage: ${await res.text()}`)
  return { publicUrl: `https://${projectRef}.supabase.co/storage/v1/object/public/${bucket}/${path}` }
}
