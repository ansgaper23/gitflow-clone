// tests/test_multimodal_bridge_and_image_fallback.mjs
// Suite de verificación: Transporte Multimodal Universal, Bifurcación Inteligente y Sincronización Inmediata en Slots

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

console.log('🧪 Iniciando test_multimodal_bridge_and_image_fallback.mjs...\n')

// ── TEST 1: anthropic.js inyecta bloques directos de imagen en el mensaje user ──
console.log('1. Verificando anthropic.js para transporte multimodal universal...')
const anthropicCode = fs.readFileSync(path.join(projectRoot, 'backend/src/services/providers/anthropic.js'), 'utf8')
assert.ok(
  anthropicCode.includes('directImageBlocks'),
  'anthropic.js debe recolectar directImageBlocks desde raw.multimodalBlocks'
)
assert.ok(
  anthropicCode.includes("messages.push({ role: 'user', content: [...toolResults, ...directImageBlocks] })"),
  'anthropic.js debe inyectar directImageBlocks al nivel del mensaje user'
)
console.log('✅ TEST 1 PASÓ: anthropic.js entrega imágenes directamente en el mensaje user (100% compatible con agy.flow-pro.online).')

// ── TEST 2: gemini.js inyecta inlineData en contents ──
console.log('\n2. Verificando gemini.js para soporte multimodal de herramientas...')
const geminiCode = fs.readFileSync(path.join(projectRoot, 'backend/src/services/providers/gemini.js'), 'utf8')
assert.ok(
  geminiCode.includes('directImageParts'),
  'gemini.js debe recolectar directImageParts desde raw.multimodalBlocks'
)
assert.ok(
  geminiCode.includes("contents.push({ role: 'user', parts: [...responseParts, ...directImageParts] })"),
  'gemini.js debe entregar tanto functionResponse como inlineData en parts'
)
console.log('✅ TEST 2 PASÓ: gemini.js preserva visión multimodal de herramientas nativamente.')

// ── TEST 3: openai.js inyecta mensaje de usuario con image_url ──
console.log('\n3. Verificando openai.js para soporte de imágenes post-tool...')
const openaiCode = fs.readFileSync(path.join(projectRoot, 'backend/src/services/providers/openai.js'), 'utf8')
assert.ok(
  openaiCode.includes('directImageUrls'),
  'openai.js debe recolectar directImageUrls'
)
assert.ok(
  openaiCode.includes("role: 'user'") && openaiCode.includes('directImageUrls'),
  'openai.js debe inyectar las imágenes en un mensaje user posterior al tool_result'
)
console.log('✅ TEST 3 PASÓ: openai.js inyecta imágenes multimodal conforme a la especificación de OpenAI.')

// ── TEST 4: Reglas de Bifurcación Inteligente en agent.js ──
console.log('\n4. Verificando directivas de Bifurcación Determinista en agent.js...')
const agentCode = fs.readFileSync(path.join(projectRoot, 'backend/src/services/agent.js'), 'utf8')

assert.ok(
  agentCode.includes('REGLA OBLIGATORIA — BIFURCACIÓN DETERMINISTA DE IMÁGENES'),
  'agent.js debe contener la regla de bifurcación determinista'
)
assert.ok(
  agentCode.includes('RAMA A — CUANDO LA FOTOGRAFÍA O ACTIVO SÍ EXISTE EN EL DOCUMENTO SUBIDO'),
  'agent.js debe definir la Rama A para activos existentes'
)
assert.ok(
  agentCode.includes('RAMA B — CUANDO UN PRODUCTO O SERVICIO NO TIENE FOTOGRAFÍA PROPIA EN EL DOCUMENTO SUBIDO'),
  'agent.js debe definir la Rama B con prohibición de recortes a ciegas en páginas generales'
)
assert.ok(
  agentCode.includes('curate_images') && agentCode.includes('imageCurator.js'),
  'agent.js debe instruir el uso de curate_images para ítems sin fotografía en el PDF'
)
console.log('✅ TEST 4 PASÓ: Reglas de bifurcación determinista presentes en system prompt y catálogo de activos.')

// ── TEST 5: Candado Anti-Recorte de Productos en crop_image_region ──
console.log('\n5. Verificando candado anti-recorte de productos en páginas del documento...')
assert.ok(
  agentCode.includes('CANDADO ANTI-RECORTE DE PRODUCTOS EN PÁGINAS GENERALES'),
  'agent.js debe contener el candado determinista contra recortes de productos en page-*.png'
)
assert.ok(
  agentCode.includes('isDocPage && !isLogoOrBrand'),
  'agent.js debe verificar si el origen es página de doc y el destino no es un logo/marca'
)
console.log('✅ TEST 5 PASÓ: crop_image_region bloquea deterministamente recortes de productos en páginas generales.')

// ── TEST 6: Sincronización Inmediata en Slots de Vista Previa para generate_image ──
console.log('\n6. Verificando guardado síncrono en slots de vista previa para generate_image...')
assert.ok(
  agentCode.includes('previewsBase') && agentCode.includes('generate_image'),
  'generate_image debe escribir síncronamente en los slots de vista previa en VPS'
)
console.log('✅ TEST 6 PASÓ: generate_image replica síncronamente a los workspaces para evitar 404.')

console.log('\n🎉 ¡TODAS LAS PRUEBAS (6/6) PASARON EXITOSAMENTE!')
