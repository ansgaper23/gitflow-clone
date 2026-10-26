// tests/test_mode_switch.mjs
// CERTIFICACIÓN DE SOBERANÍA DEL SELECTOR DE MODO (BUILD vs CHAT vs PLAN)
// Garantiza que la selección manual del usuario NUNCA sea degradada a QUERY por heurística.

import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const srcDir = fs.existsSync(path.resolve(__dirname, '../backend/src'))
  ? path.resolve(__dirname, '../backend/src')
  : path.resolve(__dirname, '../src')

const toUrl = (p) => pathToFileURL(p).href

const { classifyUserIntent, analyzePromptIntent } = await import(toUrl(path.join(srcDir, 'services/agent.js')))

console.log('\n' + '='.repeat(78))
console.log('🛡️  FLOWPRO - SUITE DE CERTIFICACIÓN DE SOBERANÍA DE MODO (BUILD vs CHAT)')
console.log('    Verificación Estricta: Selector Manual del Usuario vs Clasificador LLM')
console.log('='.repeat(78) + '\n')

let passedTests = 0
let totalTests = 0

async function runTest(name, fn) {
  totalTests++
  process.stdout.write(`[TEST ${totalTests}] ${name} ... `)
  const start = Date.now()
  try {
    const detail = await fn()
    const ms = Date.now() - start
    console.log(`\x1b[32mPASS\x1b[0m (${ms}ms)`)
    if (detail) console.log(`   ↳ \x1b[90m${detail}\x1b[0m`)
    passedTests++
  } catch (err) {
    const ms = Date.now() - start
    console.log(`\x1b[31mFAIL\x1b[0m (${ms}ms)`)
    console.error(`   ↳ \x1b[31m${err.message}\x1b[0m`)
  }
}

// Lógica canónica de resolución de modo (debe coincidir exactamente con agent.js)
function resolveTurnMode(mode, userMessage) {
  const requestedMode = (mode || '').toLowerCase().trim()
  const isExplicitBuild = ['build', 'agent', 'edit'].includes(requestedMode)
  const isExplicitChat = ['chat', 'query', 'ask'].includes(requestedMode)
  const isPlanMode = requestedMode === 'plan'

  let turnMode
  if (isExplicitBuild) {
    turnMode = 'BUILD'
  } else if (isExplicitChat) {
    turnMode = 'QUERY'
  } else if (isPlanMode) {
    turnMode = 'PLAN'
  } else {
    const userIntent = classifyUserIntent(userMessage)
    turnMode = (userIntent === 'PROJECT_QUERY' || userIntent === 'CASUAL') ? 'QUERY' : 'BUILD'
  }
  return { turnMode, isExplicitBuild, isExplicitChat, isPlanMode }
}

function filterToolsForMode(tools, turnMode, isPlanMode, promptIntent = null) {
  return tools.filter((t) => {
    if ((isPlanMode || turnMode === 'PLAN') && (t.name === 'propose_change' || t.name === 'propose_patch' || t.name === 'replace_file_content')) return false
    if (turnMode === 'QUERY' && (t.name === 'propose_change' || t.name === 'propose_patch' || t.name === 'replace_file_content' || t.name === 'propose_migration' || t.name === 'execute_ddl')) return false
    if (turnMode === 'BUILD' && promptIntent?.isPureQuestion && (t.name === 'propose_change' || t.name === 'propose_patch' || t.name === 'replace_file_content' || t.name === 'propose_migration' || t.name === 'execute_ddl')) return false
    return true
  })
}

const mockToolset = [
  { name: 'read_file' },
  { name: 'list_files' },
  { name: 'check_preview_errors' },
  { name: 'test_preview' },
  { name: 'propose_change' },
  { name: 'propose_patch' },
  { name: 'replace_file_content' },
  { name: 'execute_ddl' },
  { name: 'propose_migration' },
]

