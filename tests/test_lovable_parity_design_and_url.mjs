// tests/test_lovable_parity_design_and_url.mjs
// SUITE DE CERTIFICACIÓN: PARIDAD LOVABLE EN DISEÑO EDITORIAL, CURACIÓN DE IMÁGENES E INSPECCIÓN DE URLs
// Verifica:
// 1. inspectWebsiteUrl() y extractContactData() extraen teléfonos, emails, WhatsApp y direcciones reales.
// 2. curateSearchImages() (searchImages) devuelve URLs verificadas sin IDs inventados de Unsplash.
// 3. designDirector.getSeniorArtDirectionDirectives() contiene directivas anti-saturación, contraste editorial y tarjetas técnicas.
// 4. promptAmplifier.js detecta industrias e inyecta imágenes curadas correspondientes.
// 5. websiteInspector.buildStrategicConsultingReport() genera el reporte estructurado de consultoría.

import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import {
  extractContactData,
  inspectWebsiteUrl,
  buildStrategicConsultingReport,
  extractPdfContent,
} from '../backend/src/services/websiteInspector.js'
import {
  searchImages,
  getContextualImage,
  detectIndustry,
  getIndustryContext,
} from '../backend/src/services/imageCurator.js'
import {
  isWebOrLandingRequest,
  getSeniorArtDirectionDirectives,
} from '../backend/src/services/designDirector.js'
import { amplifyPrompt } from '../backend/src/services/promptAmplifier.js'

console.log('================================================================')
console.log('🧪 SUITE DE CERTIFICACIÓN: PARIDAD LOVABLE (DISEÑO, IMÁGENES & URLs)')
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
// BLOQUE 1: EXTRACCIÓN DE DATOS DE CONTACTO E INSPECTOR DE URLs
// ────────────────────────────────────────────────────────────────

await runTestCase('extractContactData: Extrae teléfonos peruanos, WhatsApp directo y correos corporativos', async () => {
  const sampleText = `
    Bienvenidos a Factimin Perú SAC.
    Central telefónica: (01) 456-7890 o al móvil +51 987 654 321.
    Escríbenos a contacto@factiminperu.com o ventas@factiminperu.pe.
    Ejemplo falso: ignored@example.com
    Visítanos en Av. República de Panamá 3505, San Isidro, Lima.
  `
  const data = extractContactData(sampleText)

  assert.ok(data.phones.length >= 2, 'Debe extraer al menos 2 teléfonos')
  assert.ok(data.phones.some(p => p.includes('987 654 321')), 'Debe extraer el celular')
  assert.ok(data.whatsapp.length >= 1, 'Debe generar el enlace directo de WhatsApp')
  assert.ok(data.whatsapp.some(w => w.includes('51987654321')), 'El número de WhatsApp debe tener prefijo 51')
  assert.ok(data.emails.includes('contacto@factiminperu.com'), 'Debe extraer el correo corporativo')
  assert.ok(!data.emails.includes('ignored@example.com'), 'Debe excluir correos genéricos de example.com')
  assert.ok(data.addresses.some(a => a.includes('Av. República de Panamá')), 'Debe detectar la dirección física')
})

await runTestCase('inspectWebsiteUrl: Estructura de reporte con simulación de HTML/Jina', async () => {
  // Mock global fetch para inspectWebsiteUrl de forma determinista y reproducible
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async (url) => {
      return {
        ok: true,
        text: async () => `
# Factimin Perú — Ingeniería Eléctrica y Automatización
## Soluciones de Potencia y MT/BT
Somos especialistas en subestaciones eléctricas, celdas de media tensión y tableros industriales.
Contacto directo: +51 999 888 777 | info@factiminperu.com
Dirección: Av. Los Conquistadores 1234, Lima
        `
      }
    }

    const report = await inspectWebsiteUrl('https://www.factiminperu.com')
    assert.strictEqual(report.url, 'https://www.factiminperu.com')
    assert.ok(report.headings.h1.length > 0, 'Debe extraer el H1')
    assert.ok(report.contact.phones.some(p => p.includes('999 888 777')), 'Debe extraer el teléfono')
    assert.ok(report.contact.emails.includes('info@factiminperu.com'), 'Debe extraer el email')
    assert.ok(report.contact.whatsapp.length > 0, 'Debe detectar el WhatsApp')
    assert.ok(report.wordCount > 10, 'Debe contabilizar las palabras')
  } finally {
    globalThis.fetch = originalFetch
  }
})

