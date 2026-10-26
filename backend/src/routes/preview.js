import { runtimeBus } from '../services/runtimeBus.js'
import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { isPreviewConfigured } from '../config.js'
import { startPreview, getPreviewStatus, stopPreview, ensurePreviewRunning } from '../services/previewOrchestrator.js'
import { supabase } from '../db/supabaseClient.js'
import { resolveDbConnection } from '../services/dbConnectionResolver.js'
import { buildPreviewEnvVars } from '../services/previewEnv.js'
import { getProjectSecretsMap } from '../services/projectSecrets.js'
import { getOwnedProject, getOwnedProjectByRepo, isVirtualRepo } from '../services/projectResolver.js'
import { captureProjectThumbnailAsync } from '../services/projectThumbnail.js'
import { signPreviewToken, verifyPreviewToken } from '../services/previewAccess.js'
import { getValidGithubToken } from '../services/github.js'

export const previewRouter = Router()

// El link público (slug.flow-pro.online) no muestra nada hasta que el proyecto se publica —
// mientras tanto, solo el propio dueño puede verlo, con este token firmado que nginx exige
// (auth_request) para dejar pasar al dev server. Se agrega acá, no en el orquestador, porque
// solo el backend principal conoce el JWT_SECRET.
function withPreviewToken(status) {
  if (!status?.url) return status
  try {
    const slug = new URL(status.url).hostname.split('.')[0]
    return { ...status, previewToken: signPreviewToken(slug) }
  } catch {
    return status
  }
}

// La llama nginx (auth_request), no el navegador — valida el token antes de proxear un
// visitante anónimo al dev server. Pública a propósito: el token ES la credencial acá, no una
// sesión de usuario (nginx no tiene forma de mandar el JWT normal de la app en esta subrequest).
function parseCookies(header) {
  const out = {}
  for (const part of String(header || '').split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim())
  }
  return out
}

const wakingSlugs = new Map()

function triggerAutoWakeIfNeeded(slug, originalUri) {
  if (!isPreviewConfigured || !slug) return
  const pathOnly = (originalUri || '').split('?')[0]
  const isPageNav = pathOnly === '/' || pathOnly === '' || pathOnly.endsWith('.html')
  if (!isPageNav) return

  const now = Date.now()
  const lastAttempt = wakingSlugs.get(slug) || 0
  if (now - lastAttempt < 30_000) return // Cooldown: already waking or woke recently

  wakingSlugs.set(slug, now)

  // Fire-and-forget: despertar asíncronamente el contenedor si está frío o drenado
  ;(async () => {
    try {
      const { data: project } = await supabase
        .from('projects')
        .select('*')
        .eq('slug', slug)
        .maybeSingle()
      if (!project) return

      const ownerKey = `user:${project.user_id}`
      let status
      try {
        status = await getPreviewStatus(ownerKey, project.repo_full_name)
      } catch {
        status = null
      }

      if (status?.status === 'running' || status?.status === 'starting') {
        return
      }

      const { data: user } = await supabase
        .from('users')
        .select('*')
        .eq('id', project.user_id)
        .maybeSingle()
      if (!user) return

      console.log(`[AutoWake] Disparando auto-wake para slug "${slug}" (${project.repo_full_name})...`)
      await ensurePreviewRunning(user, project)
    } catch (err) {
      console.warn(`[AutoWake] Error auto-despertando slug ${slug}:`, err.message)
    }
  })()
}

previewRouter.get('/verify-token', (req, res) => {
  const slug = String(req.query.slug || '')

  // nginx manda la URI original completa (con el ?_pt=... adentro) por header — $arg__pt
  // directo en el proxy_pass de la subrequest de auth_request no resultó confiable.
  const originalUri = String(req.headers['x-original-uri'] || '')
  let token = new URLSearchParams(originalUri.split('?')[1] || '').get('_pt') || ''

  // Esta subrequest no solo se dispara para la navegación inicial (esa sí trae ?_pt= en su
  // propia URL) — también para CADA recurso que Vite carga después: el cliente de HMR,
  // main.jsx, y (más profundo todavía) cada import DE ESOS archivos (react.js, App.jsx, los
  // deps pre-bundleados). El navegador nunca copia el query string de la página a esos
  // pedidos, y el Referer de un import transitivo apunta al archivo que lo importó (que
  // TAMPOCO tiene el token en su URL) — así que ni el query string ni el Referer alcanzan más
  // allá de un salto. La solución real es una cookie de sesión: la primera vez que un pedido
  // sí trae el token válido (navegación inicial o Referer de primer nivel), la dejamos puesta
  // acá abajo y el navegador la manda sola en TODOS los pedidos siguientes a este host, sin
  // importar cuántos niveles de import haya.
  if (!token) {
    try {
      token = new URL(String(req.headers['referer'] || '')).searchParams.get('_pt') || ''
    } catch {
      token = ''
    }
  }
  if (!token) {
    token = parseCookies(req.headers['cookie'])['fp_pt'] || ''
  }

  const ok = verifyPreviewToken(slug, token)
  if (ok) {
    // Set-Cookie de una subrequest de auth_request no llega sola al cliente — nginx tiene que
    // capturarla explícitamente con auth_request_set + add_header (ver gitflow-preview-subdomains).
    res.set('Set-Cookie', `fp_pt=${encodeURIComponent(token)}; Path=/; Max-Age=1800; HttpOnly; Secure; SameSite=Lax`)
    triggerAutoWakeIfNeeded(slug, originalUri)
  }
  res.sendStatus(ok ? 204 : 403)
})

