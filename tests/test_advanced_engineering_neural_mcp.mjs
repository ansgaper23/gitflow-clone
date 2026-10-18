// tests/test_advanced_engineering_neural_mcp.mjs
// SUITE DE CERTIFICACIÓN: INGENIERÍA AVANZADA (REDES NEURONALES, GRAFOS, CANVA 2D/WEBGL Y MCP)
// Verifica que agent.js y designDirector.js contienen las directivas deterministas de:
// 1. Prohibición de partículas flotantes libres ("pelotas saltando")
// 2. Física de propagación sináptica sobre aristas P(t) = (1-t)P1 + tP2
// 3. Estela sináptica (motion trail) con shadowBlur
// 4. Cascada por capas y activación luminosa (activationGlow = 1.0)
// 5. Pesos reales y rutas de anomalía
// 6. Arquitectura real MCP (Host, Client, Servers, stdio/SSE, JSON-RPC 2.0)
// 7. Prohibición estricta de LaTeX crudo ($\rightarrow$) a favor de Unicode (→, ↔, •, ✓)

import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { getSeniorArtDirectionDirectives } from '../backend/src/services/designDirector.js'

console.log('================================================================')
console.log('🧠 SUITE DE CERTIFICACIÓN: INGENIERÍA AVANZADA, NEURAL & MCP')
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

const agentCode = await fs.readFile('backend/src/services/agent.js', 'utf-8')
const designDirectives = getSeniorArtDirectionDirectives({ isWebOrLanding: true })

// ────────────────────────────────────────────────────────────────
// BLOQUE 1: PROHIBICIÓN DE LATEX CRUDO Y UNICODE DIRECTO
// ────────────────────────────────────────────────────────────────

await runTestCase('agent.js: Prohibición expresa de rightarrow y LaTeX crudo en chat', async () => {
  assert.ok(agentCode.includes('FORMATO DE TEXTO Y CARACTERES UNICODE (PROHIBICIÓN TOTAL DE LATEX CRUDO)'), 'Debe existir regla de formato')
  assert.ok(agentCode.includes('rightarrow') && agentCode.includes('LATEX CRUDO'), 'Debe mencionar rightarrow como prohibido')
  assert.ok(agentCode.includes('→') && agentCode.includes('↔') && agentCode.includes('✓'), 'Debe exigir Unicode limpio')
})

// ────────────────────────────────────────────────────────────────
// BLOQUE 2: FÍSICA DE REDES NEURONALES Y PROPAGACIÓN SINÁPTICA
// ────────────────────────────────────────────────────────────────

await runTestCase('agent.js: Prohíbe partículas flotantes libres ("pelotas saltando")', async () => {
  assert.ok(agentCode.includes('PROHIBICIÓN ESTRICTA DE PARTÍCULAS FLOTANTES FALSAS EN REDES NEURONALES Y GRAFOS'))
  assert.ok(agentCode.includes('pelotas saltando'))
  assert.ok(agentCode.includes('x += vx, y += vy'))
})

await runTestCase('agent.js: Exige física sobre aristas P(t) = (1-t)P1 + tP2 y parámetro t', async () => {
  assert.ok(agentCode.includes('FÍSICA OBLIGATORIA DE PROPAGACIÓN SINÁPTICA SOBRE ARISTAS'))
  assert.ok(agentCode.includes('px = x1 + (x2 - x1) * t') || agentCode.includes('P(t) = (1 - t)P1 + tP2'))
})

await runTestCase('agent.js: Exige estela sináptica (motion trail) con shadowBlur', async () => {
  assert.ok(agentCode.includes('EFECTO DE COMETA / ESTELA SINÁPTICA (MOTION TRAIL)'))
  assert.ok(agentCode.includes('shadowBlur'))
  assert.ok(agentCode.includes('t - 0.12'))
})

await runTestCase('agent.js: Exige propagación en cascada y destello activationGlow = 1.0', async () => {
  assert.ok(agentCode.includes('PROPAGACIÓN EN CASCADA POR CAPAS (FORWARD PASS WAVE)'))
  assert.ok(agentCode.includes('activationGlow = 1.0'))
})

await runTestCase('agent.js: Exige pesos reales y colorización de anomalías (ArgMax / Softmax)', async () => {
  assert.ok(agentCode.includes('PESOS Y COLORES REALES SEGÚN ANOMALÍAS'))
  assert.ok(agentCode.includes('ArgMax / Softmax'))
})

// ────────────────────────────────────────────────────────────────
// BLOQUE 3: ARQUITECTURA MCP (MODEL CONTEXT PROTOCOL)
// ────────────────────────────────────────────────────────────────

await runTestCase('agent.js: Modela arquitectura real MCP (Host, Client, Servers, JSON-RPC 2.0)', async () => {
  assert.ok(agentCode.includes('ARQUITECTURA PARA SISTEMAS MCP (MODEL CONTEXT PROTOCOL) Y AGENTES'))
  assert.ok(agentCode.includes('MCP Host') && agentCode.includes('MCP Client') && agentCode.includes('MCP Servers'))
  assert.ok(agentCode.includes('JSON-RPC 2.0'))
  assert.ok(agentCode.includes('stdio / SSE') || agentCode.includes('stdio'))
})

// ────────────────────────────────────────────────────────────────
// BLOQUE 4: PROPAGACIÓN EN DESIGN DIRECTOR
// ────────────────────────────────────────────────────────────────

await runTestCase('designDirector.js: getSeniorArtDirectionDirectives incluye sección de ingeniería científica', async () => {
  assert.ok(designDirectives.includes('INGENIERÍA Y VISUALIZACIÓN CIENTÍFICA (REDES NEURONALES, GRAFOS Y MCP)'))
  assert.ok(designDirectives.includes('CERO PARTÍCULAS FLOTANTES LIBRES'))
  assert.ok(designDirectives.includes('PROPAGACIÓN SINÁPTICA ANCLADA A ARISTAS'))
  assert.ok(designDirectives.includes('MODELADO MCP REAL'))
})

console.log('\n================================================================')
console.log(`🎉 CERTIFICACIÓN EXITOSA: ${passedTests}/${totalTests} TESTS COMPLETADOS CON ÉXITO`)
console.log('================================================================\n')