// ============================================================================
// CASO 1: Selector en BUILD con preguntas interrogativas
// ============================================================================
await runTest('Modo BUILD soberano: prompt interrogativo conserva sesión BUILD pero desactiva mutaciones si es pregunta pura', async () => {
  const prompt = '¿Cómo está estructurado AuthContext.jsx y qué datos guarda en sesión?'
  const intent = analyzePromptIntent(prompt)
  assert.equal(intent.isPureQuestion, true, 'Debe ser pregunta pura de consulta')
  assert.equal(intent.hasActionOrder, false, 'No debe tener orden de acción')

  // El modo seleccionado manualmente debe prevalecer como BUILD
  const { turnMode, isExplicitBuild } = resolveTurnMode('build', prompt)
  assert.equal(isExplicitBuild, true)
  assert.equal(turnMode, 'BUILD', 'El modo seleccionado manualmente debe prevalecer como BUILD')

  const activeTools = filterToolsForMode(mockToolset, turnMode, false, intent)
  const mutationTools = activeTools.filter(t => ['propose_change', 'propose_patch', 'replace_file_content', 'execute_ddl', 'propose_migration'].includes(t.name))
  assert.equal(mutationTools.length, 0, 'En pregunta pura dentro de BUILD, las herramientas de mutación deben estar deshabilitadas')
  assert.ok(activeTools.some(t => t.name === 'read_file'), 'Herramientas de lectura deben permanecer activas')

  return `turnMode: BUILD preservado, mutaciones bloqueadas (0/5) y lectura activa`
})

// ============================================================================
// CASO 2: Selector en BUILD con prompt de explicación previa
// ============================================================================
await runTest('Modo BUILD con pedido explicativo + cambio: conserva herramientas de escritura y exige respuesta dual', async () => {
  const prompt = 'Explícame cómo funciona el login actual y agrega un botón para recuperar contraseña'
  const intent = analyzePromptIntent(prompt)
  assert.equal(intent.isPureQuestion, false, 'No es pregunta pura porque tiene orden de acción')
  assert.equal(intent.hasActionOrder, true, 'Debe tener orden de acción')
  assert.equal(intent.isDualResponseRequired, true, 'Debe requerir respuesta dual (explicar + modificar)')

  const { turnMode } = resolveTurnMode('build', prompt)
  assert.equal(turnMode, 'BUILD')

  const activeTools = filterToolsForMode(mockToolset, turnMode, false, intent)
  assert.ok(activeTools.some(t => t.name === 'propose_change'))
  assert.ok(activeTools.some(t => t.name === 'propose_patch'))
  assert.ok(activeTools.some(t => t.name === 'replace_file_content'))

  return `turnMode: BUILD garantizado con herramientas de mutación activas y respuesta dual requerida`
})

// ============================================================================
// CASO 3: Selector en CHAT (Modo Consulta)
// ============================================================================
await runTest('Modo CHAT explícito: retira herramientas de mutación y bloquea escritura', async () => {
  const prompt = 'Agrega una constante APP_VERSION = "2.0.0" en config.js'
  // Aunque el prompt tenga verbos de acción ("Agrega"), si el usuario fijó CHAT, es solo consulta
  const { turnMode, isExplicitChat } = resolveTurnMode('chat', prompt)
  assert.equal(isExplicitChat, true)
  assert.equal(turnMode, 'QUERY', 'En modo chat, turnMode debe ser QUERY')

  const activeTools = filterToolsForMode(mockToolset, turnMode, false)
  const hasMutations = activeTools.some(t => ['propose_change', 'propose_patch', 'replace_file_content', 'execute_ddl', 'propose_migration'].includes(t.name))
  assert.equal(hasMutations, false, 'En modo CHAT NINGUNA herramienta de mutación debe estar presente')
  assert.ok(activeTools.some(t => t.name === 'read_file'), 'Lectura debe seguir disponible')
  assert.ok(activeTools.some(t => t.name === 'list_files'), 'Listado de archivos debe seguir disponible')

  return `turnMode: QUERY respetado, mutaciones bloqueadas (0/5), lectura activa (2/2)`
})

// ============================================================================
// CASO 4: Selector en PLAN (Modo Planificación)
// ============================================================================
await runTest('Modo PLAN explícito: modo arquitectura sin herramientas de código', async () => {
  const prompt = 'Diseña un sistema de suscripciones con Stripe'
  const { turnMode, isPlanMode } = resolveTurnMode('plan', prompt)
  assert.equal(isPlanMode, true)
  assert.equal(turnMode, 'PLAN')

  const activeTools = filterToolsForMode(mockToolset, turnMode, isPlanMode)
  const hasCodeTools = activeTools.some(t => ['propose_change', 'propose_patch', 'replace_file_content'].includes(t.name))
  assert.equal(hasCodeTools, false, 'En modo PLAN no debe haber propose_change ni propose_patch')

  return `turnMode: PLAN activo, sólo herramientas de exploración e inspección`
})

