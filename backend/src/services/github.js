import { Octokit } from '@octokit/rest'
import { config } from '../config.js'
import { supabase } from '../db/supabaseClient.js'

export function githubClientFor(accessToken) {
  return new Octokit({ auth: accessToken })
}

// Mismo margen que usa getValidAccessToken() de supabaseOAuth.js: renueva un poco antes de que
// venza de verdad, para no arriesgarse a que expire a mitad de una request.
const REFRESH_SKEW_MS = 5 * 60 * 1000

// Un dashboard cargando dispara varias requests en paralelo (repos, proyectos, plan...), TODAS
// pasando por requireAuth -> getValidGithubToken casi al mismo tiempo. GitHub ROTA el
// refresh_token en cada uso (de un solo uso) — si dos requests lo leen antes de que la primera
// termine de guardar el nuevo, la segunda intenta refrescar con un refresh_token que GitHub ya
// invalidó, GitHub la rechaza (sin access_token en la respuesta), y esa request se queda con el
// access_token viejo (el que justamente ya estaba vencido) → 401 real contra /user/repos, pese a
// que el refresh "funcionó" un instante antes para la otra request. Un Map por user id hace que
// todas las requests concurrentes de un mismo usuario esperen el MISMO refresh en curso en vez
// de pisarse el refresh_token entre sí.
const refreshInFlight = new Map()

// La app OAuth de FlowPro en GitHub tiene "expiring user tokens" activado: el access_token
// vence cada 8hs, mucho antes de que termine una sesión de FlowPro (hasta 365 días) — sin esto,
// cualquier usuario que no haya vuelto a pasar por el login de GitHub en las últimas 8hs se
// topaba con "Bad credentials" en cualquier acción que tocara su repo, hasta reconectar a mano.
// Se llama una vez por request desde requireAuth (middleware/auth.js) — así ninguna de las
// rutas que ya leen "req.user.github_access_token" directamente necesita cambiar: para cuando
// llegan a leerlo, ya está renovado si hacía falta.
export async function getValidGithubToken(user) {
  if (!user.github_access_token) return null
  // Sin fecha de vencimiento o sin refresh_token registrados: token viejo (de antes de este
  // fix) o la app tiene la expiración desactivada — se asume vigente, no hay con qué renovarlo
  // igual. Si de verdad está vencido, la próxima llamada a GitHub va a fallar con 401 y el
  // usuario va a tener que reconectar una vez más (ahí sí quedan guardados los campos nuevos).
  if (!user.github_token_expires_at || !user.github_refresh_token) return user.github_access_token

  const expiresAt = new Date(user.github_token_expires_at).getTime()
  if (expiresAt - REFRESH_SKEW_MS > Date.now()) return user.github_access_token

  // Si ya hay un refresh en curso para este usuario (otra request concurrente llegó primero),
  // esperamos ESA promesa en vez de arrancar una segunda con el mismo refresh_token.
  if (refreshInFlight.has(user.id)) {
    const token = await refreshInFlight.get(user.id)
    if (token) Object.assign(user, token)
    return user.github_access_token
  }

  const promise = refreshGithubToken(user)
  refreshInFlight.set(user.id, promise)
  try {
    const token = await promise
    if (token) Object.assign(user, token)
    return user.github_access_token
  } finally {
    refreshInFlight.delete(user.id)
  }
}

// Hace el refresh real contra GitHub y persiste el resultado — separado de getValidGithubToken
// para que el Map de arriba pueda compartir esta única promesa entre requests concurrentes.
// Devuelve los campos nuevos a mergear en "user" (o null si no se pudo renovar, dejando el
// access_token viejo tal cual estaba).
async function refreshGithubToken(user) {
  let data
  try {
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: config.githubClientId,
        client_secret: config.githubClientSecret,
        grant_type: 'refresh_token',
        refresh_token: user.github_refresh_token,
      }),
    })
    data = await res.json()
  } catch {
    return null // sin conexión a GitHub ahora mismo: seguimos con el viejo, que ya vale lo que vale
  }

  // El refresh_token también puede vencer o ser revocado (GitHub: dura ~6 meses, se renueva
  // solo con cada uso) — ahí no hay forma de evitar que el usuario reconecte una vez más.
  if (!data.access_token) return null

  const newExpiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : null
  const updated = {
    github_access_token: data.access_token,
    github_refresh_token: data.refresh_token || user.github_refresh_token,
    github_token_expires_at: newExpiresAt,
  }
  await supabase.from('users').update(updated).eq('id', user.id)
  return updated
}

// El token de GitHub del usuario puede quedar inválido (revocado, expirado, contraseña
// cambiada) en cualquier momento sin que FlowPro se entere hasta el siguiente llamado a la
// API. Octokit marca ese caso con status 401 ("Bad credentials") — lo detectamos acá para
// que las rutas puedan pedirle al usuario que reconecte su cuenta en vez de mostrar un
// error genérico.
export function isGithubAuthError(err) {
  return err?.status === 401
}

