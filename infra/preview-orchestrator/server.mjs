import express from 'express'
import { spawn, execFile, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { getRuntimeTelemetryProbeScript } from './runtimeTelemetryProbe.js'

// ---------------------------------------------------------------------------
// Pool de previews aisladas por usuario (POOL_SIZE cupos, cada uno con su propia carpeta y
// puerto). Reescrito desde una versión anterior que había quedado reducida a UN SOLO estado
// global compartido por toda la plataforma (probablemente por la RAM limitada del VPS antes de
// una ampliación) — eso rompía el aislamiento entre usuarios (cualquiera veía el repo/proyecto
// de quien fuera que tuviera el único cupo en ese momento) y, en el camino, se habían perdido
// también el modo "virtual" (proyectos sin GitHub), las env vars/secrets del proyecto, el
// endpoint /refresh, y la integración con el mapa de nginx por subdominio — el .env de este
// servicio ya tenía las variables para todo esto (PREVIEW_POOL_SIZE, etc.), el código
// simplemente no las usaba.
// ---------------------------------------------------------------------------

const PORT = Number(process.env.ORCH_PORT || 4000)
const SECRET = process.env.ORCH_SECRET
const PUBLIC_HOST = process.env.PUBLIC_HOST
const PUBLIC_SCHEME = process.env.PUBLIC_SCHEME || 'https'
const POOL_SIZE = Number(process.env.PREVIEW_POOL_SIZE || 3)
const BASE_PORT = Number(process.env.PREVIEW_BASE_INTERNAL_PORT || 4101)
const NGINX_MAP_PATH = process.env.PREVIEW_NGINX_MAP_PATH || '/etc/nginx/conf.d/preview-map.conf'
const WORKSPACE_ROOT = '/opt/gitflow-previews'
const IDLE_TIMEOUT_MS = 20 * 60 * 1000

fs.mkdirSync(WORKSPACE_ROOT, { recursive: true })

// Un cupo = un slot. "ownerKey" (formato "user:<id>", lo define el backend) identifica de quién
// es — null significa libre. Nunca se expone el estado de un slot a nadie que no sea su dueño
// (ver GET /status): esa comprobación es la que faltaba en la versión anterior.
const slots = Array.from({ length: POOL_SIZE }, (_, i) => ({
  index: i,
  port: BASE_PORT + i,
  workdir: path.join(WORKSPACE_ROOT, `workspace-${i}`),
  ownerKey: null,
  repoFullName: null,
  slug: null,
  status: 'idle', // idle | cloning | installing | starting | running | error
  url: null,
  error: null,
  child: null,
  generation: 0, // invalida operaciones en curso si el mismo cupo arranca otra cosa mientras tanto
  lastPing: 0,
}))

function logFile(slot) {
  return path.join(WORKSPACE_ROOT, `preview-${slot.index}.log`)
}

function log(slot, msg) {
  fs.appendFileSync(logFile(slot), `[${new Date().toISOString()}] ${msg}\n`)
}

function killSlot(slot) {
  if (slot.child) {
    try {
      process.kill(-slot.child.pid, 'SIGKILL')
    } catch {
      /* ya estaba muerto */
    }
    slot.child = null
  }
  try {
    execSync(`docker rm -f -v preview-${slot.index}`, { stdio: 'ignore' })
  } catch {}
}

function resetSlot(slot) {
  killSlot(slot)
  slot.ownerKey = null
  slot.repoFullName = null
  slot.slug = null
  slot.status = 'idle'
  slot.url = null
  slot.error = null
  slot.generation++
  slot.lastPing = 0
  slot.lastActivity = 0
  slot.isBusy = false
}

const MAX_PER_USER = Number(process.env.MAX_PREVIEWS_PER_USER || 2)

function findSlotByOwner(ownerKey) {
  return slots.find((s) => s.ownerKey === ownerKey) || null
}

function findSlotByOwnerAndRepo(ownerKey, repoFullName) {
  return slots.find((s) => s.ownerKey === ownerKey && s.repoFullName === repoFullName) || null
}

function findSlotsByOwner(ownerKey) {
  return slots.filter((s) => s.ownerKey === ownerKey)
}

function findFreeSlot() {
  return slots.find((s) => s.ownerKey === null) || null
}

// POLÍTICA LRU CON ESTADO DE DRENAJE (FASE 4)
// Selecciona el cupo con lastActivity más antiguo, ignorando cupos en starting,
// ejecutando git commit o con un turno/build activo (isBusy).
function findLruSlot() {
  const evictableCandidates = slots.filter((s) => {
    if (s.status === 'starting' || s.status === 'installing' || s.status === 'cloning' || s.status === 'draining') return false
    if (s.isBusy) return false
    return true
  })

  const pool = evictableCandidates.length > 0 ? evictableCandidates : slots
  return pool.slice().sort((a, b) => (a.lastActivity || a.lastPing || 0) - (b.lastActivity || b.lastPing || 0))[0]
}

// Igual que slugify() del backend ([a-z0-9-]) — "slugHint" ya viene sanitizado desde ahí
// (project.slug es único por proyecto en toda la plataforma), esto es una segunda capa de
// defensa nomás, nunca confiar un valor que termina en un Host de nginx sin revalidar acá.
function sanitizeSlug(raw) {
  const s = String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return s || null
}

// Reescribe el mapa slug -> puerto interno que usa nginx (gitflow-preview-subdomains) para
// rutear <slug>.flow-pro.online al cupo correcto, y le pide a nginx que lo recargue. Se llama
// cada vez que un slot cambia de identidad (arranca, se detiene, se desaloja, expira).
function rewriteNginxMap() {
  const lines = ['map $host $preview_upstream {', '    default "";']
  for (const slot of slots) {
    if (slot.slug && slot.ownerKey) {
      lines.push(`    "${slot.slug}.${PUBLIC_HOST}" "127.0.0.1:${slot.port}";`)
    }
  }
  lines.push('}', '')
  try {
    fs.writeFileSync(NGINX_MAP_PATH, lines.join('\n'))
    execFile('sudo', ['nginx', '-s', 'reload'], () => {})
  } catch (err) {
    console.error('No se pudo actualizar el mapa de nginx:', err.message)
  }
}

// Ejecuta un comando de forma asíncrona (no bloquea el event loop, a diferencia de execSync),
// para que /status siga respondiendo mientras corre un npm install largo.
function runCommand(slot, cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] })
    proc.stdout.on('data', (d) => fs.appendFileSync(logFile(slot), d))
    proc.stderr.on('data', (d) => fs.appendFileSync(logFile(slot), d))
    proc.on('error', reject)
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} salió con código ${code}`))))
  })
}

function detectStartCommand(dir, port) {
  const hasFile = (f) => fs.existsSync(path.join(dir, f))
  if (hasFile('vite.config.ts') || hasFile('vite.config.js') || hasFile('vite.config.mjs')) {
    return { cmd: 'npx', args: ['vite', '--host', '0.0.0.0', '--port', String(port), '--force'] }
  }
  if (hasFile('next.config.js') || hasFile('next.config.mjs') || hasFile('next.config.ts')) {
    return { cmd: 'npx', args: ['next', 'dev', '-H', '0.0.0.0', '-p', String(port)], env: {} }
  }
  return { cmd: 'npm', args: ['run', 'dev'], env: { HOST: '0.0.0.0', PORT: String(port) } }
}

async function waitForPreviewReady(url, maxRetries = 90, delayMs = 1000, containerName = null) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(2000) });
      if (res.ok || res.status < 500) {
        return true;
      }
    } catch (err) {
      // Si el contenedor se cerró prematuramente (ej. error de imports en vite.config), abortar espera
      if (containerName && i > 5 && i % 3 === 0) {
        try {
          const inspectOut = execSync(`docker inspect -f '{{.State.Running}}' ${containerName}`, { stdio: 'pipe' }).toString().trim()
          if (inspectOut === 'false') {
            return false
          }
        } catch {
          // Contenedor aún levantando, no abortar
        }
      }
    }
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  return false;
}

async function waitForPort(port, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise((resolve) => {
      const socket = net.createConnection(port, '127.0.0.1')
      socket.once('connect', () => {
        socket.end()
        resolve(true)
      })
      socket.once('error', () => resolve(false))
      socket.setTimeout(1000, () => {
        socket.destroy()
        resolve(false)
      })
    })
    if (ok) return true
    await new Promise((r) => setTimeout(r, 1000))
  }
  return false
}

// Escribe TODO el árbol de un proyecto "virtual" (sin GitHub) de cero — usada por /start.
// Borra el workdir antes (incluye node_modules): un arranque nuevo siempre reinstala.
function writeVirtualFilesFresh(workdir, files) {
  fs.rmSync(workdir, { recursive: true, force: true })
  fs.mkdirSync(workdir, { recursive: true })
  writeFilesOverlay(workdir, files)
}

// Sobreescribe archivos SIN borrar nada antes (node_modules incluido) — usada por /refresh: el
// servidor de desarrollo ya está corriendo, su propio watcher/HMR toma los cambios solo. No
// borra archivos que ya no estén en "files" (si un cambio aprobado borró un archivo, ese archivo
// obsoleto queda en el workspace de la preview hasta el próximo /start completo).
function writeFilesOverlay(workdir, files) {
  for (const [relPath, file] of Object.entries(files || {})) {
    const abs = path.join(workdir, relPath)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, file.isBase64 ? Buffer.from(file.content, 'base64') : file.content)
  }
}


function ensureWorkspaceGit(workdir) {
  try {
    const gitDir = path.join(workdir, '.git')
    if (!fs.existsSync(gitDir)) {
      execSync('git init -b main && git config user.name "FlowPro Agent" && git config user.email "agent@flow-pro.online" && git config commit.gpgsign false', { cwd: workdir, stdio: 'ignore' })
      const gitignorePath = path.join(workdir, '.gitignore')
      if (!fs.existsSync(gitignorePath)) {
        fs.writeFileSync(gitignorePath, 'node_modules\n.vite\ndist\n*.log\nenv-*.list\n')
      }
    }
    execSync('git add -A && git commit -m "FlowPro local checkpoint" --no-verify --allow-empty', { cwd: workdir, stdio: 'ignore' })
  } catch (_) {}
}

function sanitizePackageJson(workdir) {
  try {
    const pkgPath = path.join(workdir, 'package.json')
    if (!fs.existsSync(pkgPath)) return
    let pkg = null
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
    } catch (parseErr) {
      console.warn(`[server.mjs] JSON inválido en ${pkgPath}, restaurando estructura básica:`, parseErr.message)
      pkg = { name: 'app', version: '0.0.1', type: 'module' }
    }
    pkg.scripts = pkg.scripts || {}
    if (!pkg.scripts.dev) {
      pkg.scripts.dev = 'vite'
    }
    if (!pkg.dependencies) {
      pkg.dependencies = {}
    }
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))
  } catch (err) {
    console.error('[server.mjs] Error en sanitizePackageJson:', err.message)
  }
}

function injectRuntimeReporter(workdir, ownerKey) {
  const indexPath = path.join(workdir, 'index.html')
  if (!fs.existsSync(indexPath)) return

  let html = fs.readFileSync(indexPath, 'utf-8')
  const publicApiUrl = process.env.PUBLIC_API_URL || 'https://flow-pro.online/api/preview/runtime-report'
  const script = getRuntimeTelemetryProbeScript(ownerKey, publicApiUrl)

  if (html.includes('<!-- FLOWPRO_TELEMETRY_PROBE_START -->')) {
    html = html.replace(/<!-- FLOWPRO_TELEMETRY_PROBE_START -->[\s\S]*?<!-- FLOWPRO_TELEMETRY_PROBE_END -->/, () => script)
  } else if (html.includes('FLOWPRO_RUNTIME_ERROR')) {
    // Reemplazar sonda anterior no marcada
    const probeRegex = /<script\s+src="https:\/\/cdn\.jsdelivr\.net\/npm\/html2canvas-pro[\s\S]*?<\/script>\s*(?:<script>[\s\S]*?<\/script>)?/
    if (probeRegex.test(html)) {
      html = html.replace(probeRegex, () => script)
    } else if (html.includes('</head>')) {
      html = html.replace('</head>', () => `${script}\n</head>`)
    }
  } else if (html.includes('</head>')) {
    html = html.replace('</head>', () => `${script}\n</head>`)
  } else {
    html += script
  }
  fs.writeFileSync(indexPath, html)
}

const app = express()
// Default de Express es 100kb — ínfimo para el payload de /start de un proyecto "virtual" (el
// mapa completo de archivos del proyecto viaja en el body). Causaba "PayloadTooLargeError" real
// en producción para cualquier proyecto con algo de código encima de lo trivial.
app.use(express.json({ limit: '50mb' }))

app.use((req, res, next) => {
  if (req.headers.authorization !== `Bearer ${SECRET}`) return res.status(401).json({ error: 'unauthorized' })
  next()
})

app.post('/start', (req, res) => {
  const { ownerKey, mode, repoFullName, cloneUrl, branch, files, envVars, slugHint } = req.body || {}
  if (!ownerKey || !repoFullName) return res.status(400).json({ error: 'faltan ownerKey/repoFullName' })
  if (mode === 'virtual' && !files) return res.status(400).json({ error: 'falta "files" para mode=virtual' })
  if (mode !== 'virtual' && !cloneUrl) return res.status(400).json({ error: 'falta cloneUrl' })

  // Multi-slot: si ya corre para ESTE MISMO repo, reusar ese slot
  let slot = findSlotByOwnerAndRepo(ownerKey, repoFullName)
  if (!slot) {
    const ownerSlots = findSlotsByOwner(ownerKey)
    if (ownerSlots.length < MAX_PER_USER) {
      // Tiene espacio para otro preview (hasta 2 por cuenta)
      slot = findFreeSlot() || findLruSlot()
    } else {
      slot = ownerSlots.slice().sort((a, b) => (a.lastActivity || a.lastPing || 0) - (b.lastActivity || b.lastPing || 0))[0]
    }
  }

  if (slot.ownerKey && (slot.ownerKey !== ownerKey || slot.repoFullName !== repoFullName)) {
    log(slot, `[LRU DRAIN] Desalojando cupo #${slot.index} (${slot.slug}) de forma segura antes de reasignar...`)
    slot.status = 'draining'
    ensureWorkspaceGit(slot.workdir)
  }
  killSlot(slot) // corta lo que hubiera antes en este cupo (propio o de otro dueño desalojado)

  const slug = sanitizeSlug(slugHint) || sanitizeSlug(repoFullName.split('/').pop()) || `p${slot.index}`
  slot.ownerKey = ownerKey
  slot.repoFullName = repoFullName
  slot.slug = slug
  slot.status = mode === 'virtual' ? 'installing' : 'cloning'
  slot.url = null
  slot.error = null
  slot.lastPing = Date.now()
  fs.writeFileSync(logFile(slot), '')

  res.json({ status: slot.status })

  rewriteNginxMap() // ya desde acá, para que el subdominio empiece a resolver apenas se sepa el slug
  runStart(slot, { mode, repoFullName, cloneUrl, branch, files, envVars, slug })
})

