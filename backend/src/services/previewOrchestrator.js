import { config } from '../config.js'
import { isVirtualRepo } from './projectResolver.js'
import { readAllProjectFiles } from './projectStorage.js'
import { resolveDbConnection } from './dbConnectionResolver.js'
import { buildPreviewEnvVars } from './previewEnv.js'
import { getProjectSecretsMap } from './projectSecrets.js'
import { getValidGithubToken } from './github.js'

async function orchestratorFetch(path, options = {}) {
  const res = await fetch(`${config.previewOrchestratorUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.previewOrchestratorSecret}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Orquestador de preview respondió ${res.status}: ${text}`)
  }
  return res.json()
}

// Convierte las filas planas de project_files en el mapa {path: {content, isBase64}}
// que espera el orquestador para escribir el proyecto virtual directo a disco.
async function buildVirtualFilesPayload(project) {
  const files = await readAllProjectFiles(project)
  const payload = {}
  for (const f of files) payload[f.path] = { content: f.content, isBase64: f.is_base64 }
  return payload
}

export async function startPreview({ ownerKey, project, accessToken, envVars }) {
  if (isVirtualRepo(project.repo_full_name)) {
    const files = await buildVirtualFilesPayload(project)
    return orchestratorFetch('/start', {
      method: 'POST',
      body: JSON.stringify({
        ownerKey,
        mode: 'virtual',
        repoFullName: project.repo_full_name,
        slugHint: project.slug,
        files,
        envVars,
      }),
    })
  }
  const cloneUrl = `https://x-access-token:${accessToken}@github.com/${project.repo_full_name}.git`
  return orchestratorFetch('/start', {
    method: 'POST',
    body: JSON.stringify({ ownerKey, mode: 'github', repoFullName: project.repo_full_name, cloneUrl, branch: project.branch, envVars, slugHint: project.slug }),
  })
}

// Compartido por restartPreviewIfRunning y ensurePreviewRunning — resuelve la conexión de base
// de datos actual + secrets del proyecto, con el mismo fallback a placeholder que routes/preview.js.
async function buildEnvVarsFor(user, project) {
  let envVars
  try {
    const dbConnection = await resolveDbConnection(user, project.repo_full_name)
    envVars = await buildPreviewEnvVars(dbConnection)
  } catch {
    envVars = await buildPreviewEnvVars(null)
  }
  try {
    const secrets = await getProjectSecretsMap(project.id)
    envVars = { ...envVars, ...secrets }
  } catch {
    // best-effort, igual que en routes/preview.js
  }
  return envVars
}

// Las env vars de la base de datos (VITE_DB_PROXY_URL/TOKEN, VITE_SUPABASE_URL/ANON_KEY) solo se
// calculan al ARRANCAR el proceso del dev server (van en su "env", ver runStart en el
// orquestador) — a diferencia de un cambio de código, que refreshPreview() aplica en caliente
// sin reiniciar nada. Si el usuario conecta o cambia de base de datos mientras ya tiene un
// preview corriendo, ese proceso sigue vivo con las env vars viejas (o sin ninguna) hasta que
// alguien lo reinicie — antes eso pasaba silenciosamente y la app fallaba con "Error de
// servidor" al primer intento de leer/escribir datos, sin ninguna pista de por qué. Se llama
// best-effort (nunca tira) después de crear/cambiar una conexión de base de datos, para que el
// preview ya activo, si hay uno, recoja las credenciales nuevas solo.
export async function restartPreviewIfRunning(user, project) {
  const ownerKey = `user:${user.id}`
  let status
  try {
    status = await getPreviewStatus(ownerKey, project.repo_full_name)
  } catch {
    return // orquestador no configurado/no disponible — no hay nada que reiniciar
  }
  if (status?.status !== 'running' || status.repoFullName !== project.repo_full_name) return

  const envVars = await buildEnvVarsFor(user, project)
  const accessToken = user.github_access_token ? (await getValidGithubToken(user)) : null
  await startPreview({ ownerKey, project, accessToken, envVars })
}

