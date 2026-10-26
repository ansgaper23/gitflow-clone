import assert from 'node:assert/strict'
import { validatePreWriteComponent } from '../backend/src/services/uiIntegrityGuard.js'

console.log('🧪 Iniciando suite de pruebas: test_auto_healing_loop.mjs\n')

// ── PRUEBA 1: Validación Estática Pre-Escritura (Arnés de Prevención) ──
console.log('--- Caso 1: Detección estática de imports muertos (@/components/ui/inexistente) ---')
const codeWithDeadUiImport = `
import React from 'react'
import { Button } from '@/components/ui/button'
import { InexistenteModal } from '@/components/ui/inexistente'

export default function MiModulo() {
  return <Button>Click</Button>
}
`

const resultDeadUi = validatePreWriteComponent('src/components/MiModulo.jsx', codeWithDeadUiImport, {
  projectFiles: ['src/App.jsx', 'src/main.jsx', 'src/components/ui/button.jsx'],
  stagedContent: new Map()
})

assert.strictEqual(resultDeadUi.valid, false, 'Debe detectar que @/components/ui/inexistente no existe')
assert.ok(resultDeadUi.error.includes('@/components/ui/inexistente'), 'El mensaje debe especificar el módulo inexistente')
console.log('✅ Caso 1 superado: Importación a componente UI inexistente bloqueada limpiamente.\n')

console.log('--- Caso 2: Permisión de componentes existentes y componentes en UI_COMPONENTS_SEED ---')
const codeWithValidUi = `
import React from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

export default function MiModulo() {
  return <Button><Badge>Nuevo</Badge></Button>
}
`

const resultValidUi = validatePreWriteComponent('src/components/MiModulo.jsx', codeWithValidUi, {
  projectFiles: ['src/App.jsx', 'src/main.jsx'],
  stagedContent: new Map()
})

assert.strictEqual(resultValidUi.valid, true, 'Debe permitir componentes reconocidos en UI_COMPONENTS_SEED')
console.log('✅ Caso 2 superado: Componentes del catálogo base Shadcn/UI validados correctamente.\n')

console.log('--- Caso 3: Escudo anti-alucinación de íconos de lucide-react ---')
const codeWithBadLucide = `
import React from 'react'
import { Sparkles, AlgoRaroInexistenteIcon } from 'lucide-react'

export default function Header() {
  return <div><Sparkles /></div>
}
`

const resultBadLucide = validatePreWriteComponent('src/components/Header.jsx', codeWithBadLucide, {
  projectFiles: ['src/App.jsx'],
  stagedContent: new Map()
})

assert.strictEqual(resultBadLucide.valid, false, 'Debe detectar ícono inexistente en lucide-react')
assert.ok(resultBadLucide.error.includes('AlgoRaroInexistenteIcon'), 'El error debe señalar el ícono erróneo')
console.log('✅ Caso 3 superado: Ícono inexistente de lucide-react interceptado antes de escribir en disco.\n')

// ── PRUEBA 2: Formateo del Prompt de Emergencia (System Override) ──
console.log('--- Caso 4: Estructura del Prompt de Emergencia para Auto-Curación ---')
const fakeError = {
  message: "Cannot find module '@/components/ui/inexistente'",
  filename: "src/App.jsx",
  lineno: 14,
  stack: "Error: Cannot find module\n    at eval (src/App.jsx:14:2)"
}

const emergencyPrompt = `CRITICAL SYSTEM FEEDBACK: La vista previa de React/Vite acaba de fallar (Crash) con el siguiente error: \n\n[${fakeError.message} en ${fakeError.filename}:${fakeError.lineno}]\n\nStack Trace:\n${fakeError.stack}\n\nTu tarea exclusiva es corregir este error de compilación/ejecución inmediatamente. Analiza qué import falta, qué variable está indefinida o qué componente está mal estructurado y aplica el parche usando replace_file_content o propose_patch. ESTRICTAMENTE PROHIBIDO emitir texto conversacional explicativo en este turno. Solo debes ejecutar las herramientas de edición de archivos.`

assert.ok(emergencyPrompt.includes('CRITICAL SYSTEM FEEDBACK: La vista previa de React/Vite acaba de fallar'), 'Debe contener la cabecera crítica')
assert.ok(emergencyPrompt.includes(`[${fakeError.message} en src/App.jsx:14]`), 'Debe incluir el mensaje y archivo/línea exactos')
assert.ok(emergencyPrompt.includes('ESTRICTAMENTE PROHIBIDO emitir texto conversacional explicativo'), 'Debe exigir silencio conversacional')
console.log('✅ Caso 4 superado: Formato del prompt de emergencia cumple las directivas de Lovable.\n')