await runTestCase('buildStrategicConsultingReport: Genera diagnóstico completo y regla anti-invención', async () => {
  const inspectedData = {
    title: 'Factimin Perú — Ingeniería de Precisión',
    description: 'Empresa líder en subestaciones y media tensión',
    headings: {
      h1: ['Factimin Perú — Especialistas Eléctricos'],
      h2: ['Servicios de Ingeniería', 'Proyectos Realizados'],
      h3: ['Subestaciones', 'Tableros'],
    },
    contact: {
      phones: ['+51 987 654 321'],
      emails: ['contacto@factiminperu.com'],
      whatsapp: ['https://wa.me/51987654321'],
      addresses: ['Av. Argentina 2020, Lima'],
    },
    topKeywords: ['subestaciones', 'eléctrica', 'ingeniería', 'potencia'],
    navLinks: [{ text: 'Servicios', href: '#servicios' }, { text: 'Contacto', href: '#contacto' }],
    wordCount: 450,
  }

  const pdfText = 'Brochure Factimin: clientes atendidos incluyen REPSOL, ENEL y LATAM. Homologación OSCE nivel 5.'
  const report = buildStrategicConsultingReport({
    url: 'https://www.factiminperu.com',
    pdfText,
    inspectedData,
  })

  assert.ok(report.includes('AUDITORÍA ESTRATÉGICA'), 'Debe incluir encabezado de auditoría')
  assert.ok(report.includes('+51 987 654 321'), 'Debe incluir teléfono extraído')
  assert.ok(report.includes('contacto@factiminperu.com'), 'Debe incluir correo extraído')
  assert.ok(report.includes('REPSOL') || report.includes('ENEL'), 'Debe detectar clientes del brochure')
  assert.ok(report.includes('NO INVENTAR NADA'), 'Debe enfatizar la regla de no inventar datos')
  assert.ok(report.includes('Hero inmersivo'), 'Debe proponer la arquitectura de conversión')
})

// ────────────────────────────────────────────────────────────────
// BLOQUE 2: CURADOR DE IMÁGENES CONTEXTUALES (CERO ALUCINACIÓN)
// ────────────────────────────────────────────────────────────────

await runTestCase('imageCurator: Devuelve URLs verificadas para Industrial / Ingeniería', async () => {
  const images = searchImages('industrial hero electrical subestacion')
  assert.ok(images.length > 0, 'Debe devolver imágenes curadas')

  for (const img of images) {
    assert.ok(img.url.startsWith('https://images.unsplash.com/'), 'La URL debe provenir de Unsplash verificado')
    assert.ok(!img.url.includes('undefined'), 'No debe tener valores undefined en URL')
    assert.ok(img.alt && img.alt.length > 5, 'Debe tener texto ALT descriptivo')
    assert.ok(img.description && img.description.length > 10, 'Debe tener descripción técnica')
    assert.strictEqual(img.industry, 'industrial', 'La industria debe ser industrial')
  }
})

await runTestCase('imageCurator: Devuelve imágenes verificadas para Restaurant y Tecnología', async () => {
  const foodImages = searchImages('restaurante gastronomia gourmet hero')
  assert.ok(foodImages.length > 0, 'Debe encontrar fotos de gastronomía')
  assert.strictEqual(foodImages[0].industry, 'restaurant')

  const techImages = searchImages('software saas cloud dashboard hero')
  assert.ok(techImages.length > 0, 'Debe encontrar fotos de tecnología')
  assert.strictEqual(techImages[0].industry, 'technology')
})

await runTestCase('imageCurator: Fallback seguro sin alucinar IDs cuando no hay match exacto', async () => {
  const generic = getContextualImage({ industry: 'desconocida_xyz', section: 'hero' })
  assert.ok(generic, 'Debe resolver fallback genérico')
  const url = Array.isArray(generic) ? generic[0]?.url : generic?.url
  assert.ok(url.startsWith('https://images.unsplash.com/'), 'Debe usar una URL verificada del catálogo genérico')
})

// ────────────────────────────────────────────────────────────────
// BLOQUE 3: MOTOR DE DIRECCIÓN DE ARTE SENIOR & REGLAS ANTI-SATURACIÓN
// ────────────────────────────────────────────────────────────────