previewRouter.get('/status', requireAuth, async (req, res) => {
  if (!isPreviewConfigured) return res.json({ status: 'unavailable' })
  try {
    const { projectId } = req.query
    let repoFullName = null
    if (projectId) {
      const project = await getOwnedProject(req.user.id, projectId).catch(() => null)
      if (project) repoFullName = project.repo_full_name
    }
    const status = withPreviewToken(await getPreviewStatus(`user:${req.user.id}`, repoFullName))
    res.json(status)

    // Fire-and-forget: no bloquea la respuesta de arriba, y cualquier error queda contenido
    // adentro de captureProjectThumbnailAsync (nunca llega a romper este endpoint).
    if (status?.status === 'running' && status.url && status.repoFullName) {
      getOwnedProjectByRepo(req.user.id, status.repoFullName)
        .then((project) => {
          if (project && !project.thumbnail_url) captureProjectThumbnailAsync(project, status.url)
        })
        .catch(() => {})
    }
  } catch (err) {
    res.status(502).json({ error: 'No se pudo consultar el estado del preview', detail: err.message })
  }
})

previewRouter.post('/start', requireAuth, async (req, res) => {
  const { projectId } = req.body
  if (!projectId) return res.status(400).json({ error: 'Falta projectId' })
  if (!isPreviewConfigured) {
    return res.status(503).json({ error: 'El servicio de preview no está configurado en el backend' })
  }

  let project
  try {
    project = await getOwnedProject(req.user.id, projectId)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })

  if (!isVirtualRepo(project.repo_full_name) && !req.user.github_access_token) {
    return res.status(403).json({ error: 'Conecta tu cuenta de GitHub para continuar', code: 'github_not_connected' })
  }

  try {
    let envVars
    try {
      const dbConnection = await resolveDbConnection(req.user, project.repo_full_name)
      envVars = await buildPreviewEnvVars(dbConnection)
    } catch {
      // Si falla resolver la conexión de BD, usamos el mismo placeholder que buildPreviewEnvVars(null).
      envVars = await buildPreviewEnvVars(null)
    }
    try {
      const secrets = await getProjectSecretsMap(project.id)
      envVars = { ...envVars, ...secrets }
    } catch {
      // Best-effort: si falla leer los secrets, el preview arranca igual sin ellos en vez de
      // no arrancar por algo que ni siquiera pidió el usuario en este turno.
    }
    let accessToken = req.user.github_access_token
    if (!isVirtualRepo(project.repo_full_name)) {
      accessToken = (await getValidGithubToken(req.user)) || req.user.github_access_token
    }
    const result = await startPreview({
      ownerKey: `user:${req.user.id}`,
      project,
      accessToken,
      envVars,
    })
    res.json(withPreviewToken(result))
  } catch (err) {
    res.status(502).json({ error: 'No se pudo iniciar el preview', detail: err.message })
  }
})

previewRouter.post('/restart', requireAuth, async (req, res) => {
  const { projectId } = req.body
  if (!projectId) return res.status(400).json({ error: 'Falta projectId' })
  if (!isPreviewConfigured) {
    return res.status(503).json({ error: 'El servicio de preview no está configurado en el backend' })
  }

  let project
  try {
    project = await getOwnedProject(req.user.id, projectId)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' })

  if (!isVirtualRepo(project.repo_full_name) && !req.user.github_access_token) {
    return res.status(403).json({ error: 'Conecta tu cuenta de GitHub para continuar', code: 'github_not_connected' })
  }

  try {
    let envVars
    try {
      const dbConnection = await resolveDbConnection(req.user, project.repo_full_name)
      envVars = await buildPreviewEnvVars(dbConnection)
    } catch {
      envVars = await buildPreviewEnvVars(null)
    }
    try {
      const secrets = await getProjectSecretsMap(project.id)
      envVars = { ...envVars, ...secrets }
    } catch {}

    let accessToken = req.user.github_access_token
    if (!isVirtualRepo(project.repo_full_name)) {
      accessToken = (await getValidGithubToken(req.user)) || req.user.github_access_token
    }
    const result = await startPreview({
      ownerKey: `user:${req.user.id}`,
      project,
      accessToken,
      envVars,
    })
    res.json(withPreviewToken(result))
  } catch (err) {
    res.status(502).json({ error: 'No se pudo reiniciar el preview', detail: err.message })
  }
})

previewRouter.post('/stop', requireAuth, async (req, res) => {
  if (!isPreviewConfigured) return res.json({ status: 'idle' })
  try {
    const { projectId } = req.body || {}
    let repoFullName = null
    if (projectId) {
      const project = await getOwnedProject(req.user.id, projectId).catch(() => null)
      if (project) repoFullName = project.repo_full_name
    }
    const result = await stopPreview(`user:${req.user.id}`, repoFullName)
    res.json(result)
  } catch (err) {
    res.status(502).json({ error: 'No se pudo detener el preview', detail: err.message })
  }
})

previewRouter.post('/runtime-report', (req, res) => {
  const { sessionId, message, stack, source, filename, lineno, colno, projectId } = req.body || {};
  const targetKey = sessionId || projectId;
  if (targetKey && (message || stack)) {
    runtimeBus.notifyError(targetKey, {
      message,
      stack,
      source: source || 'PREVIEW_RUNTIME',
      filename,
      lineno,
      colno,
      sessionId,
      projectId
    });
  }
  return res.status(204).end();
});