// Respuesta homogénea para cuando falla una llamada a GitHub: si es por token inválido, un
// código que el frontend reconoce y muestra un botón "Reconectar GitHub"; si no, el genérico.
export function sendGithubAwareError(res, err, fallbackMessage, fallbackStatus = 500) {
  if (isGithubAuthError(err)) {
    return res.status(401).json({
      error: 'Tu conexión con GitHub expiró o fue revocada. Reconéctala para continuar.',
      code: 'github_reauth_required',
    })
  }
  return res.status(fallbackStatus).json({ error: fallbackMessage, detail: err.message })
}

export async function listUserRepos(accessToken) {
  const octokit = githubClientFor(accessToken)
  const repos = await octokit.paginate(octokit.repos.listForAuthenticatedUser, {
    per_page: 100,
    sort: 'updated',
  })
  return repos.map((r) => ({
    fullName: r.full_name,
    name: r.name,
    owner: r.owner.login,
    private: r.private,
    defaultBranch: r.default_branch,
    updatedAt: r.updated_at,
    description: r.description,
  }))
}

export async function getRepoTree(accessToken, owner, repo, branch, signal) {
  const octokit = githubClientFor(accessToken)
  const { data: repoInfo } = await octokit.repos.get({ owner, repo, request: { signal } })
  const ref = branch || repoInfo.default_branch
  const { data: refData } = await octokit.git.getRef({ owner, repo, ref: `heads/${ref}`, request: { signal } })
  const { data: tree } = await octokit.git.getTree({
    owner,
    repo,
    tree_sha: refData.object.sha,
    recursive: 'true',
    request: { signal },
  })
  return tree.tree
    .filter((entry) => entry.type === 'blob')
    .map((entry) => ({ path: entry.path, sha: entry.sha, size: entry.size }))
}

export async function getFileContent(accessToken, owner, repo, path, ref, signal) {
  const octokit = githubClientFor(accessToken)
  // Si no hay rama guardada, hay que resolverla a la rama por defecto explícitamente — pasar
  // `ref: null` tal cual a octokit arma la URL con "?ref=null" (la palabra "null" literal),
  // que GitHub no encuentra como rama y devuelve 404 siempre.
  let targetRef = ref
  if (!targetRef) {
    const { data: repoInfo } = await octokit.repos.get({ owner, repo, request: { signal } })
    targetRef = repoInfo.default_branch
  }
  const { data } = await octokit.repos.getContent({ owner, repo, path, ref: targetRef, request: { signal } })
  if (Array.isArray(data) || data.type !== 'file') {
    throw new Error('La ruta no corresponde a un archivo')
  }
  return Buffer.from(data.content, 'base64').toString('utf-8')
}

// GitHub manda el motivo específico (nombre repetido, email sin verificar, límite de repos del
// plan, etc.) en un array "errors" aparte del mensaje genérico de arriba ("Repository creation
// failed.") — sin esto, tanto los logs como lo que ve el usuario se quedan con el genérico, que
// no dice nada sobre la causa real.
function describeGithubError(err) {
  const body = err.response?.data
  const fieldErrors = (body?.errors || [])
    .map((e) => e.message || `${e.field ? `${e.field}: ` : ''}${e.code || ''}`)
    .filter(Boolean)
  const detail = fieldErrors.length ? fieldErrors.join('; ') : null
  return detail ? `${body.message || err.message} (${detail})` : err.message
}

// GitHub rechaza la descripción de un repo si trae caracteres de control (\n, \t, o cualquier
// invisible que no sea espacio) — hallazgo real: la descripción es el prompt del usuario TAL
// CUAL (texto pegado de Word, con saltos de línea, etc.), nunca se había saneado. Los reemplaza
// por un espacio simple en vez de solo borrarlos, para no pegar dos palabras que quedaban
// separadas por un salto de línea.
const CONTROL_CHARS_RE = new RegExp(String.fromCharCode(91) + String.fromCharCode(0) + '-' + String.fromCharCode(31) + String.fromCharCode(127) + String.fromCharCode(93), 'g')

function sanitizeGithubText(text, maxLength) {
  return String(text || '')
    .replace(CONTROL_CHARS_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

// Crea un repositorio nuevo para el usuario autenticado. Si el nombre ya existe,
// reintenta agregando un sufijo aleatorio corto (hasta 5 intentos).
export async function createRepo(accessToken, desiredName, { private: isPrivate = true, description } = {}) {
  const octokit = githubClientFor(accessToken)
  let name = desiredName
  const safeDescription = description ? sanitizeGithubText(description, 350) : description

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const { data } = await octokit.repos.createForAuthenticatedUser({
        name,
        private: isPrivate,
        description: safeDescription,
        auto_init: true, // crea la rama por defecto con un commit inicial (README)
      })
      return { fullName: data.full_name, owner: data.owner.login, name: data.name, defaultBranch: data.default_branch }
    } catch (err) {
      const nameTaken = err.status === 422 && /already exists/i.test(JSON.stringify(err.response?.data || {}))
      if (nameTaken && attempt < 4) {
        name = `${desiredName}-${Math.random().toString(36).slice(2, 6)}`
        continue
      }
      const detailed = describeGithubError(err)
      console.error(`GitHub createRepo falló (status ${err.status}): ${detailed}`)
      err.message = detailed
      throw err
    }
  }
}