function extractMissingPackage(text) {
  if (!text) return null
  const match = text.match(/(?:Failed to resolve import|Cannot find module|failed to load url) ["']([^"'./][^"']*)["']/i)
  if (!match) return null
  const rawPkg = match[1].trim()
  if (!rawPkg) return null
  return rawPkg.startsWith('@') ? rawPkg.split('/').slice(0, 2).join('/') : rawPkg.split('/')[0]
}

function isCorruptedVolumeError(text) {
  if (!text) return false
  return /ENOTEMPTY|errno -39|directory not empty|syscall rename.*node_modules/i.test(text)
}

function purgeNamedVolume(slotIndex) {
  try {
    execSync(`docker volume rm -f preview-deps-${slotIndex}`, { stdio: 'ignore' })
  } catch {}
}

function ensurePackageInManifest(workdir, pkgName) {
  try {
    const pkgPath = path.join(workdir, 'package.json')
    if (!fs.existsSync(pkgPath)) return false
    const pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
    pkgJson.dependencies = pkgJson.dependencies || {}
    if (!pkgJson.dependencies[pkgName] && !pkgJson.devDependencies?.[pkgName]) {
      pkgJson.dependencies[pkgName] = 'latest'
      fs.writeFileSync(pkgPath, JSON.stringify(pkgJson, null, 2))
      return true
    }
  } catch (err) {
    console.error(`Error updating package.json with ${pkgName}:`, err.message)
  }
  return false
}

async function runStart(slot, { mode, repoFullName, cloneUrl, branch, files, envVars, slug, isRetry = false }) {
  const myGen = ++slot.generation
  slot.isBusy = true
  slot.lastActivity = Date.now()
  try {
    if (mode === 'virtual') {
      log(slot, `Escribiendo ${Object.keys(files || {}).length} archivos del proyecto virtual...`)
      writeVirtualFilesFresh(slot.workdir, files)
      ensureWorkspaceGit(slot.workdir)
    } else {
      if (!isRetry) {
        fs.rmSync(slot.workdir, { recursive: true, force: true })
        fs.mkdirSync(slot.workdir, { recursive: true })
        log(slot, `Clonando ${repoFullName}${branch ? ` (rama ${branch})` : ''}...`)
        const cloneArgs = ['clone', '--depth', '1']
        if (branch) cloneArgs.push('--branch', branch)
        cloneArgs.push(cloneUrl, slot.workdir)
        await runCommand(slot, 'git', cloneArgs, {})
        ensureWorkspaceGit(slot.workdir)
      }
    }
    if (myGen !== slot.generation) return

    sanitizePackageJson(slot.workdir)
    injectRuntimeReporter(slot.workdir, slot.ownerKey)

    const { cmd, args, env: extraEnv } = detectStartCommand(slot.workdir, slot.port)
    log(slot, `Iniciando contenedor Docker: npm install && ${cmd} ${args.join(' ')}`)
    slot.status = 'starting'

    // Exportar variables de entorno a un archivo .env para el contenedor Docker
    const envFilePath = path.join(WORKSPACE_ROOT, `env-${slot.index}.list`)
    const allEnvs = { ...extraEnv, ...envVars, NODE_OPTIONS: '--max-old-space-size=512' }
    const envContent = Object.entries(allEnvs)
      .filter(([k, v]) => v !== undefined && v !== null)
      .map(([k,v]) => `${k}=${String(v).replace(/\\n/g, '\\\\n')}`)
      .join('\n')
    fs.writeFileSync(envFilePath, envContent)
    try { fs.writeFileSync(path.join(slot.workdir, '.env'), envContent) } catch(e) {}

    // Limpiar contenedor previo si quedó colgado
    try { execSync(`docker rm -f -v preview-${slot.index}`, { stdio: 'ignore' }) } catch {}

    const dockerArgs = [
      'run', '--name', `preview-${slot.index}`,
      '-p', `127.0.0.1:${slot.port}:${slot.port}`,
      '-v', `${slot.workdir}:/workspace`,
      '-v', `preview-deps-${slot.index}:/workspace/node_modules`,
      '-w', '/workspace',
      '--env-file', envFilePath,
      '--memory=1024m', '--cpus=1.0', '--pids-limit=100', // Sandboxing: Límite de recursos por usuario
      'node:20',
      'sh', '-c', `rm -rf node_modules/.vite && (npm install --prefer-offline --no-audit --no-fund --loglevel=error || npm install --legacy-peer-deps --no-audit --no-fund --loglevel=error) && ${cmd} ${args.join(' ')}`
    ]

    slot.child = spawn('docker', dockerArgs, {
      detached: true,
      stdio: ['ignore', fs.openSync(logFile(slot), 'a'), fs.openSync(logFile(slot), 'a')]
    })
    slot.child.unref()

    const up = await waitForPreviewReady('http://127.0.0.1:' + slot.port, 90, 1000, `preview-${slot.index}`)
    if (myGen !== slot.generation) return
    if (up) {
      slot.status = 'running'
      slot.error = null
      slot.lastBootErrorLog = null
      slot.url = `${PUBLIC_SCHEME}://${slug}.${PUBLIC_HOST}`
      log(slot, `Preview corriendo en ${slot.url}`)
    } else {
      // Extraer logs para diagnóstico y auto-reparación
      let rawLogs = ''
      try {
        if (fs.existsSync(logFile(slot))) {
          rawLogs = fs.readFileSync(logFile(slot), 'utf-8')
        }
      } catch {}

      const hasCorruptedVolume = isCorruptedVolumeError(rawLogs)
      const missingPkg = extractMissingPackage(rawLogs)

      if (hasCorruptedVolume) {
        log(slot, `[AUTO-REPAIR] Volumen corrupto detectado (ENOTEMPTY / errno -39). Purgando preview-deps-${slot.index}...`)
        purgeNamedVolume(slot.index)
      }

      if (missingPkg) {
        log(slot, `[AUTO-REPAIR] Dependencia faltante detectada en logs: "${missingPkg}". Registrando en package.json...`)
        ensurePackageInManifest(slot.workdir, missingPkg)
      }

      // Si falló el primer intento, aplicar Kill & Respawn forzoso con limpieza de caché
      if (!isRetry) {
        log(slot, 'Timeout o caída detectada. Ejecutando Kill & Respawn limpio con auto-reparación...')
        killSlot(slot)
        try { fs.rmSync(path.join(slot.workdir, 'node_modules/.vite'), { recursive: true, force: true }) } catch {}
        return runStart(slot, { mode, repoFullName, cloneUrl, branch, files, envVars, slug, isRetry: true })
      }

      // Si falló incluso tras reintento, matar contenedor para liberar puerto y recursos
      killSlot(slot)

      // Extraer posible error de logs para diagnóstico certero
      let extractedErr = null
      for (const line of rawLogs.split('\n').reverse()) {
        const trimmed = line.trim()
        if (trimmed && (VITE_ERROR_PATTERNS.some(p => trimmed.includes(p)) || trimmed.includes('Error:') || trimmed.includes('ERR_'))) {
          extractedErr = trimmed
          break
        }
      }

      const logLines = rawLogs.split('\n').filter(Boolean)
      slot.lastBootErrorLog = logLines.slice(-40).join('\n')

      slot.status = 'error'
      slot.error = extractedErr || 'Tiempo de espera agotado iniciando el servidor de desarrollo'
    }
  } catch (err) {
    if (myGen !== slot.generation) return
    killSlot(slot)
    log(slot, `ERROR: ${err.message}`)
    slot.status = 'error'
    slot.error = err.message
    slot.lastBootErrorLog = err.stack || err.message
  } finally {
    if (myGen === slot.generation) {
      slot.isBusy = false
      slot.lastActivity = Date.now()
    }
  }
}

const VITE_ERROR_PATTERNS = [
  'Failed to resolve import',
  '[plugin:vite:import-analysis]',
  'Pre-transform error',
  'Cannot find module',
  'Internal server error',
  'SyntaxError',
  'Transform failed',
  'Build failed with',
  'does not provide an export named'
]

async function extractViteError(logsTail, slot) {
  if (!logsTail) return null
  const parts = logsTail.split(/--- VFS REFRESH START.*---/)
  const recent = parts[parts.length - 1]
  const clean = recent.replace(/\x1b\[[0-9;]*m/g, '')

  const successMarkers = [
    'HMR updated cleanly',
    'optimized dependencies changed. reloading',
    'page reload',
    'hmr update'
  ]
  const lastSuccessIdx = Math.max(-1, ...successMarkers.map(m => clean.lastIndexOf(m)))

  for (const pattern of VITE_ERROR_PATTERNS) {
    if (clean.includes(pattern)) {
      const errorIdx = clean.lastIndexOf(pattern)
      if (lastSuccessIdx > errorIdx) {
        // Hubo una recarga exitosa posterior al error
        continue
      }
      const line = clean.split('\n').find((l) => l.includes(pattern)) || pattern
      const detectedError = line.trim()

      // Verificación activa de resolución (Warm-up Check):
      if (slot?.port) {
        const fileMatch = clean.match(/(?:\/workspace)?(\/src\/[^\s:?#]+\.[a-zA-Z0-9]+)/i)
        const testUri = fileMatch ? fileMatch[1] : '/'
        try {
          const res = await fetch(`http://127.0.0.1:${slot.port}${testUri}`, {
            signal: AbortSignal.timeout(2500)
          })
          if (res.ok) {
            const bodyText = await res.text().catch(() => '')
            if (!bodyText.includes('Pre-transform error') && !bodyText.includes('Internal server error')) {
              log(slot, `[Vite Warm-up] Verificado OK para ${testUri}: error en logs ignorado por estar resuelto.`)
              continue
            }
          }
        } catch (_) {}
      }

      return detectedError
    }
  }
  return null
}

// Consultado por el editor mientras hay un turno en curso (ownerKey del usuario autenticado) —
// Si se envía repoFullName, devuelve el slot específico de ese repositorio.
app.get('/status', async (req, res) => {
  const ownerKey = String(req.query.ownerKey || '')
  const repoFullName = req.query.repoFullName ? String(req.query.repoFullName) : null
  if (!ownerKey) return res.status(400).json({ error: 'falta ownerKey' })

  const slot = repoFullName
    ? findSlotByOwnerAndRepo(ownerKey, repoFullName)
    : findSlotByOwner(ownerKey)
  if (!slot) return res.json({ status: 'idle', repoFullName: null, url: null, error: null, lastBuildTime: null })

  slot.lastPing = Date.now()
  const rawLogs = fs.existsSync(logFile(slot)) ? fs.readFileSync(logFile(slot), 'utf-8') : ''
  const logsTail = rawLogs.split('\n').slice(-80).join('\n')

  const detectedError = await extractViteError(logsTail, slot)
  if (detectedError && slot.status === 'running') {
    return res.json({
      status: 'error',
      repoFullName: slot.repoFullName,
      url: slot.url,
      error: detectedError,
      lastBootErrorLog: slot.lastBootErrorLog || null,
      logsTail,
      lastBuildTime: slot.lastBuildTime || null
    })
  }

  res.json({
    status: slot.status,
    repoFullName: slot.repoFullName,
    url: slot.url,
    error: slot.error,
    lastBootErrorLog: slot.lastBootErrorLog || null,
    logsTail,
    lastBuildTime: slot.lastBuildTime || null
  })
})

app.post('/stop', (req, res) => {
  const ownerKey = String(req.body?.ownerKey || '')
  const repoFullName = req.body?.repoFullName ? String(req.body.repoFullName) : null
  if (!ownerKey) return res.status(400).json({ error: 'falta ownerKey' })

  const targetSlots = repoFullName
    ? [findSlotByOwnerAndRepo(ownerKey, repoFullName)].filter(Boolean)
    : findSlotsByOwner(ownerKey)

  for (const slot of targetSlots) {
    resetSlot(slot)
  }
  rewriteNginxMap()
  res.json({ status: 'idle' })
})

// Purga física de archivos de código en disco ante un reinicio total de proyecto (Hard Reset)
app.post('/reset-workspace', (req, res) => {
  const ownerKey = String(req.body?.ownerKey || '')
  const repoFullName = req.body?.repoFullName ? String(req.body.repoFullName) : null
  if (!ownerKey) return res.status(400).json({ error: 'falta ownerKey' })

  const targetSlots = repoFullName
    ? [findSlotByOwnerAndRepo(ownerKey, repoFullName)].filter(Boolean)
    : findSlotsByOwner(ownerKey)

  let purgedCount = 0
  for (const slot of targetSlots) {
    if (slot && slot.workdir && fs.existsSync(slot.workdir)) {
      // Salvaguarda Pre-Reset: Crear snapshot de Git local antes de purgar archivos
      try {
        ensureWorkspaceGit(slot.workdir)
        execSync('git add -A', { cwd: slot.workdir, stdio: 'ignore' })
        execSync('git commit -m "FlowPro [CHECKPOINT]: Pre-reset automatic snapshot" --no-verify --allow-empty', { cwd: slot.workdir, stdio: 'ignore' })
      } catch (_) {}

      const srcDir = path.join(slot.workdir, 'src')
      if (fs.existsSync(srcDir)) {
        const subdirs = ['components', 'pages', 'views', 'lib', 'utils', 'hooks', 'context', 'services']
        for (const sub of subdirs) {
          const target = path.join(srcDir, sub)
          if (fs.existsSync(target)) {
            try {
              fs.rmSync(target, { recursive: true, force: true })
              purgedCount++
            } catch (_) {}
          }
        }
      }
      const appPath = path.join(slot.workdir, 'src/App.jsx')
      const minimalApp = `import React from 'react'\n\nexport default function App() {\n  return (\n    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">\n      <div className="text-center p-6 max-w-md">\n        <h1 className="text-xl font-bold tracking-tight mb-2">Nuevo Proyecto</h1>\n        <p className="text-sm text-zinc-400">Construyendo la nueva aplicación...</p>\n      </div>\n    </div>\n  )\n}\n`
      try {
        fs.writeFileSync(appPath, minimalApp, 'utf-8')
      } catch (_) {}
      ensureWorkspaceGit(slot.workdir)
    }
  }
  res.json({ ok: true, reset: true, purgedCount })
})

// Aplica un cambio ya aprobado a una preview que YA está corriendo, sin reinstalar/reiniciar —
// el propio watcher de Vite/Next toma los archivos nuevos solo (HMR). No existía en la versión
// anterior (el backend lo llamaba igual tras cada aprobación, y siempre fallaba en silencio).

const getDepsKey = (content) => {
  if (!content) return '';
  try {
    const p = JSON.parse(content);
    return JSON.stringify({ d: p.dependencies, dd: p.devDependencies });
  } catch {
    return content;
  }
};

app.post('/refresh', async (req, res) => {
  const { ownerKey, repoFullName, mode, files } = req.body || {}
  const slot = repoFullName
    ? findSlotByOwnerAndRepo(String(ownerKey || ''), repoFullName)
    : findSlotByOwner(String(ownerKey || ''))
  if (!slot || slot.status !== 'running') return res.json({ refreshed: false })

  slot.lastBuildTime = Date.now()
  slot.lastActivity = Date.now()
  slot.isBusy = true
  try {
    if (files && Object.keys(files).length > 0) {
      log(slot, `--- VFS REFRESH START [${new Date().toISOString()}] ---`)
      const pkgPath = path.join(slot.workdir, 'package.json')
      const pkgBefore = fs.existsSync(pkgPath) ? fs.readFileSync(pkgPath, 'utf-8') : null
      writeFilesOverlay(slot.workdir, files)
      sanitizePackageJson(slot.workdir)
      injectRuntimeReporter(slot.workdir, slot.ownerKey)
      ensureWorkspaceGit(slot.workdir)
      const pkgAfter = fs.existsSync(pkgPath) ? fs.readFileSync(pkgPath, 'utf-8') : null
      
      if (getDepsKey(pkgAfter) !== getDepsKey(pkgBefore)) {
        log(slot, 'package.json cambió en VFS overlay — reinstalando dependencias en Docker...')
        try {
          await runCommand(slot, 'docker', ['exec', `preview-${slot.index}`, 'sh', '-c', 'rm -rf node_modules/.vite && (npm install --prefer-offline --no-audit --no-fund --loglevel=error || npm install --legacy-peer-deps --no-audit --no-fund --loglevel=error) && (touch vite.config.* 2>/dev/null || true)'])
        } catch (installErr) {
          log(slot, `[REFRESH] Error en npm install: ${installErr.message}`)
          if (isCorruptedVolumeError(installErr.message)) {
            log(slot, `[REFRESH] Volumen corrupto detectado. Purgando preview-deps-${slot.index}...`)
            purgeNamedVolume(slot.index)
          }
        }
      }

      // Warm-up del grafo de módulos para forzar compilación on-demand de Vite AHORA
      const modifiedCodeFiles = Object.keys(files).filter(f => /\.(jsx?|tsx?|vue|svelte|css|html)$/i.test(f))
      const warmUpList = ['/', '/src/main.jsx', '/src/App.jsx', ...modifiedCodeFiles.map(f => f.startsWith('/') ? f : `/${f}`)]
      const uniqueWarmUps = Array.from(new Set(warmUpList))

      for (const uri of uniqueWarmUps) {
        try {
          const r = await fetch(`http://127.0.0.1:${slot.port}${uri}`, { signal: AbortSignal.timeout(3000) })
          if (r.ok) log(slot, `[Vite] Warm-up OK: ${uri}`)
        } catch (_) {}
      }
    } else if (mode !== 'virtual') {
      log(slot, `--- VFS REFRESH START [${new Date().toISOString()}] ---`)
      const pkgPath = path.join(slot.workdir, 'package.json')
      const pkgBefore = fs.existsSync(pkgPath) ? fs.readFileSync(pkgPath, 'utf-8') : null
      await runCommand(slot, 'git', ['fetch', '--depth', '1', 'origin'], { cwd: slot.workdir })
      await runCommand(slot, 'git', ['reset', '--hard', 'FETCH_HEAD'], { cwd: slot.workdir })
      sanitizePackageJson(slot.workdir)
      injectRuntimeReporter(slot.workdir, slot.ownerKey)
      const pkgAfter = fs.existsSync(pkgPath) ? fs.readFileSync(pkgPath, 'utf-8') : null
      if (getDepsKey(pkgAfter) !== getDepsKey(pkgBefore)) {
        log(slot, 'package.json cambió en este refresh — reinstalando dependencias en Docker...')
        try {
          await runCommand(slot, 'docker', ['exec', `preview-${slot.index}`, 'sh', '-c', 'rm -rf node_modules/.vite && (npm install --prefer-offline --no-audit --no-fund --loglevel=error || npm install --legacy-peer-deps --no-audit --no-fund --loglevel=error) && (touch vite.config.* 2>/dev/null || true)'])
        } catch (installErr) {
          log(slot, `[REFRESH] Error en npm install: ${installErr.message}`)
          if (isCorruptedVolumeError(installErr.message)) {
            log(slot, `[REFRESH] Volumen corrupto detectado. Purgando preview-deps-${slot.index}...`)
            purgeNamedVolume(slot.index)
          }
        }
      }

      // Warm-up check en modo git
      for (const uri of ['/', '/src/main.jsx', '/src/App.jsx']) {
        try {
          const r = await fetch(`http://127.0.0.1:${slot.port}${uri}`, { signal: AbortSignal.timeout(3000) })
          if (r.ok) log(slot, `[Vite] Warm-up OK: ${uri}`)
        } catch (_) {}
      }
    }
    res.json({ refreshed: true, lastBuildTime: slot.lastBuildTime })
  } catch (err) {
    res.status(502).json({ refreshed: false, error: err.message })
  } finally {
    slot.isBusy = false
    slot.lastActivity = Date.now()
  }
})

app.post('/restore-git', (req, res) => {
  const { ownerKey, repoFullName, commitSha } = req.body || {}
  if (!ownerKey) return res.status(400).json({ error: 'falta ownerKey' })
  const slot = repoFullName
    ? findSlotByOwnerAndRepo(ownerKey, repoFullName)
    : findSlotByOwner(ownerKey)
  if (!slot || !fs.existsSync(slot.workdir)) {
    return res.status(404).json({ error: 'Slot o workspace no encontrado' })
  }
  try {
    const targetSha = commitSha || 'HEAD~1'
    execSync(`git reset --hard ${targetSha} && git clean -fd`, { cwd: slot.workdir, stdio: 'ignore' })
    log(slot, `[GIT-RESTORE] Workspace restaurado localmente a ${targetSha}`)
    res.json({ restored: true, commitSha: targetSha })
  } catch (err) {
    res.status(500).json({ error: 'Fallo al restaurar git local: ' + err.message })
  }
})

// Diagnóstico para operar el pool (qué cupo tiene quién) — sigue detrás del mismo Bearer SECRET
// que todo lo demás, no es público.
app.get('/pool', (req, res) => {
  res.json(
    slots.map((s) => ({
      index: s.index,
      port: s.port,
      ownerKey: s.ownerKey,
      repoFullName: s.repoFullName,
      slug: s.slug,
      status: s.status,
      lastPing: s.lastPing ? new Date(s.lastPing).toISOString() : null,
    })),
  )
})

setInterval(() => {
  let changed = false
  for (const slot of slots) {
    if (slot.status === 'running' && Date.now() - slot.lastPing > IDLE_TIMEOUT_MS) {
      log(slot, 'Apagando preview por inactividad (sin polling hace 20+ minutos)')
      resetSlot(slot)
      changed = true
    }
  }
  if (changed) rewriteNginxMap()
}, 60000)

try {
  console.log('Limpiando contenedores huérfanos...');
  execSync('docker ps -q --filter "name=preview-" | xargs -r docker rm -f', { stdio: 'inherit' });
} catch (e) {
  // Ignorar si no hay contenedores o falla
}

app.listen(PORT, '0.0.0.0', () => console.log(`Preview orchestrator escuchando en :${PORT} (pool de ${POOL_SIZE} cupos)`))
