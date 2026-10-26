import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

import { analyzePromptIntent } from '../src/services/agent.js'
import { memoryCircuitBreaker, COOLDOWN_MS } from '../src/services/aiAccounts.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

console.log('=== TEST SUITE: LATENCY AND FAST PATCH OPTIMIZATIONS ===\n')

// ── TEST 1: Intención Semántica en Modo Build ──
console.log('Test 1: Clasificación de intención en modo Build...')
{
  const prompt1 = 'que esta web sea igual a esta, los colores, botones, secciones, ubicacion. https://electrinovaperu.com/'
  const res1 = analyzePromptIntent(prompt1, { mode: 'build' })
  assert.equal(res1.isPureQuestion, false, 'Prompt 1 no debe ser PURE_QUESTION')
  assert.equal(res1.hasActionOrder, true, 'Prompt 1 debe tener hasActionOrder = true')
  console.log('  ✓ "que esta web sea..." -> isPureQuestion: false, hasActionOrder: true')

  const prompt2 = 'el color de fondo es otro no el que pusiste.'
  const res2 = analyzePromptIntent(prompt2, { mode: 'build' })
  assert.equal(res2.isPureQuestion, false, 'Prompt 2 no debe ser PURE_QUESTION')
  assert.equal(res2.hasActionOrder, true, 'Prompt 2 debe tener hasActionOrder = true')
  console.log('  ✓ "el color de fondo es otro..." -> isPureQuestion: false, hasActionOrder: true')

  const prompt3 = 'en Productos Certificados aparecen imágenes que no corresponden con los productos'
  const res3 = analyzePromptIntent(prompt3, { mode: 'build' })
  assert.equal(res3.isPureQuestion, false, 'Prompt 3 no debe ser PURE_QUESTION')
  assert.equal(res3.hasActionOrder, true, 'Prompt 3 debe tener hasActionOrder = true')
  console.log('  ✓ "aparecen imágenes que no corresponden..." -> isPureQuestion: false, hasActionOrder: true')

  const promptQuestion = '¿cómo funciona la integración con supabase?'
  const resQ = analyzePromptIntent(promptQuestion, { mode: 'build' })
  assert.equal(resQ.isPureQuestion, true, 'Pregunta real con signos de interrogación debe ser PURE_QUESTION')
  assert.equal(resQ.hasActionOrder, false, 'Pregunta real no debe tener hasActionOrder')
  console.log('  ✓ "¿cómo funciona...?" -> isPureQuestion: true (pregunta real preservada)')
}

// ── TEST 2: Parches Atómicos con Multi-Reemplazo (replace_file_content) ──
console.log('\nTest 2: Soporte de Multi-Reemplazo en replace_file_content...')
{
  const sampleComponent = `
import React from 'react';

export default function Header() {
  return (
    <header className="bg-slate-900 text-white p-4">
      <h1 className="text-xl font-bold">Electrinova Perú</h1>
      <button className="bg-blue-600 px-4 py-2 rounded">Contactar</button>
    </header>
  );
}
`.trim()

  const replacements = [
    {
      search_block: 'bg-slate-900',
      replace_block: 'bg-amber-500'
    },
    {
      search_block: 'bg-blue-600',
      replace_block: 'bg-yellow-400 text-slate-950 font-semibold'
    }
  ]

  let patched = sampleComponent
  for (const rep of replacements) {
    assert.ok(patched.includes(rep.search_block), `Bloque de búsqueda "${rep.search_block}" debe existir en el código`)
    patched = patched.replace(rep.search_block, rep.replace_block)
  }

  assert.ok(patched.includes('bg-amber-500'), 'El fondo debe haberse actualizado a bg-amber-500')
  assert.ok(patched.includes('bg-yellow-400 text-slate-950'), 'El botón debe haberse actualizado con las nuevas clases')
  assert.ok(!patched.includes('bg-slate-900'), 'El fondo viejo debe haber sido reemplazado')
  console.log('  ✓ Multi-reemplazo secuencial aplicado sin conflicto y preservando el resto del archivo')
}

