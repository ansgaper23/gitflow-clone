// tests/test_master_design_directive.mjs
// SUITE DE CERTIFICACIÓN: DIRECTIVA MAESTRA DE DISEÑO FRONTEND, UI/UX Y ARQUITECTURA VISUAL
// Verifica la integración completa y determinista de los 5 Pilares de Diseño en FlowPro:
// 1. Anti-patrones prohibidos (Cero estética de IA básica)
// 2. Sistema de diseño y tokens visuales (Tailwind + shadcn, Dark/Light mode, tipografía y overlines)
// 3. Ritmo visual y Bento Grids asimétricos (Hero focal, badges, Bento 7/5, social proof, FAQs)
// 4. Realismo y copywriting específico del dominio (jerga real, badges Activo/Verificado/99.98% SLA)
// 5. Micro-interacciones y detalles de componente (hover -translate-y-0.5, contenedores de iconos, sticky header)
// 6. Integración en designDirector.js, promptAmplifier.js y agent.js

import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import {
  MASTER_UI_UX_DESIGN_DIRECTIVE,
  getSeniorArtDirectionDirectives,
  isWebOrLandingRequest
} from '../backend/src/services/designDirector.js'
import { amplifyPrompt } from '../backend/src/services/promptAmplifier.js'

console.log('================================================================')
console.log('🎨 SUITE DE CERTIFICACIÓN: DIRECTIVA MAESTRA DE DISEÑO UI/UX')
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
// BLOQUE 1: CONSTANTE MAESTRA Y ESTRUCTURA DE LOS 5 PILARES
// ────────────────────────────────────────────────────────────────

await runTestCase('MASTER_UI_UX_DESIGN_DIRECTIVE: Exportada y con encabezado oficial', async () => {
  assert.ok(typeof MASTER_UI_UX_DESIGN_DIRECTIVE === 'string', 'Debe ser un string exportado')
  assert.ok(MASTER_UI_UX_DESIGN_DIRECTIVE.includes('# DIRECTIVA MAESTRA DE DISEÑO FRONTEND, UI/UX Y ARQUITECTURA VISUAL'))
  assert.ok(MASTER_UI_UX_DESIGN_DIRECTIVE.includes('Lead Product Designer y Frontend Engineer de élite'))
})

await runTestCase('Pilar 1 - Anti-Patrones Prohibidos: Prohíbe estética monótona y texto de relleno', async () => {
  assert.ok(MASTER_UI_UX_DESIGN_DIRECTIVE.includes('ANTI-PATRONES PROHIBIDOS (CERO ESTÉTICA DE IA BÁSICA)'))
  assert.ok(MASTER_UI_UX_DESIGN_DIRECTIVE.includes('PROHIBIDO usar fondos planos monótonos con 3 tarjetas idénticas'))
  assert.ok(MASTER_UI_UX_DESIGN_DIRECTIVE.includes('PROHIBIDO el texto de relleno ("Lorem ipsum", "Servicio 1"'))
  assert.ok(MASTER_UI_UX_DESIGN_DIRECTIVE.includes('PROHIBIDO el uso de degradados cliché morado/azul'))
  assert.ok(MASTER_UI_UX_DESIGN_DIRECTIVE.includes('PROHIBIDO crear tablas o formularios crudos sin contenedor estilizado'))
  assert.ok(MASTER_UI_UX_DESIGN_DIRECTIVE.includes('PROHIBIDO el espaciado comprimido o inconsistente'))
})

await runTestCase('Pilar 2 - Sistema de Diseño y Tokens: Superficies, elevación y tipografía', async () => {
  assert.ok(MASTER_UI_UX_DESIGN_DIRECTIVE.includes('SISTEMA DE DISEÑO Y TOKENS VISUALES (TAILWIND + SHADCN)'))
  assert.ok(MASTER_UI_UX_DESIGN_DIRECTIVE.includes('bg-slate-950') && MASTER_UI_UX_DESIGN_DIRECTIVE.includes('bg-zinc-950'))
  assert.ok(MASTER_UI_UX_DESIGN_DIRECTIVE.includes('bg-slate-900/60'))
  assert.ok(MASTER_UI_UX_DESIGN_DIRECTIVE.includes('border-slate-800/80'))
  assert.ok(MASTER_UI_UX_DESIGN_DIRECTIVE.includes('backdrop-blur-md'))
  assert.ok(MASTER_UI_UX_DESIGN_DIRECTIVE.includes('bg-slate-50') && MASTER_UI_UX_DESIGN_DIRECTIVE.includes('bg-zinc-50'))
  assert.ok(MASTER_UI_UX_DESIGN_DIRECTIVE.includes('text-4xl md:text-6xl font-extrabold tracking-tight'))
  assert.ok(MASTER_UI_UX_DESIGN_DIRECTIVE.includes('text-xs font-semibold uppercase tracking-wider text-primary'))
})

