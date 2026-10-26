import { getFileContent } from './github.js'

const SUPABASE_URL_RE = /https?:\/\/([a-z0-9]{15,25})\.supabase\.co/i
const CONFIG_TOML_RE = /project_id\s*=\s*["']([a-z0-9]+)["']/i

const CANDIDATE_FILES = ['supabase/config.toml', '.env', '.env.example', '.env.local']

// Busca en archivos comunes del repo a qué proyecto de Supabase apunta el código.
export async function detectRepoSupabaseRef(accessToken, owner, repo) {
  for (const path of CANDIDATE_FILES) {
    try {
      const content = await getFileContent(accessToken, owner, repo, path)
      if (path.endsWith('config.toml')) {
        const match = content.match(CONFIG_TOML_RE)
        if (match) return { ref: match[1], source: path }
      } else {
        const match = content.match(SUPABASE_URL_RE)
        if (match) return { ref: match[1], source: path }
      }
    } catch {
      // el archivo no existe en este repo o no se pudo leer: seguimos probando otros
    }
  }
  return null
}

export function extractRefFromConnectionString(connectionString) {
  if (!connectionString) return null
  try {
    const url = new URL(connectionString.replace(/^postgres:\/\//, 'postgresql://'))
    const userMatch = decodeURIComponent(url.username || '').match(/^postgres\.([a-z0-9]+)$/i)
    if (userMatch) return userMatch[1]
    const hostMatch = url.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i)
    if (hostMatch) return hostMatch[1]
    return null
  } catch {
    return null
  }
}