// Para agent.js#restart_preview (herramienta que el AGENTE mismo puede llamar, a diferencia de
// restartPreviewIfRunning de arriba, que se dispara solo desde el backend después de ciertas
// acciones). El orquestador SIEMPRE mata el proceso viejo del cupo antes de levantar uno nuevo
// (ver runStart/killSlot en server.mjs) — a diferencia de refreshPreview() (que solo re-escribe
// los archivos para que el propio Vite los recargue en caliente, sin matar el proceso), esto es
// un reinicio real de punta a punta. Hace falta para clases de error que un simple re-sync de
// archivos NUNCA arregla: el runner de módulos SSR de Vite puede quedar con su canal de
// transporte roto ("transport was disconnected") tras una ráfaga de muchos hot-reloads seguidos
// (ej. varias etapas de una migración larga editando rutas casi al mismo tiempo) — un proceso
// nuevo trae un runner/canal nuevo, sin ese estado corrupto. Recibe `dbConnection` ya resuelto
// (agent.js lo tiene a mano) en vez de user completo, para no tener que volver a resolverlo.
export async function restartPreviewForAgent({ ownerKey, project, accessToken, dbConnection }) {
  let envVars
  try {
    envVars = await buildPreviewEnvVars(dbConnection)
  } catch {
    envVars = await buildPreviewEnvVars(null)
  }
  try {
    const secrets = await getProjectSecretsMap(project.id)
    envVars = { ...envVars, ...secrets }
  } catch {
    // best-effort, igual que buildEnvVarsFor
  }
  await startPreview({ ownerKey, project, accessToken, envVars })

  // startPreview responde apenas arranca el proceso en background (ver /start del orquestador),
  // no cuando termina de instalar/levantar — sin esperar acá, el agente llamaría a
  // "check_preview_errors"/"test_preview" inmediatamente después contra un servidor que todavía
  // ni siquiera arrancó, y se confundiría con eso ("no hay preview corriendo") en vez de con el
  // resultado real del reinicio. Mismo tope de 100s que ensurePreviewRunning.
  const deadline = Date.now() + 100_000
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 3000))
    let status
    try {
      status = await getPreviewStatus(ownerKey, project.repo_full_name)
    } catch {
      return { status: 'error', error: 'No se pudo consultar el estado tras reiniciar' }
    }
    if (status?.status === 'running' && status.repoFullName === project.repo_full_name) return status
    if (status?.status === 'error') return status
  }
  return { status: 'error', error: 'Tiempo de espera agotado reiniciando el servidor de desarrollo' }
}

// Usado antes de disparar el turno automático de "conectar código" (ver dbImport.js): si no hay
// preview corriendo todavía, el agente no tiene forma de usar "test_preview" para comprobar de
// verdad que el login/los datos funcionan, y termina confiando en su propia palabra — que ya
// demostró fallar (ver conversationTurn.js/triggerAutoTurn). Arranca el preview si hace falta y
// espera (hasta 100s, instalar dependencias + arrancar puede tardar) a que quede 'running' antes
// de devolver — best-effort: si no llega a tiempo, el turno igual se dispara sin poder verificar.
export async function ensurePreviewRunning(user, project) {
  const ownerKey = `user:${user.id}`
  let status
  try {
    status = await getPreviewStatus(ownerKey, project.repo_full_name)
  } catch {
    return false
  }
  if (status?.status === 'running' && status.repoFullName === project.repo_full_name) return true

  try {
    const envVars = await buildEnvVarsFor(user, project)
    const accessToken = user.github_access_token ? (await getValidGithubToken(user)) : null
    await startPreview({ ownerKey, project, accessToken, envVars })
  } catch {
    return false
  }

  const deadline = Date.now() + 100_000
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 3000))
    try {
      status = await getPreviewStatus(ownerKey, project.repo_full_name)
    } catch {
      return false
    }
    if (status?.status === 'running' && status.repoFullName === project.repo_full_name) return true
    if (status?.status === 'error') return false
  }
  return false
}

export function getPreviewStatus(ownerKey, repoFullName = null) {
  let url = `/status?ownerKey=${encodeURIComponent(ownerKey)}`
  if (repoFullName) url += `&repoFullName=${encodeURIComponent(repoFullName)}`
  return orchestratorFetch(url)
}

export function stopPreview(ownerKey, repoFullName = null) {
  return orchestratorFetch('/stop', {
    method: 'POST',
    body: JSON.stringify({ ownerKey, ...(repoFullName ? { repoFullName } : {}) }),
  })
}

// Diagnóstico para /admin (panel de estado del sistema): un cupo por slot con quién lo tiene y
// en qué estado — mismo endpoint /pool que ya existía para operar el orquestador a mano.
export function getPreviewPool() {
  return orchestratorFetch('/pool')
}

// Se llama tras aprobar un cambio (ya aplicado en GitHub o en project_files) para que el
// preview activo del usuario, si hay uno corriendo, refleje el cambio sin re-arrancar.
// Best-effort: si el usuario no tiene preview corriendo, el orquestador responde refreshed:false.
export async function refreshPreview(ownerKey, project) {
  const repoFullName = project?.repo_full_name
  if (project && isVirtualRepo(project.repo_full_name)) {
    const files = await buildVirtualFilesPayload(project)
    return orchestratorFetch('/refresh', {
      method: 'POST',
      body: JSON.stringify({ ownerKey, repoFullName, mode: 'virtual', files }),
    })
  }
  return orchestratorFetch('/refresh', {
    method: 'POST',
    body: JSON.stringify({ ownerKey, repoFullName, mode: 'github' }),
  })
}

export async function testVfsChanges(ownerKey, filesMap, repoFullName = null) {
  return orchestratorFetch('/refresh', {
    method: 'POST',
    body: JSON.stringify({ ownerKey, repoFullName, mode: 'github', files: filesMap }),
  })
}

// Purga física de los archivos de workspace en disco ante un hard reset de proyecto
export async function resetPreviewWorkspace(ownerKey, repoFullName = null) {
  try {
    return await orchestratorFetch('/reset-workspace', {
      method: 'POST',
      body: JSON.stringify({ ownerKey, ...(repoFullName ? { repoFullName } : {}) }),
    })
  } catch (err) {
    console.warn('[previewOrchestrator] resetPreviewWorkspace (best-effort):', err.message)
    return { ok: false, reset: false, error: err.message }
  }
}
