import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { supabase } from '../db/supabaseClient.js'
import { isVirtualRepo } from './projectResolver.js'
import { readAllProjectFiles } from './projectStorage.js'
import { buildPreviewEnvVars } from './previewEnv.js'
import { getProjectSecretsMap } from './projectSecrets.js'
import { resolveDbConnection } from './dbConnectionResolver.js'

const execFileAsync = promisify(execFile)

// A diferencia del preview (un servidor Vite vivo, con hot-reload, que el orquestador mata a
// los 20 min de inactividad), esto genera un build estático real y lo deja guardado acá — es
// lo que sirve nginx cuando alguien entra a slug.flow-pro.online o a un dominio propio, sin
// depender de que el dueño tenga el editor abierto.
const PUBLISHED_ROOT = process.env.PUBLISHED_DIR || '/opt/gitflow-published'
const BUILD_ROOT = process.env.PUBLISH_BUILD_DIR || '/opt/gitflow-publish-build'

// Esta VPS tiene muy poca RAM (1GB) — un "npm install" de más puede tirar abajo el proceso
// principal (el mismo que atiende el chat de todo el mundo). En vez de dejar que publicaciones
// simultáneas compitan por memoria, se encolan: la próxima espera a que la anterior termine.
let publishQueue = Promise.resolve()

// execFile (vía promisify) tira un error cuyo .message es un resumen genérico ("Command failed:
// npm run build") — el motivo real (ej. un error de TypeScript, una dependencia faltante) queda
// en .stderr/.stdout, que nadie leía: ni los logs del servidor ni lo que veía el usuario ("no se
// pudo publicar: command failed npm", sin ninguna pista de por qué). Se lo agrega al mensaje acá,
// en el único lugar por el que pasan todos los comandos (git/npm) de esta publicación.
function run(cmd, args, opts) {
  return execFileAsync(cmd, args, { ...opts, maxBuffer: 20 * 1024 * 1024 }).catch((err) => {
    const output = (err.stderr || err.stdout || '').toString().trim()
    // "JavaScript heap out of memory" trae un crash dump nativo de V8 (direcciones de memoria,
    // stack de C++) que no le sirve a nadie del lado del usuario — se lo reemplaza por un
    // mensaje claro. No se puede simplemente subir el límite sin techo: es memoria real de un
    // VPS compartido con los previews de todos los usuarios.
    if (/JavaScript heap out of memory/.test(output)) {
      err.message = 'El build se quedó sin memoria antes de terminar. Suele pasar en proyectos muy grandes o con un framework full-stack (con renderizado del lado del servidor) — "Publicar" solo sirve archivos estáticos, así que ese tipo de proyecto puede no ser publicable tal cual, aunque su vista previa funcione bien.'
      throw err
    }
    if (output) err.message = `${err.message}\n${output.slice(-3000)}`
    throw err
  })
}

// Mismo criterio de sanitización que usa el orquestador para el .env del preview — se repite
// acá (no se importa desde ahí) porque vive en un proceso/repo aparte.
function writeEnvFile(dir, envVars) {
  if (!envVars || typeof envVars !== 'object') return
  const lines = Object.entries(envVars)
    .filter(([k, v]) => k && v != null)
    .map(([k, v]) => `${String(k).replace(/[^A-Z0-9_]/gi, '')}=${String(v).replace(/[\r\n]/g, '')}`)
  if (lines.length === 0) return
  fsSync.writeFileSync(path.join(dir, '.env'), lines.join('\n') + '\n')
}

async function writeVirtualFiles(destDir, files) {
  for (const f of files) {
    const fullPath = path.join(destDir, f.path)
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, Buffer.from(f.content, f.is_base64 ? 'base64' : 'utf8'))
  }
}

