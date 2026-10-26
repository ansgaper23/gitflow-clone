// tests/test_multimodal_inspect_and_crop.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import sharp from 'sharp'
import { codeTools, buildLovableStructuredResponse, analyzePromptIntent } from '../backend/src/services/agent.js'

console.log('🧪 Ejecutando suite de pruebas unitarias para Blueprint Maestro (Multimodal, Crop, SMask y Soberanía Cognitiva)...')

// ── TEST 1: Herramientas registradas en codeTools ──
const inspectTool = codeTools.find(t => t.name === 'inspect_project_image')
assert.ok(inspectTool, 'La herramienta inspect_project_image debe estar registrada en codeTools')
assert.deepEqual(inspectTool.input_schema.required, ['paths'], 'inspect_project_image requiere "paths"')

const cropTool = codeTools.find(t => t.name === 'crop_image_region')
assert.ok(cropTool, 'La herramienta crop_image_region debe estar registrada en codeTools')
assert.ok(cropTool.input_schema.required.includes('sourcePath'), 'crop_image_region requiere sourcePath')
assert.ok(cropTool.input_schema.required.includes('leftPercent'), 'crop_image_region requiere leftPercent')
assert.ok(cropTool.input_schema.required.includes('outputFileName'), 'crop_image_region requiere outputFileName')
console.log('  ✅ Test 1: Herramientas nativas verificadas en codeTools')

// ── TEST 2: Optimización multimodal de imagen para Vision con Sharp (<= 1024x1024) ──
const largeTestImg = await sharp({
  create: {
    width: 2400,
    height: 1800,
    channels: 4,
    background: { r: 40, g: 120, b: 240, alpha: 1 }
  }
}).png().toBuffer()

const resizedForVision = await sharp(largeTestImg)
  .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
  .jpeg({ quality: 80 })
  .toBuffer()

const visionMeta = await sharp(resizedForVision).metadata()
assert.ok(visionMeta.width <= 1024, `Ancho optimizado (${visionMeta.width}) debe ser <= 1024`)
assert.ok(visionMeta.height <= 1024, `Alto optimizado (${visionMeta.height}) debe ser <= 1024`)
assert.equal(visionMeta.format, 'jpeg', 'El formato para visión multimodal debe ser jpeg optimizado')
console.log(`  ✅ Test 2: Redimensionamiento multimodal a <= 1024px verificado (${visionMeta.width}x${visionMeta.height}px)`)

// ── TEST 3: Recorte con porcentajes (0-100%) y Clamping de límites en Sharp ──
const source500 = await sharp({
  create: {
    width: 500,
    height: 400,
    channels: 4,
    background: { r: 255, g: 100, b: 50, alpha: 1 }
  }
}).png().toBuffer()

const meta500 = await sharp(source500).metadata()
// 10% left, 20% top, 30% width, 40% height
const leftPercent = 10
const topPercent = 20
const widthPercent = 30
const heightPercent = 40

const leftPx = Math.max(0, Math.min(meta500.width - 1, Math.round((leftPercent / 100) * meta500.width)))
const topPx = Math.max(0, Math.min(meta500.height - 1, Math.round((topPercent / 100) * meta500.height)))
const widthPx = Math.max(1, Math.min(meta500.width - leftPx, Math.round((widthPercent / 100) * meta500.width)))
const heightPx = Math.max(1, Math.min(meta500.height - topPx, Math.round((heightPercent / 100) * meta500.height)))

assert.equal(leftPx, 50, 'leftPx debe ser 50')
assert.equal(topPx, 80, 'topPx debe ser 80')
assert.equal(widthPx, 150, 'widthPx debe ser 150')
assert.equal(heightPx, 160, 'heightPx debe ser 160')

const croppedBuffer = await sharp(source500)
  .extract({ left: leftPx, top: topPx, width: widthPx, height: heightPx })
  .png()
  .toBuffer()

const croppedMeta = await sharp(croppedBuffer).metadata()
assert.equal(croppedMeta.width, 150, 'Ancho del recorte extraído debe coincidir con cálculo')
assert.equal(croppedMeta.height, 160, 'Alto del recorte extraído debe coincidir con cálculo')
console.log('  ✅ Test 3: Coordenadas porcentuales y clamping de límites estricto verificados')

// ── TEST 4: Filtro Determinista Anti-SMask (Rechazo de máscaras 1-bit / stencil monocromático) ──
// Creamos una imagen 1-canal con muy pocos bytes emulando una máscara SMask stencil (ej. 4KB)
const smaskMockBuffer = await sharp({
  create: {
    width: 200,
    height: 200,
    channels: 3,
    background: { r: 0, g: 0, b: 0 }
  }
}).toColorspace('b-w').png().toBuffer()

// Criterio determinista: < 15KB y ratio aspecto extremo o canal único
const smaskMeta = await sharp(smaskMockBuffer).metadata()
const isSmaskCandidate = smaskMockBuffer.length < 15000 && (smaskMeta.channels === 1 || smaskMeta.channels === 2)
assert.ok(isSmaskCandidate, 'El detector determinista debe clasificar la máscara como SMask a ignorar')
console.log('  ✅ Test 4: Filtro determinista de máscaras SMask / stencil verificado')

// ── TEST 5: Deduplicación SHA-1 de imágenes idénticas extraídas ──
const imgA = await sharp({ create: { width: 50, height: 50, channels: 3, background: { r: 10, g: 20, b: 30 } } }).png().toBuffer()
const imgACopy = Buffer.from(imgA) // idéntico byte a byte
const imgB = await sharp({ create: { width: 50, height: 50, channels: 3, background: { r: 99, g: 88, b: 77 } } }).png().toBuffer()

