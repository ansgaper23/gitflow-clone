// tests/test_palette_and_url_inspector.mjs
// SUITE DE CERTIFICACIÓN: EXTRACCIÓN MATEMÁTICA DE PALETA, INSPECTOR DE URLs CON VISIÓN,
// 4 ARQUETIPOS DE AGENCIA Y DIRECTIVA ANTI-CLICHÉ DE BENTO GRIDS (ESTÁNDAR LOVABLE)

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { extractDominantPalette } from '../backend/src/services/attachmentProcessor.js'
import {
  DESIGN_ARCHETYPES,
  detectDesignArchetype,
  MASTER_UI_UX_DESIGN_DIRECTIVE,
  getSeniorArtDirectionDirectives,
} from '../backend/src/services/designDirector.js'
import {
  inspectWebsiteUrl,
  buildStrategicConsultingReport,
  extractContactData,
} from '../backend/src/services/websiteInspector.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

console.log('================================================================')
console.log('🧪 SUITE DE CERTIFICACIÓN: PALETA MATEMÁTICA, VISIÓN & 4 ARQUETIPOS')
console.log('================================================================\n')

let passedTests = 0
let totalTests = 0

async function runTestCase(name, fn) {
  totalTests++
  process.stdout.write(`TEST ${totalTests} - ${name} ... `)
  const start = performance.now()
  try {
    await fn()
    const duration = (performance.now() - start).toFixed(1)
    console.log(`✅ PASS (${duration}ms)`)
    passedTests++
  } catch (err) {
    console.log('❌ FAIL')
    console.error(err)
    throw err
  }
}

// ────────────────────────────────────────────────────────────────
// BLOQUE 1: EXTRACTOR MATEMÁTICO DE PALETA (SHARP + PÍXELES CROMÁTICOS)
// ────────────────────────────────────────────────────────────────

await runTestCase('extractDominantPalette: Muestreo de píxeles, filtrado de blancos/negros/grises y conversión HSL', async () => {
  // Generar un SVG sintético con fondo blanco (#ffffff), rectángulo azul corporativo (#0066cc) y círculo naranja (#ff6600)
  const svg = `
    <svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
      <rect width="200" height="200" fill="#ffffff"/>
      <rect x="20" y="20" width="100" height="100" fill="#0066cc"/>
      <circle cx="150" cy="150" r="40" fill="#ff6600"/>
    </svg>
  `
  const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer()
  const palette = await extractDominantPalette(pngBuffer)

  assert.ok(palette, 'La función debe devolver un objeto de paleta')
  assert.ok(palette.primaryHex.startsWith('#'), 'primaryHex debe ser un código HEX válido')
  assert.ok(palette.primaryHsl.includes('%'), 'primaryHsl debe tener formato Tailwind HSL con porcentajes')
  assert.ok(palette.secondaryHex.startsWith('#'), 'secondaryHex debe ser un código HEX')
  assert.ok(palette.secondaryHsl.includes('%'), 'secondaryHsl debe tener formato Tailwind HSL')
  assert.ok(palette.accentHex.startsWith('#'), 'accentHex debe ser un código HEX')
  assert.ok(palette.surfaceTone === 'light' || palette.surfaceTone === 'dark', 'surfaceTone debe ser light o dark')
  assert.strictEqual(palette.surfaceTone, 'light', 'Una imagen con fondo blanco debe detectarse como surfaceTone light')
  assert.ok(palette.neutralDarkHex && palette.neutralLightHex, 'Debe incluir neutralDark y neutralLight')

  // Verificar que el tono primario detectado corresponda al azul (#0066cc hue ~210)
  const primaryHue = parseInt(palette.primaryHsl.split(' ')[0], 10)
  assert.ok(primaryHue >= 190 && primaryHue <= 230, `El tono primario (${primaryHue}) debe estar en la gama del azul corporativo (190-230)`)
})

