import express from 'express'
import { spawn, execFile, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'

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
}

function findSlotByOwner(ownerKey) {
  return slots.find((s) => s.ownerKey === ownerKey) || null
}

function findFreeSlot() {
  return slots.find((s) => s.ownerKey === null) || null
}

// El menos usado recientemente (más tiempo sin polling) — el que se desaloja cuando los
// POOL_SIZE cupos ya están ocupados por owners distintos y llega uno nuevo.
function findLruSlot() {
  return slots.slice().sort((a, b) => a.lastPing - b.lastPing)[0]
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

async function waitForPreviewReady(url, maxRetries = 15, delayMs = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(2000) });
      if (res.ok || res.status < 500) {
        return true;
      }
    } catch (err) {
      // Vite aún está iniciando o compilando; esperar al siguiente intento
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


function injectRuntimeReporter(workdir, ownerKey) {
  const indexPath = path.join(workdir, 'index.html');
  if (!fs.existsSync(indexPath)) return;

  let html = fs.readFileSync(indexPath, 'utf-8');
  if (html.includes('FLOWPRO_RUNTIME_ERROR')) return;

  const publicApiUrl = process.env.PUBLIC_API_URL || 'https://flow-pro.online/api/preview/runtime-report';
  const script = `
    <script src="https://cdn.jsdelivr.net/npm/html2canvas-pro@2.5.2/dist/html2canvas-pro.min.js"></script>
    <script>
    (function() {
      const SESSION_ID = "${ownerKey}";
      const REPORT_URL = "${publicApiUrl}";
      function emitCrash(payload) {
        window.parent.postMessage({ type: 'FLOWPRO_RUNTIME_ERROR', sessionId: SESSION_ID, payload }, '*');
        try {
          fetch(REPORT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: SESSION_ID, ...payload }),
            keepalive: true
          }).catch(() => {});
        } catch (_) {}
      }

      // Fase de captura (true) para interceptar errores de carga de scripts y módulos ES
      window.addEventListener('error', (event) => {
        emitCrash({
          source: 'UNCAUGHT_EXCEPTION',
          message: event.message || event.error?.message || (event.target && event.target.src ? 'Error cargando recurso: ' + event.target.src : 'Error de script/módulo'),
          filename: event.filename || event.target?.src || null,
          lineno: event.lineno,
          colno: event.colno,
          stack: event.error ? event.error.stack : null
        });
      }, true);

      window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason;
        emitCrash({ source: 'UNHANDLED_REJECTION', message: reason?.message || String(reason), stack: reason?.stack || null });
      });

      // Detección del Overlay de error de Vite
      try {
        const observer = new MutationObserver((mutations) => {
          for (const m of mutations) {
            for (const node of m.addedNodes) {
              if (node.tagName === 'VITE-ERROR-OVERLAY' || (node.id && node.id.includes('vite-error'))) {
                const text = node.shadowRoot ? node.shadowRoot.textContent : node.textContent;
                emitCrash({ source: 'VITE_ERROR_OVERLAY', message: text || 'Vite compile overlay detected' });
              }
            }
          }
        });
        observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
      } catch (_) {}

      window.addEventListener('message', async (event) => {
        if (event.data?.type === 'FLOWPRO_TRIGGER_SNAPSHOT') {
          try {
            const h2c = window.html2canvas?.default || window.html2canvas;
            if (typeof h2c === 'function') {
              const canvas = await h2c(document.body, {
                logging: false,
                useCORS: true,
                scale: 0.4,
                allowTaint: false,
                ignoreElements: (el) => el.tagName === 'IFRAME' || el.classList.contains('no-snapshot')
              });
              const webpData = canvas.toDataURL('image/webp', 0.5);
              window.parent.postMessage({ type: 'FLOWPRO_SNAPSHOT_SUCCESS', payload: webpData }, '*');
            } else {
              window.parent.postMessage({ type: 'FLOWPRO_SNAPSHOT_FALLBACK' }, '*');
            }
          } catch (err) {
            console.warn('[Snapshot] Error al generar captura:', err.message);
            window.parent.postMessage({ type: 'FLOWPRO_SNAPSHOT_FALLBACK' }, '*');
          }
        }
      });
    })();
    </script>
  `;
  if (html.includes('</head>')) {
    html = html.replace('</head>', script + '\n</head>');
  } else {
    html += script;
  }
  fs.writeFileSync(indexPath, html);
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

  const slot = findSlotByOwner(ownerKey) || findFreeSlot() || findLruSlot()
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

async function runStart(slot, { mode, repoFullName, cloneUrl, branch, files, envVars, slug }) {
  const myGen = ++slot.generation
  try {
    if (mode === 'virtual') {
      log(slot, `Escribiendo ${Object.keys(files || {}).length} archivos del proyecto virtual...`)
      writeVirtualFilesFresh(slot.workdir, files)
    } else {
      fs.rmSync(slot.workdir, { recursive: true, force: true })
      fs.mkdirSync(slot.workdir, { recursive: true })
      log(slot, `Clonando ${repoFullName}${branch ? ` (rama ${branch})` : ''}...`)
      const cloneArgs = ['clone', '--depth', '1']
      if (branch) cloneArgs.push('--branch', branch)
      cloneArgs.push(cloneUrl, slot.workdir)
      await runCommand(slot, 'git', cloneArgs, {})
    }
    if (myGen !== slot.generation) return

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
      '-v', `/workspace/node_modules`,
      '-w', '/workspace',
      '--env-file', envFilePath,
      '--memory=1024m', '--cpus=1.0', '--pids-limit=100', // Sandboxing: Límite de recursos por usuario
      'node:20',
      'sh', '-c', `rm -rf node_modules/.vite && npm install --prefer-offline --no-audit --no-fund --loglevel=error && ${cmd} ${args.join(' ')}`
    ]

    slot.child = spawn('docker', dockerArgs, {
      detached: true,
      stdio: ['ignore', fs.openSync(logFile(slot), 'a'), fs.openSync(logFile(slot), 'a')]
    })
    slot.child.unref()

    const up = await waitForPreviewReady('http://127.0.0.1:' + slot.port, 90, 1000)
    if (myGen !== slot.generation) return
    if (up) {
      slot.status = 'running'
      slot.error = null
      slot.url = `${PUBLIC_SCHEME}://${slug}.${PUBLIC_HOST}`
      log(slot, `Preview corriendo en ${slot.url}`)
    } else {
      slot.status = 'error'
      slot.error = 'Tiempo de espera agotado iniciando el servidor de desarrollo'
    }
  } catch (err) {
    if (myGen !== slot.generation) return
    log(slot, `ERROR: ${err.message}`)
    slot.status = 'error'
    slot.error = err.message
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

function extractViteError(logsTail) {
  if (!logsTail) return null
  const parts = logsTail.split('--- VFS REFRESH START ---')
  const recent = parts[parts.length - 1]
  const clean = recent.replace(/\x1b\[[0-9;]*m/g, '')

  for (const pattern of VITE_ERROR_PATTERNS) {
    if (clean.includes(pattern)) {
      const line = clean.split('\n').find((l) => l.includes(pattern)) || pattern
      return line.trim()
    }
  }
  return null
}

// Consultado por el editor mientras hay un turno en curso (ownerKey del usuario autenticado) —
// SOLO ve su propio cupo. Devuelve status:'error' de forma veraz si Vite arrojó error en el log.
app.get('/status', (req, res) => {
  const ownerKey = String(req.query.ownerKey || '')
  if (!ownerKey) return res.status(400).json({ error: 'falta ownerKey' })

  const slot = findSlotByOwner(ownerKey)
  if (!slot) return res.json({ status: 'idle', repoFullName: null, url: null, error: null })

  slot.lastPing = Date.now()
  const rawLogs = fs.existsSync(logFile(slot)) ? fs.readFileSync(logFile(slot), 'utf-8') : ''
  const logsTail = rawLogs.split('\n').slice(-80).join('\n')

  const detectedError = extractViteError(logsTail)
  if (detectedError && slot.status === 'running') {
    return res.json({
      status: 'error',
      repoFullName: slot.repoFullName,
      url: slot.url,
      error: detectedError,
      logsTail
    })
  }

  res.json({ status: slot.status, repoFullName: slot.repoFullName, url: slot.url, error: slot.error, logsTail })
})

app.post('/stop', (req, res) => {
  const ownerKey = String(req.body?.ownerKey || '')
  const slot = findSlotByOwner(ownerKey)
  if (slot) {
    resetSlot(slot)
    rewriteNginxMap()
  }
  res.json({ status: 'idle' })
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
  const { ownerKey, mode, files } = req.body || {}
  const slot = findSlotByOwner(String(ownerKey || ''))
  if (!slot || slot.status !== 'running') return res.json({ refreshed: false })

  try {
    if (files && Object.keys(files).length > 0) {
      log(slot, '--- VFS REFRESH START ---')
      const pkgPath = path.join(slot.workdir, 'package.json')
      const pkgBefore = fs.existsSync(pkgPath) ? fs.readFileSync(pkgPath, 'utf-8') : null
      writeFilesOverlay(slot.workdir, files)
      injectRuntimeReporter(slot.workdir, slot.ownerKey)
      const pkgAfter = fs.existsSync(pkgPath) ? fs.readFileSync(pkgPath, 'utf-8') : null
      
      if (getDepsKey(pkgAfter) !== getDepsKey(pkgBefore)) {
        log(slot, 'package.json cambió en VFS overlay — reinstalando dependencias en Docker...')
        await runCommand(slot, 'docker', ['exec', `preview-${slot.index}`, 'sh', '-c', 'rm -rf node_modules/.vite && npm install --prefer-offline --no-audit --no-fund --loglevel=error && (touch vite.config.* 2>/dev/null || true)'])
      }

      // Warm-up del grafo de módulos para forzar compilación on-demand de Vite AHORA
      const modifiedCodeFiles = Object.keys(files).filter(f => /\.(jsx?|tsx?|vue|svelte|css|html)$/i.test(f))
      const warmUpList = ['/', '/src/main.jsx', '/src/App.jsx', ...modifiedCodeFiles.map(f => f.startsWith('/') ? f : `/${f}`)]
      const uniqueWarmUps = Array.from(new Set(warmUpList))

      for (const uri of uniqueWarmUps) {
        try {
          await fetch(`http://127.0.0.1:${slot.port}${uri}`, { signal: AbortSignal.timeout(3000) })
        } catch (_) {}
      }
    } else if (mode !== 'virtual') {
      const pkgPath = path.join(slot.workdir, 'package.json')
      const pkgBefore = fs.existsSync(pkgPath) ? fs.readFileSync(pkgPath, 'utf-8') : null
      await runCommand(slot, 'git', ['fetch', '--depth', '1', 'origin'], { cwd: slot.workdir })
      await runCommand(slot, 'git', ['reset', '--hard', 'FETCH_HEAD'], { cwd: slot.workdir })
      const pkgAfter = fs.existsSync(pkgPath) ? fs.readFileSync(pkgPath, 'utf-8') : null
      if (getDepsKey(pkgAfter) !== getDepsKey(pkgBefore)) {
        log(slot, 'package.json cambió en este refresh — reinstalando dependencias en Docker...')
        await runCommand(slot, 'docker', ['exec', `preview-${slot.index}`, 'sh', '-c', 'rm -rf node_modules/.vite && npm install --prefer-offline --no-audit --no-fund --loglevel=error && (touch vite.config.* 2>/dev/null || true)'])
      }
    }
    res.json({ refreshed: true })
  } catch (err) {
    res.status(502).json({ refreshed: false, error: err.message })
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
