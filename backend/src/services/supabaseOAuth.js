import { config } from '../config.js'
import { supabase } from '../db/supabaseClient.js'

const AUTHORIZE_URL = 'https://api.supabase.com/v1/oauth/authorize'
const TOKEN_URL = 'https://api.supabase.com/v1/oauth/token'
const API_BASE = 'https://api.supabase.com/v1'
const REFRESH_SKEW_MS = 60 * 1000
const STATE_TTL_MS = 10 * 60 * 1000

const pendingStates = new Map() // state -> { userId, repoFullName, expiresAt }

export function createState(userId, projectId, label) {
  const state = crypto.randomUUID()
  pendingStates.set(state, { userId, projectId, label, expiresAt: Date.now() + STATE_TTL_MS })
  return state
}

export function consumeState(state) {
  const entry = pendingStates.get(state)
  if (!entry) return null
  pendingStates.delete(state)
  if (entry.expiresAt < Date.now()) return null
  return entry
}

export function getRedirectUri() {
  return `${config.backendUrl}/api/auth/supabase/callback`
}

export function buildAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: config.supabaseOAuthClientId,
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    state,
  })
  return `${AUTHORIZE_URL}?${params.toString()}`
}

function basicAuthHeader() {
  const raw = `${config.supabaseOAuthClientId}:${config.supabaseOAuthClientSecret}`
  return `Basic ${Buffer.from(raw).toString('base64')}`
}

export async function exchangeCodeForTokens(code) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      Authorization: basicAuthHeader(),
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: getRedirectUri(),
    }),
  })
  if (!res.ok) throw new Error(`Error al intercambiar el código de Supabase: ${await res.text()}`)
  return res.json() // { access_token, refresh_token, expires_in, ... }
}

async function refreshTokens(refreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      Authorization: basicAuthHeader(),
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  })
  if (!res.ok) throw new Error(`No se pudo refrescar el token de Supabase (¿revocaste el acceso?): ${await res.text()}`)
  return res.json()
}

// "account" es una fila de "supabase_oauth_accounts" (una cuenta de Supabase VINCULADA — un
// usuario de FlowPro puede tener varias, ver routes/dbConnections.js#supabase-accounts), no el
// usuario de FlowPro en sí. Antes esto vivía en 4 columnas de "users" (un solo vínculo global
// por usuario); ahora cada conexión de un proyecto sabe a cuál de sus cuentas vinculadas
// pertenece vía "repo_db_connections.supabase_account_id".
export async function getValidAccessToken(account) {
  const expiresAt = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0
  if (account.access_token && expiresAt - REFRESH_SKEW_MS > Date.now()) {
    return account.access_token
  }
  if (!account.refresh_token) {
    throw new Error('No hay una conexión de Supabase activa. Vuelve a conectar desde el chat.')
  }

  const tokens = await refreshTokens(account.refresh_token)
  const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

  await supabase
    .from('supabase_oauth_accounts')
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || account.refresh_token,
      token_expires_at: newExpiresAt,
    })
    .eq('id', account.id)

  return tokens.access_token
}

// Cuentas de Supabase que este usuario ya vinculó (nunca expone los tokens).
export async function listAccountsForUser(userId) {
  const { data, error } = await supabase
    .from('supabase_oauth_accounts')
    .select('id, label, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data
}

// Trae una cuenta vinculada puntual, validando que sea del usuario que la pide — nunca confiar
// un accountId que venga del body/query sin este chequeo (dejaría leer/usar el token de otro).
export async function getOwnedAccount(userId, accountId) {
  const { data, error } = await supabase
    .from('supabase_oauth_accounts')
    .select('*')
    .eq('id', accountId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function listProjects(accessToken) {
  const res = await fetch(`${API_BASE}/projects`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`No se pudieron listar los proyectos de Supabase: ${await res.text()}`)
  return res.json() // [{ id, ref, name, ... }]
}

export async function listOrganizations(accessToken) {
  const res = await fetch(`${API_BASE}/organizations`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`No se pudieron listar tus organizaciones de Supabase: ${await res.text()}`)
  return res.json() // [{ id, slug, name }]
}

export async function createProject(accessToken, { name, organizationSlug, dbPass }) {
  const res = await fetch(`${API_BASE}/projects`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      organization_slug: organizationSlug,
      db_pass: dbPass,
      region_selection: { type: 'smartGroup', code: 'americas' },
    }),
  })
  if (!res.ok) {
    throw new Error(
      `No se pudo crear el proyecto de Supabase (¿falta el scope "Projects: Write" en la OAuth App?): ${await res.text()}`,
    )
  }
  return res.json() // { id, ref, name, status, ... }
}

export async function getProject(accessToken, projectRef) {
  const res = await fetch(`${API_BASE}/projects/${projectRef}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`No se pudo consultar el estado del proyecto de Supabase: ${await res.text()}`)
  return res.json()
}

// Menor que el proxy_read_timeout de nginx (340s) a propósito: así el backend siempre
// alcanza a responder con un error prolijo antes de que nginx corte la conexión en seco con
// un 504 sin explicación (el proyecto de Supabase igual termina de crearse en background,
// pero el usuario nunca se entera de si funcionó o no si nginx corta primero).
export async function waitForProjectReady(accessToken, projectRef, timeoutMs = 260 * 1000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const project = await getProject(accessToken, projectRef)
    if (project.status === 'ACTIVE_HEALTHY') return project
    if (/FAILED/i.test(project.status || '')) {
      throw new Error(`El proyecto de Supabase falló al aprovisionarse (status: ${project.status})`)
    }
    await new Promise((r) => setTimeout(r, 5000))
  }
  throw new Error('Tiempo de espera agotado aprovisionando el proyecto de Supabase')
}

export async function runManagementQuery(accessToken, projectRef, sql) {
  const res = await fetch(`${API_BASE}/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  if (!res.ok) {
    const errorText = await res.text();
    if (res.status === 504 || errorText.includes('timeout') || errorText.includes('Connection terminated')) {
      throw new Error('El proyecto de Supabase parece estar pausado o despertando. Por favor, asegúrate de reactivarlo en supabase.com/dashboard');
    }
    throw new Error(`Error ejecutando SQL vía Management API: ${errorText}`);
  }
  return res.json()
}