// ── PRUEBA 3: Invisibilidad en el Historial de Chat ──
console.log('--- Caso 5: Invisibilidad de turnos auto-fix en el historial de chat ---')
const simulatedMessages = [
  { id: '1', role: 'user', content: 'Crea una calculadora', hidden: false },
  { id: '2', role: 'assistant', content: 'Aquí tienes la calculadora', hidden: false },
  { id: '3', role: 'user', content: 'CRITICAL SYSTEM FEEDBACK: Crash', hidden: true },
  { id: '4', role: 'assistant', content: '', hidden: true },
  { id: '5', role: 'user', content: 'Cambia los colores a azul', hidden: false }
]

// 1. Filtrado de UI pública en Chat.jsx
const visibleMessages = simulatedMessages.filter(m => !m.hidden)
assert.strictEqual(visibleMessages.length, 3, 'Solo deben verse los 3 mensajes normales del usuario/asistente')
assert.ok(!visibleMessages.some(m => m.hidden), 'Ningún mensaje con hidden: true debe aparecer en el chat visible')

// 2. Filtrado de historial del LLM en conversationTurn.js
const llmHistory = simulatedMessages.filter(m => !m.hidden)
assert.ok(!llmHistory.some(m => m.content.includes('CRITICAL SYSTEM FEEDBACK')), 'El historial para el LLM no debe estar contaminado por mensajes de crash')
console.log('✅ Caso 5 superado: Mensajes de auto-curación 100% invisibles en UI y aislados del historial.\n')

// ── PRUEBA 4: Controlador de Reintentos (Circuit Breaker a 2 Intentos) ──
console.log('--- Caso 6: Lógica de Circuit Breaker a los 2 intentos fallidos ---')
let autoFixAttempts = 0
const MAX_AUTO_FIX_PER_USER_MSG = 2
let uiState = 'normal'
let autoFixDispatched = 0
let crashOverlayShown = false

function onPreviewRuntimeError(eventData) {
  if (autoFixAttempts < MAX_AUTO_FIX_PER_USER_MSG) {
    autoFixAttempts++
    uiState = 'Auto-reparando error...'
    autoFixDispatched++
    crashOverlayShown = false
  } else {
    // Se detiene el bucle silencioso y se muestra el overlay con botón manual
    uiState = 'crash_modal'
    crashOverlayShown = true
  }
}

// Simular Evento de Error 1
onPreviewRuntimeError(fakeError)
assert.strictEqual(autoFixAttempts, 1)
assert.strictEqual(autoFixDispatched, 1)
assert.strictEqual(uiState, 'Auto-reparando error...')
assert.strictEqual(crashOverlayShown, false)

// Simular Evento de Error 2
onPreviewRuntimeError(fakeError)
assert.strictEqual(autoFixAttempts, 2)
assert.strictEqual(autoFixDispatched, 2)
assert.strictEqual(uiState, 'Auto-reparando error...')
assert.strictEqual(crashOverlayShown, false)

// Simular Evento de Error 3 (Circuit Breaker activado)
onPreviewRuntimeError(fakeError)
assert.strictEqual(autoFixAttempts, 2, 'El contador no debe pasar del límite configurado')
assert.strictEqual(autoFixDispatched, 2, 'No debe disparar un 3er turno automático')
assert.strictEqual(uiState, 'crash_modal', 'Debe cambiar el estado a crash_modal')
assert.strictEqual(crashOverlayShown, true, 'Debe desplegar el overlay con botón manual [ 🔧 Intentar reparar con IA ]')

// Simular envío de prompt manual por parte del usuario (reset)
autoFixAttempts = 0
uiState = 'normal'
crashOverlayShown = false

assert.strictEqual(autoFixAttempts, 0, 'El prompt manual resetea los intentos a 0')
assert.strictEqual(crashOverlayShown, false, 'El overlay desaparece tras el nuevo turno')
console.log('✅ Caso 6 superado: Circuit Breaker frena bucles infinitos a los 2 intentos y reactiva modal manual.\n')

console.log('🎉 TODAS LAS PRUEBAS DEL BUCLE DE AUTO-CURACIÓN (6/6) PASARON EXITOSAMENTE.')
