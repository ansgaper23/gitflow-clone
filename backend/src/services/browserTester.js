import { chromium } from 'playwright'
import { withBrowserLock } from './browserQueue.js'

// La VPS de producción tiene muy poco margen de RAM (un solo preview activo ya consume
// buena parte), así que cada prueba abre un Chromium efímero, corre acotada por timeouts
// duros, y se cierra siempre — nunca queda un browser residente entre llamadas. withBrowserLock
// asegura además que nunca corra al mismo tiempo que una captura de miniatura.
const MAX_STEPS = 20
const STEP_TIMEOUT_MS = 8000
const TOTAL_TIMEOUT_MS = 45000

export async function runPreviewTest(previewUrl, opts, signal) {
  return withBrowserLock(() => runPreviewTestInner(previewUrl, opts, signal))
}

async function runPreviewTestInner(previewUrl, { startPath, steps } = {}, signal) {
  if (signal?.aborted) throw new DOMException('Cancelado por el usuario', 'AbortError')
  if (!previewUrl) throw new Error('No hay una URL de vista previa para probar.')
  const boundedSteps = (steps || []).slice(0, MAX_STEPS)

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  // Si el usuario cancela mientras Playwright sigue trabajando (puede tardar hasta 45s+), cerrar
  // el browser YA en vez de esperar a que termine solo — eso corta cualquier operación en
  // curso (Playwright la rechaza al perder el browser) en vez de dejar el botón "Detener" sin
  // efecto real durante toda la prueba.
  const onAbort = () => {
    browser.close().catch(() => {})
  }
  signal?.addEventListener('abort', onAbort)

  const transcript = []
  const consoleErrors = []
  try {
    if (signal?.aborted) throw new DOMException('Cancelado por el usuario', 'AbortError')
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await context.newPage()
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300))
    })
    page.on('pageerror', (err) => consoleErrors.push(`Error de JS: ${err.message}`.slice(0, 300)))

    const url = new URL(startPath || '/', previewUrl).toString()
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT_MS })
    await page.waitForTimeout(500)
    transcript.push(`Abrió ${url}`)

    const deadline = Date.now() + TOTAL_TIMEOUT_MS
    for (const step of boundedSteps) {
      if (signal?.aborted) throw new DOMException('Cancelado por el usuario', 'AbortError')
      if (Date.now() > deadline) {
        transcript.push('Se alcanzó el tiempo máximo de prueba (45s), se detuvo aquí.')
        break
      }
      try {
        await runStep(page, step)
        transcript.push(`OK: ${describeStep(step)}`)
      } catch (err) {
        transcript.push(`FALLÓ: ${describeStep(step)} — ${String(err.message || err).split('\n')[0]}`)
      }
    }

    const finalPageText = await page
      .locator('body')
      .innerText()
      .catch(() => '(no se pudo leer el texto de la página)')

    return {
      transcript,
      finalPageText: finalPageText.slice(0, 4000),
      consoleErrors: consoleErrors.slice(0, 20),
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    await browser.close().catch(() => {})
  }
}

async function runStep(page, step) {
  switch (step.action) {
    case 'click': {
      await page.getByText(step.text || '', { exact: false }).first().click({ timeout: STEP_TIMEOUT_MS })
      return
    }
    case 'fill': {
      const byLabel = page.getByLabel(step.label || '', { exact: false })
      const byPlaceholder = page.getByPlaceholder(step.label || '', { exact: false })
      const locator = byLabel.or(byPlaceholder).first()
      await locator.fill(step.value ?? '', { timeout: STEP_TIMEOUT_MS })
      return
    }
    case 'select': {
      await page.getByLabel(step.label || '', { exact: false }).first().selectOption({ label: step.value }, { timeout: STEP_TIMEOUT_MS })
      return
    }
    case 'wait': {
      await page.waitForTimeout(Math.min(step.ms || 1000, 5000))
      return
    }
    case 'wait_for_text': {
      await page.getByText(step.text || '', { exact: false }).first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT_MS })
      return
    }
    case 'assert_text': {
      const count = await page.getByText(step.text || '', { exact: false }).count()
      if (count === 0) throw new Error(`No se encontró el texto "${step.text}" en la página`)
      return
    }
    default:
      throw new Error(`Acción desconocida: ${step.action}`)
  }
}

function describeStep(step) {
  switch (step.action) {
    case 'click':
      return `clic en "${step.text}"`
    case 'fill':
      return `escribió "${step.value}" en "${step.label}"`
    case 'select':
      return `seleccionó "${step.value}" en "${step.label}"`
    case 'wait':
      return `esperó ${step.ms || 1000}ms`
    case 'wait_for_text':
      return `esperó a que apareciera "${step.text}"`
    case 'assert_text':
      return `verificó que aparezca "${step.text}"`
    default:
      return step.action
  }
}