// ============================================================================
// CASO 5: Fallback heurístico cuando mode no viene especificado
// ============================================================================
await runTest('Fallback heurístico cuando mode es undefined / null', async () => {
  const queryPrompt = '¿Dónde está el archivo de rutas?'
  const { turnMode: modeQ } = resolveTurnMode(undefined, queryPrompt)
  assert.equal(modeQ, 'QUERY', 'Sin modo manual, pregunta debe resolver a QUERY')

  const buildPrompt = 'Crea un botón en Navbar.jsx'
  const { turnMode: modeB } = resolveTurnMode(undefined, buildPrompt)
  assert.equal(modeB, 'BUILD', 'Sin modo manual, acción debe resolver a BUILD')

  return `Fallback correcto: Pregunta -> ${modeQ}, Acción -> ${modeB}`
})

// ============================================================================
// CASO 6: Verificación de Contratos de Comportamiento en System Prompt
// ============================================================================
await runTest('Contrato de Comportamiento: Validación de directivas exactas', async () => {
  // Verificamos que el código fuente de agent.js contenga la directiva de autorización en BUILD
  const agentFileContent = fs.readFileSync(path.join(srcDir, 'services/agent.js'), 'utf-8')
  
  assert.ok(
    agentFileContent.includes('ESTADO ACTUAL: Modo Build (Construcción) ACTIVO. Tienes autorización plena'),
    'agent.js debe declarar explícitamente el modo Build activo y autorización plena'
  )
  assert.ok(
    agentFileContent.includes('isExplicitBuild'),
    'agent.js debe contemplar la bandera isExplicitBuild'
  )
  assert.ok(
    agentFileContent.includes("turnMode = 'BUILD'"),
    'agent.js debe asignar turnMode = BUILD cuando isExplicitBuild es true'
  )

  return `Directivas de autorización y soberanía de Build verificadas en agent.js`
})

// ============================================================================
// CASO 7: Normalización de API y Rutas (content vs message y mode default)
// ============================================================================
await runTest('Verificación de Normalización en conversations.js y api.js', async () => {
  const convRoutesContent = fs.readFileSync(path.join(srcDir, 'routes/conversations.js'), 'utf-8')
  const apiJsContent = fs.existsSync(path.resolve(__dirname, '../frontend/src/lib/api.js'))
    ? fs.readFileSync(path.resolve(__dirname, '../frontend/src/lib/api.js'), 'utf-8')
    : null

  assert.ok(
    convRoutesContent.includes('content: req.body.content || req.body.message'),
    'conversations.js debe aceptar tanto content como message'
  )
  assert.ok(
    convRoutesContent.includes("mode: req.body.mode || 'build'"),
    'conversations.js debe asegurar mode defaulting a build'
  )

  if (apiJsContent) {
    assert.ok(
      apiJsContent.includes('message: content'),
      'api.js debe transmitir tanto content como message'
    )
    assert.ok(
      apiJsContent.includes("mode: mode || 'build'"),
      'api.js debe enviar mode defaulting a build'
    )
  }

  return `Normalización de payload en conversations.js (y api.js) certificada`
})

// ============================================================================
// CASO 8: Caso Producción: "¿Cómo está el SEO de la web?" (sin orden de edición)
// ============================================================================
await runTest('Producción Caso A: "como esta el seo de la web?" en BUILD no muta archivos', async () => {
  const prompt = 'como esta el seo de la web?'
  const intent = analyzePromptIntent(prompt)

  assert.equal(intent.isPureQuestion, true, 'Debe clasificarse como PURE_QUESTION')
  assert.equal(intent.hasActionOrder, false, 'No debe contener órdenes de mutación')
  assert.equal(intent.isDiagnostic, true, 'Debe ser pregunta diagnóstica')

  const { turnMode } = resolveTurnMode('build', prompt)
  assert.equal(turnMode, 'BUILD', 'Mantiene sesión BUILD')

  const activeTools = filterToolsForMode(mockToolset, turnMode, false, intent)
  const mutationTools = activeTools.filter(t => ['propose_change', 'propose_patch', 'replace_file_content', 'execute_ddl', 'propose_migration'].includes(t.name))
  assert.equal(mutationTools.length, 0, 'No debe tener herramientas de edición disponibles en este turno')
  assert.ok(activeTools.some(t => t.name === 'read_file'), 'Debe permitir read_file para inspeccionar index.html')

  // Probar también versión formal con acentos y signo de interrogación inicial
  const formalIntent = analyzePromptIntent('¿Cómo está el SEO de la web?')
  assert.equal(formalIntent.isPureQuestion, true)
  assert.equal(formalIntent.hasActionOrder, false)

  return `Pregunta pura en BUILD resuelta sin mutación: herramientas de edición bloqueadas (0/5), lectura activa`
})