await runTestCase('extractDominantPalette: Resiliencia ante buffers vacíos o documentos blanco y negro', async () => {
  const emptyRes = await extractDominantPalette(null)
  assert.ok(emptyRes.primaryHex && emptyRes.primaryHsl, 'Debe retornar un fallback corporativo válido ante null')

  const bwSvg = `
    <svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="100" fill="#ffffff"/>
      <rect x="10" y="10" width="80" height="80" fill="#111111"/>
    </svg>
  `
  const bwBuf = await sharp(Buffer.from(bwSvg)).png().toBuffer()
  const bwRes = await extractDominantPalette(bwBuf)
  assert.ok(bwRes.primaryHex && bwRes.primaryHsl, 'Debe retornar paleta equilibrada ante imagen puramente monocromática')
})

// ────────────────────────────────────────────────────────────────
// BLOQUE 2: 4 ARQUETIPOS DE DISEÑO PROFESIONAL DE AGENCIA
// ────────────────────────────────────────────────────────────────

await runTestCase('DESIGN_ARCHETYPES: Definición completa de los 4 arquetipos con tokens CSS :root', async () => {
  assert.ok(DESIGN_ARCHETYPES.OBSIDIAN_DARK, 'Debe existir Obsidian Dark')
  assert.ok(DESIGN_ARCHETYPES.WARM_EDITORIAL, 'Debe existir Warm Editorial')
  assert.ok(DESIGN_ARCHETYPES.MINIMALIST_CLEAN, 'Debe existir Minimalist Clean')
  assert.ok(DESIGN_ARCHETYPES.INDUSTRIAL_BRUTALIST, 'Debe existir Industrial Brutalist')

  for (const [key, arch] of Object.entries(DESIGN_ARCHETYPES)) {
    assert.ok(arch.id && arch.name && arch.description, `Arquetipo ${key} debe tener id, name y description`)
    assert.ok(arch.palette.primaryHex && arch.palette.primaryHsl, `Arquetipo ${key} debe tener paleta primaria`)
    assert.ok(arch.cssTokens.includes(':root'), `Arquetipo ${key} debe incluir bloque :root en cssTokens`)
    assert.ok(arch.cssTokens.includes('--primary:'), `Arquetipo ${key} debe definir --primary en cssTokens`)
    assert.ok(arch.cssTokens.includes('--accent:'), `Arquetipo ${key} debe definir --accent en cssTokens`)
    assert.ok(arch.cssTokens.includes('--border:'), `Arquetipo ${key} debe definir --border en cssTokens`)
  }
})

await runTestCase('detectDesignArchetype: Inferencia contextual según nicho e industria', async () => {
  const industrial = detectDesignArchetype('electrical', 'mantenimiento de subestaciones y tableros')
  assert.strictEqual(industrial.id, 'industrial_brutalist', 'Ingeniería eléctrica debe mapear a Industrial Brutalist')

  const editorial = detectDesignArchetype('legal', 'estudio de abogados corporativo y boutique')
  assert.strictEqual(editorial.id, 'warm_editorial', 'Boutique/legal debe mapear a Warm Editorial')

  const tech = detectDesignArchetype('software', 'plataforma SaaS con API de IA y consola para desarrolladores')
  assert.strictEqual(tech.id, 'obsidian_dark', 'SaaS/Developer debe mapear a Obsidian Dark')

  const general = detectDesignArchetype('generic', 'sitio web para consultora empresarial')
  assert.strictEqual(general.id, 'minimalist_clean', 'Genérico/empresarial debe mapear a Minimalist Clean')
})

// ────────────────────────────────────────────────────────────────
// BLOQUE 3: DIRECTIVA ANTI-CLICHÉ Y BENTO GRIDS ASIMÉTRICOS
// ────────────────────────────────────────────────────────────────

await runTestCase('MASTER_UI_UX_DESIGN_DIRECTIVE: Prohibición de clichés y Bento Grids asimétricos', async () => {
  assert.ok(
    MASTER_UI_UX_DESIGN_DIRECTIVE.includes('PROHIBIDO usar cuadrículas simétricas de 3 tarjetas monótonas'),
    'Debe prohibir explícitamente las cuadrículas simétricas de 3 tarjetas'
  )
  assert.ok(
    MASTER_UI_UX_DESIGN_DIRECTIVE.includes('PROHIBIDO el texto publicitario genérico de relleno'),
    'Debe prohibir textos de relleno vacíos ("Transforma tu empresa")'
  )
  assert.ok(
    MASTER_UI_UX_DESIGN_DIRECTIVE.includes('Bento Grid'),
    'Debe instruir el uso de Bento Grid'
  )
  assert.ok(
    MASTER_UI_UX_DESIGN_DIRECTIVE.includes('col-span-12 md:col-span-7'),
    'Debe especificar proporciones asimétricas en la Bento Grid'
  )
})