await runTestCase('Pilar 3 - Ritmo Visual y Bento Grids: Hero, Bento 7/5 y social proof', async () => {
  assert.ok(MASTER_UI_UX_DESIGN_DIRECTIVE.includes('Hero Section de Alto Impacto'))
  assert.ok(MASTER_UI_UX_DESIGN_DIRECTIVE.includes('rounded-full px-3 py-1 border text-xs'))
  assert.ok(MASTER_UI_UX_DESIGN_DIRECTIVE.includes('bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent'))
  assert.ok(MASTER_UI_UX_DESIGN_DIRECTIVE.includes('Button size="lg"'))
  assert.ok(MASTER_UI_UX_DESIGN_DIRECTIVE.includes('blur-3xl opacity-20 -z-10'))
  assert.ok(MASTER_UI_UX_DESIGN_DIRECTIVE.includes('Bento Grid'))
  assert.ok(MASTER_UI_UX_DESIGN_DIRECTIVE.includes('text-3xl font-bold'))
  assert.ok(MASTER_UI_UX_DESIGN_DIRECTIVE.includes('Tabla comparativa') || MASTER_UI_UX_DESIGN_DIRECTIVE.includes('FAQ con acordeones'))
})

await runTestCase('Pilar 4 - Realismo y Copywriting: Dominio, métricas y badges de estado', async () => {
  assert.ok(MASTER_UI_UX_DESIGN_DIRECTIVE.includes('REALISMO Y COPYWRITING ESPECÍFICO DEL DOMINIO'))
  assert.ok(MASTER_UI_UX_DESIGN_DIRECTIVE.includes('Conciliación RIPS') || MASTER_UI_UX_DESIGN_DIRECTIVE.includes('Ruteo dinámico'))
  assert.ok(MASTER_UI_UX_DESIGN_DIRECTIVE.includes('Activo') && MASTER_UI_UX_DESIGN_DIRECTIVE.includes('Verificado'))
  assert.ok(MASTER_UI_UX_DESIGN_DIRECTIVE.includes('99.98% SLA'))
})

await runTestCase('Pilar 5 - Micro-Interacciones y Detalles: Hover, contenedor de icono y header sticky', async () => {
  assert.ok(MASTER_UI_UX_DESIGN_DIRECTIVE.includes('MICRO-INTERACCIONES Y DETALLES DE COMPONENTE'))
  assert.ok(MASTER_UI_UX_DESIGN_DIRECTIVE.includes('transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg'))
  assert.ok(MASTER_UI_UX_DESIGN_DIRECTIVE.includes('p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20'))
  assert.ok(MASTER_UI_UX_DESIGN_DIRECTIVE.includes('sticky top-0 z-50 backdrop-blur-md bg-background/80 border-b'))
})

// ────────────────────────────────────────────────────────────────
// BLOQUE 2: PROPAGACIÓN EN DIRECTIVAS Y SYSTEM PROMPT
// ────────────────────────────────────────────────────────────────

await runTestCase('designDirector: getSeniorArtDirectionDirectives incluye los 5 pilares completos', async () => {
  const directives = getSeniorArtDirectionDirectives({ isWebOrLanding: true, industry: 'technology' })
  assert.ok(directives.includes('DIRECTIVA MAESTRA DE DISEÑO FRONTEND, UI/UX Y ARQUITECTURA VISUAL'))
  assert.ok(directives.includes('99.98% SLA'))
  assert.ok(directives.includes('hover:-translate-y-0.5'))
  assert.ok(directives.includes('p-2.5 rounded-xl bg-primary/10'))
  assert.ok(directives.includes('backdrop-blur-md'))
})

await runTestCase('promptAmplifier: Inyecta los 5 pilares en turnos de landing/módulos', async () => {
  const amp = amplifyPrompt('Crea una landing page para una plataforma médica', { turnMode: 'BUILD' })
  assert.strictEqual(amp.isAmplified, true)
  assert.ok(amp.amplifiedDirectives.includes('DIRECTIVA MAESTRA DE DISEÑO FRONTEND'))
  assert.ok(amp.amplifiedDirectives.includes('99.98% SLA'))
  assert.ok(amp.amplifiedDirectives.includes('p-2.5 rounded-xl bg-primary/10'))
})

await runTestCase('agent.js: Contiene la Directiva Maestra de Diseño en el contrato conductual', async () => {
  const agentCode = await fs.readFile('backend/src/services/agent.js', 'utf-8')
  assert.ok(agentCode.includes('DIRECTIVA MAESTRA DE DISEÑO FRONTEND, UI/UX Y ARQUITECTURA VISUAL'))
  assert.ok(agentCode.includes('ESTÁNDAR LEAD DESIGNER & FRONTEND ENGINEER DE ÉLITE'))
  assert.ok(agentCode.includes('99.98% SLA'))
  assert.ok(agentCode.includes('p-2.5 rounded-xl bg-primary/10'))
  assert.ok(agentCode.includes('hover:-translate-y-0.5'))
})

console.log('\n================================================================')
console.log(`🎉 CERTIFICACIÓN EXITOSA: ${passedTests}/${totalTests} TESTS COMPLETADOS CON ÉXITO`)
console.log('================================================================\n')