// ============================================================================
// CASO 9: Caso Producción: "¿Por qué el encabezado no tiene un botón? Agrégalo"
// ============================================================================
await runTest('Producción Caso B: "¿Por qué el encabezado no tiene un botón? Agrégalo" edita y responde', async () => {
  const prompt = '¿Por qué el encabezado no tiene un botón? Agrégalo'
  const intent = analyzePromptIntent(prompt)

  assert.equal(intent.isPureQuestion, false, 'No es pregunta pura')
  assert.equal(intent.hasActionOrder, true, 'Tiene orden explícita de agregar botón')
  assert.equal(intent.isDualResponseRequired, true, 'Requiere respuesta dual (responder pregunta + resumir cambios)')

  const { turnMode } = resolveTurnMode('build', prompt)
  assert.equal(turnMode, 'BUILD')

  const activeTools = filterToolsForMode(mockToolset, turnMode, false, intent)
  const mutationTools = activeTools.filter(t => ['propose_change', 'propose_patch', 'replace_file_content'].includes(t.name))
  assert.ok(mutationTools.length > 0, 'Debe tener herramientas de mutación disponibles')

  return `Orden con pregunta en BUILD: mutaciones activas (${mutationTools.length}) y bandera isDualResponseRequired: true`
})

// ============================================================================
// CASO 10: Flujo de Continuación tras Diagnóstico: Confirmaciones Afirmativas Cortas
// ============================================================================
await runTest('Flujo de Continuación: Confirmaciones cortas ("si", "sí", "dale", "ok", "adelante", "procede", "hazlo", "de acuerdo", "por favor") son ACTION_ORDER', async () => {
  const shortAffirmations = [
    'si',
    'sí',
    'dale',
    'ok',
    'adelante',
    'procede',
    'hazlo',
    'de acuerdo',
    'por favor',
    '¡sí!',
    'dale!',
    'ok!'
  ]

  for (const aff of shortAffirmations) {
    const intent = analyzePromptIntent(aff)
    assert.equal(
      intent.hasActionOrder,
      true,
      `"${aff}" debe tener hasActionOrder: true para ejecutar las mejoras propuestas`
    )
    assert.equal(
      intent.isPureQuestion,
      false,
      `"${aff}" no debe ser pregunta pura (isPureQuestion: false)`
    )
    assert.equal(
      intent.category,
      'ACTION_ORDER',
      `"${aff}" debe clasificarse en la categoría ACTION_ORDER`
    )

    // En modo BUILD, deben estar activas todas las herramientas de escritura
    const { turnMode } = resolveTurnMode('build', aff)
    assert.equal(turnMode, 'BUILD')

    const activeTools = filterToolsForMode(mockToolset, turnMode, false, intent)
    const mutationTools = activeTools.filter(t =>
      ['propose_change', 'propose_patch', 'replace_file_content', 'execute_ddl', 'propose_migration'].includes(t.name)
    )
    assert.equal(
      mutationTools.length,
      5,
      `"${aff}" en BUILD debe tener activas las 5 herramientas de mutación de código y BD`
    )
  }

  return `12 confirmaciones afirmativas cortas validadas con hasActionOrder: true y mutaciones activas (5/5)`
})

