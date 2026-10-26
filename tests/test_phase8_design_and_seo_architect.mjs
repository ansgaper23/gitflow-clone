// tests/test_phase8_design_and_seo_architect.mjs
// Suite de certificación FASE 8:
// 1. Motor de Dirección de Arte UI/UX Senior (designDirector.js)
// 2. Arquitecto Técnico de Google SEO 2026 y Schema.org (seoArchitect.js)
// 3. Amplificador Cognitivo con Fusión de Estética y SEO (promptAmplifier.js)
// 4. Guardián de Integridad UI con Auditoría No-Bloqueante (uiIntegrityGuard.js)

import assert from 'node:assert/strict'

import {
  isWebOrLandingRequest,
  getSeniorArtDirectionDirectives
} from '../backend/src/services/designDirector.js'

import {
  isSeoTarget,
  generateJsonLdTemplate,
  getTechnicalSeoDirectives,
  auditIndexHtmlSeo
} from '../backend/src/services/seoArchitect.js'

import { amplifyPrompt } from '../backend/src/services/promptAmplifier.js'

import {
  validateUiIntegrity,
  auditWebSeoAndDesign
} from '../backend/src/services/uiIntegrityGuard.js'

console.log('--- INICIANDO CERTIFICACIÓN FASE 8: DIRECCIÓN DE ARTE UI/UX & GOOGLE SEO 2026 ---\n')