// Detecta si el checkout es un monorepo (Turborepo/pnpm workspaces) con una única app de
// Vite adentro (ej. "apps/web") y, si la encuentra, devuelve esa carpeta para compilarla
// ahí directamente con npm normal — sin necesitar pnpm/turbo instalados en la VPS ni tocar
// nada del repo del usuario. Nace de un caso real: un proyecto armado por la IA como
// monorepo (apps/web + apps/api en NestJS) cuyo build de raíz depende de "turbo run build"
// (pnpm workspaces), binarios que esta VPS no tiene instalados.
async function findMonorepoAppRoot(buildDir) {
  const isMonorepo = fsSync.existsSync(path.join(buildDir, 'pnpm-workspace.yaml')) ||
    fsSync.existsSync(path.join(buildDir, 'turbo.json'))
  if (!isMonorepo) return null

  const candidates = []
  for (const parent of ['apps', 'packages']) {
    let entries
    try {
      entries = await fs.readdir(path.join(buildDir, parent), { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const appDir = path.join(buildDir, parent, entry.name)
      const hasViteConfig = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs']
        .some((f) => fsSync.existsSync(path.join(appDir, f)))
      const hasIndexHtml = fsSync.existsSync(path.join(appDir, 'index.html'))
      if (hasViteConfig && hasIndexHtml) candidates.push(appDir)
    }
  }
  // Si hay más de una app de Vite (ej. "web" + "admin") no podemos adivinar cuál publicar —
  // se sigue con el comportamiento de siempre, que ahora al menos muestra el error real.
  return candidates.length === 1 ? candidates[0] : null
}

async function resolveEnvVars(project, user) {
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
    // Best-effort: publicar igual sin los secrets antes que no publicar nada.
  }
  return envVars
}

async function buildOnce(project, accessToken, user) {
  const buildDir = path.join(BUILD_ROOT, `${project.id}-${Date.now()}`)
  try {
    await fs.mkdir(buildDir, { recursive: true })

    if (isVirtualRepo(project.repo_full_name)) {
      const files = await readAllProjectFiles(project)
      await writeVirtualFiles(buildDir, files)
    } else {
      const cloneUrl = `https://x-access-token:${accessToken}@github.com/${project.repo_full_name}.git`
      const cloneArgs = ['clone', '--depth', '1']
      if (project.branch) cloneArgs.push('--branch', project.branch)
      cloneArgs.push(cloneUrl, buildDir)
      await run('git', cloneArgs, {})
    }

    // Si es un monorepo con una sola app de Vite adentro (ej. "apps/web"), se compila ahí
    // directamente — el .env también va en esa carpeta, porque Vite busca su .env junto al
    // vite.config.*, no en la raíz del repo.
    const monorepoAppRoot = await findMonorepoAppRoot(buildDir)
    const buildRoot = monorepoAppRoot || buildDir

    const envVars = await resolveEnvVars(project, user)
    writeEnvFile(buildRoot, envVars)

    // gitflow-backend corre con NODE_ENV=production (systemd) — heredarlo acá hace que "npm
    // install" salte las devDependencies (ahí vive "vite"), rompiendo el build siempre. El
    // build de un checkout limpio necesita TODAS las dependencias, como hace el orquestador
    // de previews (que no tiene NODE_ENV seteado y por eso nunca tuvo este problema).
    const installEnv = { ...process.env, NODE_OPTIONS: '--max-old-space-size=384', NODE_ENV: 'development' }
    // El build en sí necesita bastante más heap que instalar dependencias — un proyecto con un
    // framework full-stack (ej. TanStack Start: genera árbol de rutas + bundle de servidor
    // además del de cliente) revienta 384MB con "JavaScript heap out of memory" antes de
    // terminar. Las publicaciones ya van una por vez (ver "publishQueue" arriba), así que subir
    // el techo acá no compite con otra publicación — sigue acotado para no competir sin límite
    // con los previews activos del resto de usuarios en el mismo VPS.
    const buildEnv = { ...installEnv, NODE_OPTIONS: '--max-old-space-size=768' }
    await run('npm', ['install', '--no-audit', '--no-fund', '--prefer-offline'], { cwd: buildRoot, env: installEnv })
    await run('npm', ['run', 'build'], { cwd: buildRoot, env: buildEnv })

    const distDir = path.join(buildRoot, 'dist')
    if (!fsSync.existsSync(distDir)) {
      throw new Error('El build terminó pero no generó una carpeta "dist" — revisá el script "build" del proyecto.')
    }

    // Va con el SLUG, no el id — nginx (ver /etc/nginx/sites-available/gitflow-preview-
    // subdomains) resuelve el directorio a servir a partir de "$slug" (el subdominio del Host
    // que pide la página), no conoce el id del proyecto. Si el slug cambia después, este
    // directorio queda huérfano hasta la próxima publicación — aceptable por ahora.
    const finalDir = path.join(PUBLISHED_ROOT, project.slug)
    const stagingDir = path.join(PUBLISHED_ROOT, `${project.slug}_new`)
    await fs.rm(stagingDir, { recursive: true, force: true })
    await fs.rename(distDir, stagingDir)
    await fs.rm(finalDir, { recursive: true, force: true })
    await fs.rename(stagingDir, finalDir)

    const publishedAt = new Date().toISOString()
    const { error } = await supabase.from('projects').update({ published_at: publishedAt }).eq('id', project.id)
    if (error) throw error

    return { publishedAt }
  } finally {
    await fs.rm(buildDir, { recursive: true, force: true }).catch(() => {})
  }
}

export async function publishProject(project, accessToken, user) {
  const previous = publishQueue
  let release
  publishQueue = new Promise((r) => {
    release = r
  })
  await previous
  try {
    return await buildOnce(project, accessToken, user)
  } finally {
    release()
  }
}

export async function unpublishProject(project) {
  const finalDir = path.join(PUBLISHED_ROOT, project.slug)
  await fs.rm(finalDir, { recursive: true, force: true })
  const { error } = await supabase.from('projects').update({ published_at: null }).eq('id', project.id)
  if (error) throw error
}