await runTestCase('designDirector: Reglas anti-saturación en hero, contraste editorial y tarjetas sin fotos repetidas', async () => {
  const directives = getSeniorArtDirectionDirectives({
    isWebOrLanding: true,
    isDiagnostic: false,
    industry: 'industrial',
  })

  // 1. Anti-saturación del Hero
  assert.ok(directives.includes('UN SOLO PUNTO FOCAL') || directives.includes('FOCO ÚNICO') || directives.includes('HERO INMERSIVO'), 'Debe exigir foco único en Hero')
  assert.ok(directives.includes('ANTI-SATURACIÓN') || directives.includes('satura el hero'), 'Debe prohibir widgets que saturen el hero')

  // 2. Contraste de fondo editorial
  assert.ok(directives.includes('bg-[#F8F7F4]') || directives.includes('FONDO CLARO EDITORIAL') || directives.includes('fondo claro'), 'Debe exigir alternancia a fondo claro')

  // 3. Tarjetas de servicios sin fotos repetitivas
  assert.ok(directives.includes('SIN FOTOS') || directives.includes('fotos dentro de cada tarjeta') || directives.includes('GRILLAS TÉCNICAS SIN FOTOS'), 'Debe exigir tarjetas técnicas limpias sin fotos repetidas')

  // 4. Inyección de imagen Hero verificada
  assert.ok(directives.includes('IMAGEN HERO RECOMENDADA'), 'Debe inyectar bloque de imagen Hero verificada')
  assert.ok(directives.includes('photo-1581092160562-40aa08e78837') || directives.includes('photo-1558618666-fcd25c85cd64'), 'Debe contener la URL verificada para industrial')
})

// ────────────────────────────────────────────────────────────────
// BLOQUE 4: AMPLIFICADOR COGNITIVO CON DETECCIÓN DE INDUSTRIA
// ────────────────────────────────────────────────────────────────

await runTestCase('promptAmplifier: Detecta industria y propaga a las directivas de arte', async () => {
  const promptIndustrial = 'Diseña una web corporativa para una empresa de ingeniería eléctrica y subestaciones mineras'
  const ampIndustrial = amplifyPrompt(promptIndustrial, { turnMode: 'BUILD' })

  assert.strictEqual(ampIndustrial.isAmplified, true)
  assert.strictEqual(ampIndustrial.scope, 'LANDING_PAGE')
  // Debe contener la imagen verificada de industrial
  assert.ok(ampIndustrial.amplifiedDirectives.includes('photo-1581092160562-40aa08e78837') || ampIndustrial.amplifiedDirectives.includes('photo-1558618666-fcd25c85cd64'), 'Debe inyectar imagen curada de industria eléctrica/industrial')

  const promptTech = 'Crea una landing page para una plataforma de software SaaS de inteligencia artificial'
  const ampTech = amplifyPrompt(promptTech, { turnMode: 'BUILD' })
  assert.strictEqual(ampTech.isAmplified, true)
  assert.ok(ampTech.amplifiedDirectives.includes('technology') || ampTech.amplifiedDirectives.includes('software') || ampTech.amplifiedDirectives.includes('IMAGEN HERO RECOMENDADA'))
})

// ────────────────────────────────────────────────────────────────
// BLOQUE 5: INTEGRACIÓN CON AGENT.JS (DIRECTIVAS DE VERACIDAD)
// ────────────────────────────────────────────────────────────────

await runTestCase('agent.js: Contiene directiva PROHIBIDO INVENTAR DATOS y protocolo de consultoría', async () => {
  const fs = await import('node:fs/promises')
  const agentCode = await fs.readFile('backend/src/services/agent.js', 'utf-8')

  assert.ok(agentCode.includes('DIRECTIVA ABSOLUTA: PROHIBIDO INVENTAR DATOS'), 'Debe contener el encabezado de veracidad')
  assert.ok(agentCode.includes('PROHIBICIÓN TOTAL DE DATOS DE CONTACTO FICTICIOS'), 'Debe prohibir inventar teléfonos y correos')
  assert.ok(agentCode.includes('PROHIBICIÓN TOTAL DE INVENTAR URLs O IDs DE IMÁGENES'), 'Debe prohibir alucinar IDs de Unsplash')
  assert.ok(agentCode.includes('PROTOCOLO DE AUDITORÍA ESTRATÉGICA Y REDISEÑO'), 'Debe contener el protocolo para URL + PDF')
  assert.ok(agentCode.includes('inspect_website_url'), 'Debe instruir el uso de inspect_website_url')
  assert.ok(agentCode.includes('extractPdfContent'), 'Debe integrar extractPdfContent')
})

console.log('\n================================================================')
console.log(`🎉 TODAS LAS PRUEBAS DE PARIDAD LOVABLE PASARON EXITOSAMENTE (${passedTests}/${totalTests})`)
console.log('================================================================\n')