async function runTests() {
  let passed = 0
  let failed = 0

  const test = async (name, fn) => {
    try {
      await fn()
      console.log(`✅ [PASS] ${name}`)
      passed++
    } catch (err) {
      console.error(`❌ [FAIL] ${name}:`, err.message)
      failed++
    }
  }

  // ==========================================
  // BLOQUE 1: Motor de Dirección de Arte UI/UX Senior
  // ==========================================

  await test('designDirector: Identifica solicitudes web / landing / ecommerce / portfolio', async () => {
    assert.strictEqual(isWebOrLandingRequest('Crea una landing page para una fintech B2B'), true)
    assert.strictEqual(isWebOrLandingRequest('Hazme un sitio web corporativo para una firma legal'), true)
    assert.strictEqual(isWebOrLandingRequest('Diseña una tienda online ecommerce de moda'), true)
    assert.strictEqual(isWebOrLandingRequest('Quiero un portafolio web minimalista'), true)
    assert.strictEqual(isWebOrLandingRequest('Construye la página de inicio para una startup SaaS'), true)
    assert.strictEqual(isWebOrLandingRequest('Haz una web moderna con testimonios y precios'), true)

    // No debe clasificar tareas de backend puro o consultas abstractas
    assert.strictEqual(isWebOrLandingRequest('Crea un endpoint POST /api/login en Express con JWT'), false)
    assert.strictEqual(isWebOrLandingRequest('Explica la diferencia entre useEffect y useLayoutEffect'), false)
    assert.strictEqual(isWebOrLandingRequest('Optimiza esta consulta SQL con índices'), false)
  })

  await test('designDirector: Genera directivas completas de estética nivel Linear/Stripe y Bento Grids', async () => {
    const directives = getSeniorArtDirectionDirectives({ isWebOrLanding: true, theme: 'dark' })

    // Tipografía editorial y ritmo visual
    assert.ok(directives.includes('tracking-tight'), 'Debe incluir tracking-tight')
    assert.ok(directives.includes('text-balance'), 'Debe incluir text-balance')
    assert.ok(directives.includes('leading-[1.08]'), 'Debe incluir leading-[1.08]')

    // Bento Grids asimétricos
    assert.ok(directives.includes('col-span-12 md:col-span-7') || directives.includes('col-span-7'), 'Debe especificar Bento Grids con 7/5')
    assert.ok(directives.includes('col-span-12 md:col-span-5') || directives.includes('col-span-5'), 'Debe especificar Bento Grids con 7/5')

    // Bordes luminosos de 1px y ambient glow
    assert.ok(directives.includes('border-white/10') || directives.includes('1px'), 'Debe especificar bordes luminosos de 1px')
    assert.ok(directives.includes('blur-3xl') || directives.includes('glow') || directives.includes('radial'), 'Debe especificar ambient glow o desenfoques')

    // Estructura CRO de 7 secciones
    assert.ok(/STICKY NAVBAR/i.test(directives), 'Debe exigir Navbar sticky con glassmorphism')
    assert.ok(/HERO/i.test(directives), 'Debe exigir Hero con Badge, titular editorial y doble CTA')
    assert.ok(/TRUST BAR/i.test(directives), 'Debe exigir Trust Bar con logos/social proof')
    assert.ok(/BENTO GRID/i.test(directives), 'Debe exigir Bento Grid de características')
    assert.ok(/TESTIMONIOS|Social Proof/i.test(directives), 'Debe exigir testimonios o prueba social')
    assert.ok(/FAQ/i.test(directives), 'Debe exigir acordeón interactivo de FAQs')
    assert.ok(/FOOTER/i.test(directives), 'Debe exigir Footer corporativo con enlaces y copyright')
  })

  // ==========================================
  // BLOQUE 2: Arquitecto Técnico de Google SEO 2026
  // ==========================================

  await test('seoArchitect: Detecta intenciones de SEO y generación web', async () => {
    assert.strictEqual(isSeoTarget('Crea una landing con optimización SEO para Google'), true)
    assert.strictEqual(isSeoTarget('Sitio web corporativo de consultoría con schema org'), true)
    assert.strictEqual(isSeoTarget('Página de inicio para dentistas en Madrid'), true)
    assert.strictEqual(isSeoTarget('Corrige el botón de cancelar en el modal'), false)
  })

  await test('seoArchitect: Genera plantillas JSON-LD Schema.org válidas (incluyendo FAQPage)', async () => {
    const jsonLdOrg = generateJsonLdTemplate({
      name: 'FlowPro Corp',
      description: 'Plataforma líder de automatización con IA',
      url: 'https://flowpro.ai',
      type: 'Organization'
    })

    assert.ok(jsonLdOrg.includes('"@context": "https://schema.org"'), 'Debe incluir @context schema.org')
    assert.ok(jsonLdOrg.includes('"@type": "Organization"'), 'Debe especificar tipo Organization')
    assert.ok(jsonLdOrg.includes('FlowPro Corp'), 'Debe contener el nombre')

    // Con FAQs
    const faqs = [
      { q: '¿Cómo funciona?', a: 'Funciona automáticamente mediante agentes IA.' },
      { q: '¿Tiene prueba gratis?', a: 'Sí, incluye 14 días de prueba.' }
    ]
    const jsonLdFaq = generateJsonLdTemplate({
      name: 'SaaS App',
      description: 'Herramienta SaaS',
      url: 'https://saas.app',
      faqs
    })

    assert.ok(jsonLdFaq.includes('"@type": "FAQPage"'), 'Debe generar bloque FAQPage')
    assert.ok(jsonLdFaq.includes('¿Cómo funciona?'), 'Debe incluir pregunta 1')
    assert.ok(jsonLdFaq.includes('¿Tiene prueba gratis?'), 'Debe incluir pregunta 2')
    assert.ok(jsonLdFaq.includes('"@type": "Question"'), 'Debe formatear entidades Question')
    assert.ok(jsonLdFaq.includes('"@type": "Answer"'), 'Debe formatear entidades Answer')
  })

  await test('seoArchitect: Genera directivas de Core Web Vitals, semántica HTML5 y Open Graph', async () => {
    const directives = getTechnicalSeoDirectives()

    assert.ok(directives.includes('<header>'), 'Debe exigir semántica header')
    assert.ok(directives.includes('<main>'), 'Debe exigir semántica main')
    assert.ok(directives.includes('<nav'), 'Debe exigir semántica nav')
    assert.ok(directives.includes('<section'), 'Debe exigir semántica section')
    assert.ok(directives.includes('<footer>'), 'Debe exigir semántica footer')
    assert.ok(directives.includes('Exactamente un solo <h1>') || directives.includes('un único <h1>') || directives.includes('<h1>'), 'Debe requerir un único h1')
    assert.ok(directives.includes('fetchpriority="high"'), 'Debe requerir fetchpriority para LCP')
    assert.ok(/aspect-ratio|ratio de aspecto|aspect-video/i.test(directives), 'Debe prevenir CLS con aspect-ratio')
    assert.ok(directives.includes('og:title'), 'Debe incluir Open Graph')
    assert.ok(directives.includes('twitter:card'), 'Debe incluir Twitter Cards')
    assert.ok(directives.includes('application/ld+json'), 'Debe exigir script JSON-LD')
  })

  await test('seoArchitect: auditIndexHtmlSeo detecta títulos genéricos de Vite y metadatos faltantes', async () => {
    const badHtml = `
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Vite + React</title>
        </head>
        <body>
          <div id="root"></div>
        </body>
      </html>
    `
    const badAudit = auditIndexHtmlSeo(badHtml)
    assert.strictEqual(badAudit.valid, false, 'HTML genérico debe fallar la auditoría SEO')
    assert.ok(badAudit.issues.some(i => i.includes('Vite + React')), 'Debe detectar título por defecto de Vite')
    assert.ok(badAudit.issues.some(i => /description/i.test(i)), 'Debe detectar ausencia de meta description')
    assert.ok(badAudit.issues.some(i => i.includes('Schema.org')), 'Debe detectar falta de Schema.org JSON-LD')
    assert.ok(badAudit.score < 50, 'El score debe ser inferior a 50')

    const goodHtml = `
      <!doctype html>
      <html lang="es">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Nexus AI | Plataforma de Inteligencia Artificial para Empresas</title>
          <meta name="description" content="Automatiza los flujos de trabajo de tu empresa con agentes de inteligencia artificial de última generación. Prueba gratuita de 14 días." />
          <link rel="canonical" href="https://nexus.ai" />
          <meta property="og:title" content="Nexus AI | Plataforma de IA para Empresas" />
          <meta property="og:description" content="Automatiza flujos de trabajo con agentes IA." />
          <meta property="og:image" content="https://nexus.ai/og.png" />
          <meta name="twitter:card" content="summary_large_image" />
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              "name": "Nexus AI",
              "applicationCategory": "BusinessApplication"
            }
          </script>
        </head>
        <body>
          <div id="root"></div>
        </body>
      </html>
    `
    const goodAudit = auditIndexHtmlSeo(goodHtml)
    assert.strictEqual(goodAudit.valid, true, 'HTML optimizado debe pasar la auditoría SEO')
    assert.strictEqual(goodAudit.issues.length, 0, 'No debe tener issues críticos')
    assert.ok(goodAudit.score >= 90, 'El score debe ser 90+')
  })

  // ==========================================
  // BLOQUE 3: Amplificador Cognitivo (promptAmplifier.js)
  // ==========================================

  await test('promptAmplifier: Amplifica solicitudes de landing / web con Dirección de Arte y SEO', async () => {
    const amplified = amplifyPrompt('Crea una landing page de primer nivel para una plataforma SaaS de logística')

    assert.strictEqual(amplified.isAmplified, true)
    assert.strictEqual(amplified.scope, 'LANDING_PAGE')
    assert.ok(amplified.amplifiedDirectives.includes('DIRECCIÓN DE ARTE UI/UX SENIOR'), 'Debe incluir Dirección de Arte')
    assert.ok(amplified.amplifiedDirectives.includes('BENTO GRID'), 'Debe incluir Bento Grid')
    assert.ok(/SEO TÉCNICO GOOGLE 2026/i.test(amplified.amplifiedDirectives), 'Debe incluir directivas SEO')
    assert.ok(/schema\.org/i.test(amplified.amplifiedDirectives), 'Debe incluir directivas de Schema.org')
  })

  await test('promptAmplifier: Mantiene quirúrgicas las ediciones pequeñas sin inyectar directivas masivas', async () => {
    const surgical1 = amplifyPrompt('cambia el color del botón guardar a rojo')
    assert.strictEqual(surgical1.isAmplified, false)
    assert.strictEqual(surgical1.scope, 'SURGICAL')
    assert.strictEqual(surgical1.amplifiedDirectives, '')

    const surgical2 = amplifyPrompt('corrige el padding del header a py-4')
    assert.strictEqual(surgical2.isAmplified, false)
    assert.strictEqual(surgical2.scope, 'SURGICAL')
    assert.strictEqual(surgical2.amplifiedDirectives, '')
  })

  // ==========================================
  // BLOQUE 4: Guardián de Integridad UI (uiIntegrityGuard.js)
  // ==========================================

  await test('uiIntegrityGuard: auditWebSeoAndDesign evalúa semántica HTML5 y estructura de App.jsx', async () => {
    const nonSemanticApp = `
      import React from 'react'
      export default function App() {
        return (
          <div className="min-h-screen bg-slate-900">
            <div className="p-4">
              <h2>Título sin h1</h2>
              <div>Contenido genérico</div>
            </div>
          </div>
        )
      }
    `
    const defaultIndexHtml = `
      <!doctype html>
      <html>
        <head><title>Vite + React</title></head>
        <body><div id="root"></div></body>
      </html>
    `

    const auditResult = auditWebSeoAndDesign({
      indexHtmlContent: defaultIndexHtml,
      appContent: nonSemanticApp,
      userMessage: 'Crea una landing page profesional'
    })

    assert.ok(auditResult.advisories.length > 0, 'Debe emitir sugerencias')
    assert.ok(auditResult.advisories.some(a => a.includes('Vite + React')), 'Debe advertir sobre título Vite')
    assert.ok(auditResult.advisories.some(a => a.includes('<h1>')), 'Debe advertir sobre ausencia de h1')
    assert.ok(auditResult.advisories.some(a => a.includes('HTML5')), 'Debe advertir sobre falta de etiquetas semánticas')

    const semanticApp = `
      import React from 'react'
      export default function App() {
        return (
          <div className="min-h-screen bg-black text-white">
            <header className="sticky top-0 z-50 backdrop-blur-md border-b border-white/10">
              <nav><a href="#features">Features</a></nav>
            </header>
            <main>
              <section className="py-24">
                <h1 className="text-5xl font-bold tracking-tight">Potencia tu Empresa con IA</h1>
              </section>
              <section id="features" className="py-20">
                <div className="grid grid-cols-12 gap-6">
                  <div className="col-span-12 md:col-span-7">Bento 1</div>
                  <div className="col-span-12 md:col-span-5">Bento 2</div>
                </div>
              </section>
            </main>
            <footer className="border-t border-white/10 py-12">
              <p>&copy; 2026 Nexus AI. Todos los derechos reservados.</p>
            </footer>
          </div>
        )
      }
    `

    const optimizedIndexHtml = `
      <!doctype html>
      <html lang="es">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Nexus AI | Soluciones de IA</title>
          <meta name="description" content="Automatización inteligente con IA para empresas globales." />
          <meta property="og:title" content="Nexus AI | Soluciones de IA" />
          <meta property="og:description" content="Automatización inteligente con IA para empresas globales." />
          <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Nexus"}</script>
        </head>
        <body><div id="root"></div></body>
      </html>
    `

    const cleanAudit = auditWebSeoAndDesign({
      indexHtmlContent: optimizedIndexHtml,
      appContent: semanticApp,
      userMessage: 'Crea una landing page profesional'
    })

    assert.strictEqual(cleanAudit.advisories.length, 0, 'No debe emitir advertencias en código semántico y optimizado')
  })

  await test('uiIntegrityGuard: validateUiIntegrity ejecuta auditoría SEO de manera NO-BLOQUEANTE', async () => {
    // Si hay advertencias de SEO pero los componentes están bien conectados y los botones tienen onClick,
    // validateUiIntegrity debe retornar valid: true (jamás bloquear la compilación o guardado).
    const staged = new Map()
    staged.set('index.html', `<!doctype html><html><head><title>Vite + React</title></head><body><div id="root"></div></body></html>`)
    staged.set('src/App.jsx', `
      import React from 'react'
      import Hero from './components/Hero'
      export default function App() {
        return <div><Hero /></div>
      }
    `)
    staged.set('src/components/Hero.jsx', `
      import React from 'react'
      export default function Hero() {
        return <button onClick={() => alert('Hola')}>Comenzar</button>
      }
    `)

    const result = await validateUiIntegrity({
      stagedContent: staged,
      proposedChanges: [
        { type: 'create', path: 'src/components/Hero.jsx' },
        { type: 'modify', path: 'src/App.jsx' }
      ],
      userMessage: 'Crea una landing page'
    })

    assert.strictEqual(result.valid, true, 'Debe ser estrictamente NO-BLOQUEANTE para SEO (valid === true)')
    assert.strictEqual(result.errors.length, 0, 'No debe haber errores bloqueantes')
    assert.ok(result.seoAdvisories && result.seoAdvisories.length > 0, 'Debe incluir las recomendaciones de SEO como sugerencias')
    assert.ok(result.seoAdvisories.some(a => a.includes('Vite + React')), 'Debe avisar sobre el título Vite + React')
  })

  console.log(`\n========================================`)
  console.log(`RESULTADOS CERTIFICACIÓN FASE 8:`)
  console.log(`Pruebas superadas: ${passed}`)
  console.log(`Pruebas fallidas:  ${failed}`)
  console.log(`========================================\n`)

  if (failed > 0) {
    process.exit(1)
  }
}

runTests().catch(err => {
  console.error('Error fatal ejecutando suite FASE 8:', err)
  process.exit(1)
})