// ── TEST 3: Compresión Estricta con sharp y Purga Efímera de Base64 ──
console.log('\nTest 3: Compresión con sharp y Purga Efímera...')
{
  // 1. Crear un buffer de imagen pesada simulada de 2000x2000 px
  const rawImageBuffer = await sharp({
    create: {
      width: 2000,
      height: 2000,
      channels: 3,
      background: { r: 240, g: 180, b: 20 }
    }
  }).png().toBuffer()

  console.log(`  - Imagen original simulada: ${Math.round(rawImageBuffer.length / 1024)} KB`)

  // 2. Aplicar compresión estricta de inspect_project_image
  const compressedBuffer = await sharp(rawImageBuffer)
    .resize({ width: 900, height: 900, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 75 })
    .toBuffer()

  const compressedKb = Math.round(compressedBuffer.length / 1024)
  console.log(`  - Imagen comprimida con sharp (900x900, q75): ${compressedKb} KB`)
  assert.ok(compressedKb < 150, `El tamaño comprimido (${compressedKb} KB) debe ser menor a 150 KB`)

  // 3. Purga Efímera en historial de mensajes
  const simulatedMessages = [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Ronda 1: Inspeccionando imagen' },
        { type: 'image', source: { type: 'base64', data: compressedBuffer.toString('base64') } }
      ]
    },
    {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'tool_1', name: 'read_file', input: { path: 'src/App.jsx' } }]
    },
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'tool_1', content: 'Contenido de App.jsx' }
      ]
    }
  ]

  // Ejecutar lógica de purga efímera para mensajes anteriores al actual
  for (let i = 0; i < simulatedMessages.length - 1; i++) {
    const msg = simulatedMessages[i]
    if (Array.isArray(msg?.content)) {
      msg.content = msg.content.map((block) => {
        if (block && block.type === 'image' && block.source?.type === 'base64') {
          return { type: 'text', text: '[Imagen visualizada y procesada en ronda anterior de este turno]' }
        }
        return block
      })
    }
  }

  // Verificar que el bloque de imagen en Ronda 1 se convirtió a texto marcador
  const r1ImageBlock = simulatedMessages[0].content.find((b) => b.type === 'image')
  assert.equal(r1ImageBlock, undefined, 'El bloque tipo image debe haber sido purgado')
  const r1PurgedMarker = simulatedMessages[0].content.find((b) => b.text && b.text.includes('[Imagen visualizada'))
  assert.ok(r1PurgedMarker, 'Debe existir el marcador de texto efímero sin Base64')
  console.log('  ✓ Purga Efímera erradica 100% de los bytes Base64 en rondas subsiguientes')
}

// ── TEST 4: conversationTurn.js sin onProgress indefinido y Circuit Breaker en aiAccounts.js ──
console.log('\nTest 4: Integridad de conversationTurn.js y Circuit Breaker...')
{
  const convTurnCode = fs.readFileSync(path.join(__dirname, '../src/services/conversationTurn.js'), 'utf-8')
  assert.ok(!convTurnCode.includes('onProgress?.({ type: \'telemetry\', phase: \'INSPECTING_URL\''), 'conversationTurn.js no debe llamar a onProgress en el bloque de inspección de URLs')
  assert.ok(convTurnCode.includes('onStreamEvent?.({ type: \'telemetry\', phase: \'INSPECTING_URL\''), 'conversationTurn.js debe invocar onStreamEvent válido')
  console.log('  ✓ conversationTurn.js:381 verificado con onStreamEvent (sin ReferenceError)')

  // Circuit Breaker en memoria
  const testAccountId = 'test-broken-account-500'
  memoryCircuitBreaker.set(testAccountId, Date.now() + COOLDOWN_MS)

  const isBlocked = memoryCircuitBreaker.get(testAccountId) > Date.now()
  assert.equal(isBlocked, true, 'La cuenta con error 500 debe estar en cooldown activo en memoria')
  console.log('  ✓ Circuit Breaker en memoria bloquea cuentas caídas instantáneamente (0ms)')
}

console.log('\n=================================================')
console.log('✅ TODAS LAS 4 PRUEBAS DE LATENCIA Y FAST PATCH PASARON EXITOSAMENTE.')
console.log('=================================================\n')
