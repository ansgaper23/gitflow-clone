import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { supabase } from '../db/supabaseClient.js'
import { withBrowserLock } from './browserQueue.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
// backend/src/services -> backend/public/thumbnails
export const THUMBNAILS_DIR = join(__dirname, '..', '..', 'public', 'thumbnails')

const CAPTURE_TIMEOUT_MS = 15000
const VIEWPORT = { width: 1000, height: 750 }

// Un projectId por captura en curso, para no disparar dos capturas del mismo proyecto en
// paralelo si el polling de estado llega varias veces mientras la primera todavía corre.
const inFlight = new Set()

// Se llama en paralelo al polling de /preview/status cuando un proyecto pasa a "running" por
// primera vez — nunca debe tirar hacia arriba (rompería esa respuesta): cualquier fallo queda
// en el log nada más, con thumbnail_url en null como estaba.
export function captureProjectThumbnailAsync(project, previewUrl) {
  if (!project?.id || !previewUrl || inFlight.has(project.id)) return
  inFlight.add(project.id)
  withBrowserLock(() => captureInner(project, previewUrl))
    .catch((err) => console.error(`[thumbnail] falló la captura de ${project.id}:`, err.message))
    .finally(() => inFlight.delete(project.id))
}

async function captureInner(project, previewUrl) {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  try {
    const context = await browser.newContext({ viewport: VIEWPORT })
    const page = await context.newPage()
    await page.goto(previewUrl, { waitUntil: 'domcontentloaded', timeout: CAPTURE_TIMEOUT_MS })
    await page.waitForTimeout(800) // deja asentar animaciones/fuentes antes de la captura
    const buffer = await page.screenshot({ type: 'jpeg', quality: 65 })

    await mkdir(THUMBNAILS_DIR, { recursive: true })
    await writeFile(join(THUMBNAILS_DIR, `${project.id}.jpg`), buffer)

    const thumbnailUrl = `/api/thumbnails/${project.id}.jpg?v=${Date.now()}`
    const { error } = await supabase.from('projects').update({ thumbnail_url: thumbnailUrl }).eq('id', project.id)
    if (error) throw error
  } finally {
    await browser.close().catch(() => {})
  }
}