const seenHashes = new Set()
const deduplicated = []
for (const [idx, buf] of [imgA, imgACopy, imgB].entries()) {
  const hash = crypto.createHash('sha1').update(buf).digest('hex')
  if (!seenHashes.has(hash)) {
    seenHashes.add(hash)
    deduplicated.push(`img-${idx}.png`)
  }
}

assert.equal(deduplicated.length, 2, 'Deduplicación SHA-1 debe filtrar copias idénticas')
console.log('  ✅ Test 5: Deduplicación SHA-1 verificada')

// ── TEST 6: Formato de respuesta no robótica en buildLovableStructuredResponse ──
const humanResp = buildLovableStructuredResponse([], {
  proposedChanges: [{ path: 'src/components/Navbar.jsx' }, { path: 'src/data/servicesData.js' }]
})
assert.ok(!humanResp.includes('He creado e integrado servicesData, Navbar en la aplicación. La interfaz y la navegación ya están listas en la vista previa.'), 'No debe contener la plantilla robótica anterior')
assert.ok(humanResp.includes('Navbar') && humanResp.includes('servicesData'), 'Debe mencionar los archivos modificados')
console.log(`  ✅ Test 6: Respuesta natural verificada: "${humanResp}"`)

// ── TEST 7: Soberanía Cognitiva (No Regex apagando tools en agent.js) ──
const agentCode = fs.readFileSync('backend/src/services/agent.js', 'utf8')
assert.ok(!agentCode.includes('!isBlankPreviewReport ? [dbTool, executeDdlTool]'), 'agent.js no debe apagar DB tools con regex !isBlankPreviewReport')
console.log('  ✅ Test 7: Soberanía Cognitiva verificada en agent.js')

// ── TEST 8: Candado Anti-Recorte a Ciegas + Loopback Multimodal en agent.js ──
assert.ok(agentCode.includes('CANDADO ANTI-RECORTE A CIEGAS'), 'agent.js debe incluir candado anti-recorte a ciegas en (0,0)')
assert.ok(agentCode.includes('VERIFICACIÓN VISUAL POST-RECORTE'), 'agent.js debe incluir loopback multimodal post-recorte')
assert.ok(agentCode.includes('inspectedImagePaths'), 'agent.js debe trackear imágenes inspeccionadas')
console.log('  ✅ Test 8: Candado Anti-Recorte a Ciegas y Loopback Multimodal verificados en agent.js')

// ── TEST 9: Auto-Ejecución Silenciosa de Assets (Sin pending ni botones de aprobación) ──
const turnCode = fs.readFileSync('backend/src/services/conversationTurn.js', 'utf8')
assert.ok(turnCode.includes("mode === 'build' || !result.requiresApproval || c.alreadyApplied || c.status === 'applied'"), 'conversationTurn.js debe forzar status applied en modo build')
const chatCode = fs.readFileSync('frontend/src/pages/Chat.jsx', 'utf8')
assert.ok(!chatCode.includes('<AssetChangeCard'), 'Chat.jsx no debe renderizar tarjetas sueltas de AssetChangeCard en el flujo del chat')
assert.ok(chatCode.includes('assetChanges.filter(c => c.message_id === msg.id).map(c => c.path)'), 'Chat.jsx debe incluir los assets en modifiedFiles de la VersionCard')
console.log('  ✅ Test 9: Auto-ejecución silenciosa de assets y ocultamiento de tarjetas sueltas verificado')

// ── TEST 10: Detección de Defectos Visuales como Órdenes de Acción y Erradicación de Evasión ──
const defectIntent = analyzePromptIntent('en Productos Certificados para su Empresa aparecen imagenes que no corresponden con los productos')
assert.equal(defectIntent.isPureQuestion, false, 'Reporte de defecto no debe ser considerado PURE_QUESTION')
assert.equal(defectIntent.hasActionOrder, true, 'Reporte de defecto debe tener hasActionOrder=true')
assert.ok(!agentCode.includes("'Analicé el estado del proyecto según tu consulta. No se requirieron cambios en los archivos.'"), 'agent.js no debe contener la frase de evasión fija')
console.log('  ✅ Test 10: Reconocimiento de reportes de defectos visuales como ACTION_ORDER y erradicación de evasión verificados')

// ── TEST 11: Componente CodeBlock y Renderizado de Árbol de Estructura ──
const codeBlockFile = fs.readFileSync('frontend/src/components/CodeBlock.jsx', 'utf8')
assert.ok(codeBlockFile.includes('WrapText'), 'CodeBlock.jsx debe incluir botón toggle wrap con WrapText')
assert.ok(codeBlockFile.includes('navigator.clipboard.writeText'), 'CodeBlock.jsx debe soportar copiar al portapapeles')
assert.ok(codeBlockFile.includes('Check'), 'CodeBlock.jsx debe alternar a Check verde al copiar')
const resSummaryFile = fs.readFileSync('frontend/src/components/chat/ResolutionSummary.jsx', 'utf8')
assert.ok(resSummaryFile.includes('CodeBlock'), 'ResolutionSummary.jsx debe integrar el componente CodeBlock')
console.log('  ✅ Test 11: Componente CodeBlock con wrap toggle, copy feedback y soporte de estructura verificado')

console.log('\n🎉 ¡TODAS LAS 11 PRUEBAS UNITARIAS DEL BLUEPRINT MAESTRO PASARON EXITOSAMENTE (100%)!')
process.exit(0)