// Commitea varios archivos de una sola vez (un solo commit) usando la Git Data API,
// sobre la rama por defecto. `files` es un objeto { "ruta/archivo.js": "contenido" }.
// `files` values pueden ser un string (texto plano, formato histórico) o
// { content, isBase64 } para poder incluir binarios (imágenes) en el mismo commit,
// como hace falta al migrar un proyecto virtual con assets subidos a GitHub.
// `exact: true` arma el árbol SOLO con estos archivos (sin heredar del tree actual vía
// base_tree) — lo usa el restore de checkpoints para reconstruir un estado exacto de un
// proyecto virtual, incluyendo "borrar" archivos que ya no correspondan a ese punto.
export async function commitTree(accessToken, owner, repo, files, message, branch, { exact = false } = {}) {
  const octokit = githubClientFor(accessToken)
  const { data: repoInfo } = await octokit.repos.get({ owner, repo })
  const targetBranch = branch || repoInfo.default_branch

  const { data: refData } = await octokit.git.getRef({ owner, repo, ref: `heads/${targetBranch}` })
  const baseCommitSha = refData.object.sha
  const { data: baseCommit } = await octokit.git.getCommit({ owner, repo, commit_sha: baseCommitSha })

  const treeEntries = await Promise.all(
    Object.entries(files).map(async ([path, value]) => {
      const isBase64 = typeof value === 'object' && value !== null && value.isBase64
      const content = typeof value === 'object' && value !== null ? value.content : value
      if (isBase64) {
        const { data: blob } = await octokit.git.createBlob({ owner, repo, content, encoding: 'base64' })
        return { path, mode: '100644', type: 'blob', sha: blob.sha }
      }
      return { path, mode: '100644', type: 'blob', content }
    }),
  )

  const { data: newTree } = await octokit.git.createTree({
    owner,
    repo,
    ...(exact ? {} : { base_tree: baseCommit.tree.sha }),
    tree: treeEntries,
  })

  const { data: newCommit } = await octokit.git.createCommit({
    owner,
    repo,
    message,
    tree: newTree.sha,
    parents: [baseCommitSha],
  })

  await octokit.git.updateRef({ owner, repo, ref: `heads/${targetBranch}`, sha: newCommit.sha })

  return { commitUrl: newCommit.html_url, commitSha: newCommit.sha }
}

// Crea (o actualiza) el archivo directamente en la rama por defecto, con un commit propio.
// `contentIsBase64: true` para archivos binarios (imágenes) cuyo contenido ya viene en base64
// (no hay que re-codificarlo como si fuera texto UTF-8, se corrompería).
export async function commitFileChange({ accessToken, owner, repo, path, newContent, message, branch, contentIsBase64 }) {
  const octokit = githubClientFor(accessToken)
  const { data: repoInfo } = await octokit.repos.get({ owner, repo })
  const targetBranch = branch || repoInfo.default_branch

  let sha
  try {
    const { data: existing } = await octokit.repos.getContent({ owner, repo, path, ref: targetBranch })
    if (!Array.isArray(existing)) sha = existing.sha
  } catch (err) {
    if (err.status !== 404) throw err
  }

  const { data: commit } = await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message,
    content: contentIsBase64 ? newContent : Buffer.from(newContent, 'utf-8').toString('base64'),
    branch: targetBranch,
    sha,
  })

  return { commitUrl: commit.commit.html_url, commitSha: commit.commit.sha }
}

// Crea un commit nuevo cuyo árbol es EXACTAMENTE el de `commitSha` (sin fusionar con el HEAD
// actual) — restaura el proyecto al estado de ese commit sin reescribir el historial existente,
// como un checkpoint de Lovable: agrega un commit nuevo en vez de mover HEAD hacia atrás.
export async function restoreToCommit(accessToken, owner, repo, commitSha, message, branch) {
  const octokit = githubClientFor(accessToken)
  const { data: repoInfo } = await octokit.repos.get({ owner, repo })
  const targetBranch = branch || repoInfo.default_branch

  const { data: refData } = await octokit.git.getRef({ owner, repo, ref: `heads/${targetBranch}` })
  const currentHeadSha = refData.object.sha

  const { data: historicalCommit } = await octokit.git.getCommit({ owner, repo, commit_sha: commitSha })

  const { data: newCommit } = await octokit.git.createCommit({
    owner,
    repo,
    message,
    tree: historicalCommit.tree.sha,
    parents: [currentHeadSha],
  })

  await octokit.git.updateRef({ owner, repo, ref: `heads/${targetBranch}`, sha: newCommit.sha })

  return { commitUrl: newCommit.html_url, commitSha: newCommit.sha }
}
export async function deleteRepo(accessToken, owner, repo) {
  const octokit = githubClientFor(accessToken)
  await octokit.repos.delete({ owner, repo })
}