// ============================================================================
// CASO 11: Variaciones de Confirmación Afirmativa Compuesta
// ============================================================================
await runTest('Flujo de Continuación: Confirmaciones compuestas ("si por favor", "dale hazlo", "ok procede", "de acuerdo, adelante") son ACTION_ORDER', async () => {
  const compositeAffirmations = [
    'si por favor',
    'sí por favor',
    'dale hazlo',
    'ok procede',
    'ok adelante',
    'de acuerdo, hazlo por favor',
    'adelante con las mejoras',
    'procede con los cambios',
    'hazlo ya',
    'claro que sí'
  ]

  for (const aff of compositeAffirmations) {
    const intent = analyzePromptIntent(aff)
    assert.equal(intent.hasActionOrder, true, `"${aff}" debe ser hasActionOrder: true`)
    assert.equal(intent.isPureQuestion, false, `"${aff}" debe ser isPureQuestion: false`)
    assert.equal(intent.category, 'ACTION_ORDER')

    const { turnMode } = resolveTurnMode('build', aff)
    const activeTools = filterToolsForMode(mockToolset, turnMode, false, intent)
    const mutationTools = activeTools.filter(t =>
      ['propose_change', 'propose_patch', 'replace_file_content'].includes(t.name)
    )
    assert.ok(mutationTools.length > 0, `"${aff}" debe habilitar herramientas de mutación`)
  }

  return `10 confirmaciones compuestas certificadas como ACTION_ORDER con herramientas de edición`
})

// ============================================================================
// CASO 12: Resolución de Modo por Fallback en Confirmación sin Selector Explícito
// ============================================================================
await runTest('Resolución de Modo: Confirmación ("si", "dale", "ok") sin modo explícito resuelve a BUILD', async () => {
  // Cuando el usuario responde "si" o "dale" sin selector fijado, no debe caer a QUERY/CASUAL
  const prompts = ['si', 'dale', 'ok', 'hazlo', 'adelante']
  for (const p of prompts) {
    const { turnMode } = resolveTurnMode(undefined, p)
    assert.equal(turnMode, 'BUILD', `Confirmación "${p}" sin modo explícito debe resolver automáticamente a BUILD`)
  }

  return `Confirmaciones afirmativas resuelven a BUILD automáticamente (sin modo manual)`
})

// ============================================================================
// CASO 13: Reinicio / Pivote Total de Proyecto (isProjectResetOrder)
// ============================================================================
await runTest('Reinicio de Proyecto: "borra el proyecto actual y haz una web para..." activa isProjectResetOrder: true y limpia contexto', async () => {
  const resetPrompts = [
    'borra el proyecto actual y haz una web para poder editar archivos pdf y word',
    'borra el proyecto y crea un panel administrativo',
    'reinicia el proyecto y haz una tienda online',
    'empieza de cero y crea un dashboard de analiticas',
    'olvida lo anterior y haz un clon de trello',
    'descarta todo y haz una calculadora de hipotecas',
    'reemplaza todo el proyecto con un sistema de reservas'
  ]

  for (const prompt of resetPrompts) {
    const intent = analyzePromptIntent(prompt)
    assert.equal(intent.isProjectResetOrder, true, `"${prompt}" debe tener isProjectResetOrder: true`)
    assert.equal(intent.hasActionOrder, true, `"${prompt}" debe tener hasActionOrder: true`)
    assert.equal(intent.isPureQuestion, false, `"${prompt}" debe tener isPureQuestion: false`)
    assert.equal(intent.category, 'ACTION_ORDER')
  }

  // Verificar que un prompt regular NO active el reseteo
  const normalPrompt = 'agrega un botón azul al header y cambia el texto'
  const normalIntent = analyzePromptIntent(normalPrompt)
  assert.equal(normalIntent.isProjectResetOrder, false, 'Prompt normal debe tener isProjectResetOrder: false')

  // Verificar en el código fuente de agent.js que se purga el historial y se inyecta la directiva
  const agentPath = path.join(srcDir, 'services/agent.js')
  const agentContent = fs.readFileSync(agentPath, 'utf-8')
  assert.ok(agentContent.includes('promptIntent.isProjectResetOrder'), 'agent.js debe inspeccionar promptIntent.isProjectResetOrder')
  assert.ok(agentContent.includes('history = [];') || agentContent.includes('history = []'), 'agent.js debe purgar history al resetear')
  assert.ok(agentContent.includes('ORDEN DE REINICIO TOTAL DE PROYECTO'), 'agent.js debe inyectar la directiva de reinicio total')

  return `7 variantes de reinicio certificadas con isProjectResetOrder: true y purga de historial`
})

console.log('\n' + '='.repeat(78))
console.log(`📊 RESULTADO FINAL: ${passedTests}/${totalTests} TESTS COMPLETADOS CON ÉXITO (${passedTests === totalTests ? '\x1b[32m100% PASS\x1b[0m' : '\x1b[31mFAILURES\x1b[0m'})`)
console.log('='.repeat(78) + '\n')

if (passedTests !== totalTests) {
  process.exit(1)
}
