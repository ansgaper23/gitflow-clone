import { listProjectFiles, readProjectFile } from './projectStorage.js'

// Detección "best effort" de las rutas de la app, leyendo el código en vez de solo los
// enlaces visibles — así aparecen también páginas que no están linkeadas desde ningún lado
// (como un panel admin aparte), no solo las que ya se pueden navegar clic a clic.
const CANDIDATE_NAME_RE = /(rout|app\.(jsx|tsx|js|ts)$|main\.(jsx|tsx|js|ts)$)/i
const MAX_CANDIDATE_FILES = 25
const MAX_FILE_CHARS = 200_000

const JSX_ROUTE_RE = /<Route\s[^>]*\bpath\s*=\s*["'`]([^"'`]*)["'`]/g
const OBJECT_ROUTE_RE = /\bpath\s*:\s*["'`](\/[^"'`]*)["'`]/g
// La mayoría de los proyectos que genera la IA en este codebase NO usan react-router — arman
// el ruteo a mano comparando window.location.pathname (ver PATRÓN típico en el system prompt
// del agente). Estos patrones cubren esos casos para que igual aparezcan en el selector.
const COMPARISON_ROUTE_RE = /\b\w+\s*===?\s*["'`](\/[a-zA-Z0-9\-_/]*)["'`]/g
const COMPARISON_ROUTE_RE_REVERSED = /["'`](\/[a-zA-Z0-9\-_/]*)["'`]\s*===?\s*\w+\b/g
const CASE_ROUTE_RE = /\bcase\s+["'`](\/[a-zA-Z0-9\-_/]*)["'`]\s*:/g
const STARTS_WITH_ROUTE_RE = /\.startsWith\(\s*["'`](\/[a-zA-Z0-9\-_/]*)["'`]/g

function normalizePath(raw) {
  if (!raw) return null
  if (raw.includes('*')) return null // catch-all / 404, no es una página a la que navegar
  if (raw.includes('${') || raw.includes('+')) return null // armada dinámicamente, no es un literal
  let p = raw.startsWith('/') ? raw : `/${raw}`
  p = p.replace(/\/+$/, '') || '/'
  return p
}

export async function discoverRoutes(project, accessToken, signal) {
  const allFiles = await listProjectFiles(project, accessToken, signal)
  const candidates = allFiles
    .map((f) => f.path)
    .filter((p) => /\.(jsx?|tsx?)$/i.test(p) && CANDIDATE_NAME_RE.test(p))
    .slice(0, MAX_CANDIDATE_FILES)

  const paths = new Set(['/'])
  for (const path of candidates) {
    if (signal?.aborted) break
    try {
      const content = await readProjectFile(project, accessToken, path, signal, true)
      if (typeof content !== 'string' || content.length > MAX_FILE_CHARS) continue
      for (const re of [
        JSX_ROUTE_RE,
        OBJECT_ROUTE_RE,
        COMPARISON_ROUTE_RE,
        COMPARISON_ROUTE_RE_REVERSED,
        CASE_ROUTE_RE,
        STARTS_WITH_ROUTE_RE,
      ]) {
        for (const m of content.matchAll(re)) {
          const p = normalizePath(m[1])
          if (p) paths.add(p)
        }
      }
    } catch {
      // archivo no accesible o ilegible: seguimos con el resto de los candidatos
    }
  }

  return Array.from(paths).sort((a, b) => (a === '/' ? -1 : b === '/' ? 1 : a.localeCompare(b)))
}