// ────────────────────────────────────────────────────────────────
// BLOQUE 4: INSPECCIÓN DE URLs CON SISTEMA DE DISEÑO INVERSO
// ────────────────────────────────────────────────────────────────

await runTestCase('buildStrategicConsultingReport: Incluye ingeniería inversa de diseño y auditoría heurística', async () => {
  const inspectedData = {
    title: 'SERGESOL PERÚ SAC — Seguridad y Electricidad',
    description: 'Especialistas en recarga de extintores y media tensión',
    headings: {
      h1: ['SERGESOL PERÚ — Ingeniería y Seguridad'],
      h2: ['Servicios Industriales', 'Proyectos Realizados'],
      h3: ['Certificaciones OSCE'],
    },
    contact: {
      phones: ['(01) 456-7890', '+51 987 654 321'],
      whatsapp: ['https://wa.me/51987654321'],
      emails: ['ventas@sergesolperu.com'],
      addresses: ['Av. Universitaria 1234, Lima'],
    },
    topKeywords: ['extintores', 'subestaciones', 'seguridad', 'ingenieria'],
    navLinks: [{ text: 'Servicios', href: '/#servicios' }],
    wordCount: 450,
    scrapeMethod: 'playwright_visual',
    screenshotBase64: 'mock_base64_screenshot',
    computedDesignSystem: {
      bodyBg: 'rgb(24, 24, 27)',
      fontFamily: 'Inter, sans-serif',
      h1Font: 'Inter (48px, 700)',
      buttonBg: 'rgb(234, 88, 12)',
      buttonRadius: '8px',
    },
    designPalette: {
      primaryHex: '#ea580c',
      primaryHsl: '20 90% 48%',
      secondaryHex: '#facc15',
      secondaryHsl: '48 96% 53%',
      surfaceTone: 'dark',
    }
  }

  const report = buildStrategicConsultingReport({
    url: 'https://www.sergesolperu.com',
    inspectedData,
  })

  assert.ok(report.includes('INGENIERÍA INVERSA DE DISEÑO'), 'El reporte debe incluir la sección de ingeniería inversa de diseño')
  assert.ok(report.includes('#ea580c') || report.includes('20 90% 48%'), 'El reporte debe incluir la paleta extraída')
  assert.ok(report.includes('Evaluación Heurística de Defectos Visuales'), 'El reporte debe incluir la tabla heurística')
  assert.ok(report.includes('Bento Grid asimétrico'), 'Debe recomendar Bento Grids en el reporte')
})

// ────────────────────────────────────────────────────────────────
// BLOQUE 5: VERIFICACIÓN DE AGENT.JS Y PROMPT INJECTION
// ────────────────────────────────────────────────────────────────

await runTestCase('agent.js: Inyección de Tokens Semánticos HSL y Multimodal Blocks en inspect_website_url', async () => {
  const agentCode = fs.readFileSync(path.join(projectRoot, 'backend/src/services/agent.js'), 'utf8')

  assert.ok(
    agentCode.includes('=== PALETA CORPORATIVA DETECTADA (MATEMÁTICAMENTE EXTRAÍDA DEL DOCUMENTO/LOGO) ==='),
    'agent.js debe inyectar la sección de paleta corporativa detectada'
  )
  assert.ok(
    agentCode.includes('--primary: ${detectedBrandPalette.primaryHsl}'),
    'agent.js debe instruir la inyección de --primary con el HSL detectado en :root'
  )
  assert.ok(
    agentCode.includes('[CAPTURA VISUAL EN VIVO]: Inspección visual de la URL'),
    'agent.js debe inyectar bloques multimodales visuales cuando inspect_website_url captura screenshot'
  )
})

console.log('\n================================================================')
console.log(`🎉 TODAS LAS PRUEBAS DE PALETA Y URL INSPECTOR PASARON (${passedTests}/${totalTests})`)
console.log('================================================================\n')
