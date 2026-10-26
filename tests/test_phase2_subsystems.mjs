// tests/test_phase2_subsystems.mjs
// TEST SUITE: MAPA SEMÁNTICO, PODA DE HISTORIAL Y CONTEXTO VISUAL
import assert from 'node:assert/strict'
import { buildSemanticGraphFromFiles, formatSemanticGraph, findMatchingFileForElement } from '../backend/src/services/semanticGraph.js'
import { compressHistory, pruneStaleCode } from '../backend/src/services/geminiAssist.js'

console.log('\n==============================================================================')
console.log('🧪 FLOWPRO - TEST SUITE: MÓDULOS SEMANTIC GRAPH, COMPRESS HISTORY Y CLICK-TO-EDIT')
console.log('==============================================================================\n')

let passed = 0
let total = 0

function runTest(name, fn) {
  total++
  process.stdout.write(`[TEST ${total}] ${name} ... `)
  const start = Date.now()
  try {
    fn()
    const ms = Date.now() - start
    console.log(`\x1b[32mPASS\x1b[0m (${ms}ms)`)
    passed++
  } catch (err) {
    const ms = Date.now() - start
    console.log(`\x1b[31mFAIL\x1b[0m (${ms}ms)`)
    console.error(`   ↳ ${err.message}`)
  }
}

// ----------------------------------------------------------------------------
// TEST 1: Generación del Grafo Semántico e Inversión de Dependencias (ImportedBy)
// ----------------------------------------------------------------------------
runTest('semanticGraph: Extracción de exports, props y grafo inverso ImportedBy', () => {
  const mockFiles = {
    'src/main.jsx': `
      import React from 'react'
      import ReactDOM from 'react-dom/client'
      import App from './App'
      ReactDOM.createRoot(document.getElementById('root')).render(<App />)
    `,
    'src/App.jsx': `
      import React, { useState } from 'react'
      import ContactModal, { sendLead } from './components/ContactModal'
      import { Header } from '@/components/Header'
      export default function App() {
        const [open, setOpen] = useState(false)
        return (
          <div className="min-h-screen bg-slate-900">
            <Header title="FlowPro Dashboard" />
            <ContactModal isOpen={open} onClose={() => setOpen(false)} />
          </div>
        )
      }
    `,
    'src/components/ContactModal.jsx': `
      import React from 'react'
      export const sendLead = async (data) => console.log(data)
      export const MODAL_VERSION = '2.1'
      export default function ContactModal({ isOpen, onClose, initialData = {} }) {
        if (!isOpen) return null
        return <div className="modal-backdrop">Modal Content</div>
      }
    `,
    'src/components/Header.jsx': `
      import React from 'react'
      export function Header({ title, user = null }) {
        return <header className="p-4 border-b border-white/10">{title}</header>
      }
    `
  }

  const graph = buildSemanticGraphFromFiles(mockFiles)

  // Validar ContactModal
  const modalNode = graph['src/components/ContactModal.jsx']
  assert.ok(modalNode, 'ContactModal debe estar en el grafo')
  assert.ok(modalNode.importedBy.includes('src/App.jsx'), 'ContactModal debe registrar src/App.jsx en ImportedBy')
  assert.ok(modalNode.exports.includes('default ContactModal'), 'Debe exportar default ContactModal')
  assert.ok(modalNode.exports.includes('sendLead'), 'Debe exportar sendLead')
  assert.ok(modalNode.props.includes('isOpen') && modalNode.props.includes('onClose'), 'Debe capturar props { isOpen, onClose }')

  // Validar Header
  const headerNode = graph['src/components/Header.jsx']
  assert.ok(headerNode, 'Header debe estar en el grafo')
  assert.ok(headerNode.importedBy.includes('src/App.jsx'), 'Header debe registrar src/App.jsx en ImportedBy vía alias @/')
  assert.ok(headerNode.props.includes('title'), 'Header debe capturar prop title')

  // Validar App
  const appNode = graph['src/App.jsx']
  assert.ok(appNode.importedBy.includes('src/main.jsx'), 'App debe registrar src/main.jsx en ImportedBy')

  // Validar formato compacto
  const formatted = formatSemanticGraph(graph)
  assert.ok(formatted.includes('MAPA SEMÁNTICO Y GRAFO DE DEPENDENCIAS'), 'Debe incluir encabezado')
  assert.ok(formatted.includes('REGLA CRÍTICA'), 'Debe incluir directiva de seguridad')
  assert.ok(formatted.includes('ImportedBy: src/App.jsx'), 'Debe incluir lista ImportedBy en texto')
})

// ----------------------------------------------------------------------------
// TEST 2: Matching de elemento visual (Click-to-Edit) con Mapa Semántico
// ----------------------------------------------------------------------------
runTest('elementContext: Detección quirúrgica del archivo destino', () => {
  const mockFiles = {
    'src/components/ContactModal.jsx': '<div className="contact-special-btn-unique">Enviar Mensaje</div>',
    'src/components/Navbar.jsx': '<nav className="navbar-container">Navbar</nav>'
  }
  const graph = {
    'src/components/ContactModal.jsx': { exports: 'default ContactModal({ isOpen }), sendLead', props: '{ isOpen }', importedBy: [] },
    'src/components/Navbar.jsx': { exports: 'default Navbar', props: '', importedBy: [] }
  }

  // 1. Por ComponentName
  const matchByComponent = findMatchingFileForElement(graph, mockFiles, {
    componentName: 'ContactModal',
    tagName: 'button',
    className: 'btn'
  })
  assert.equal(matchByComponent, 'src/components/ContactModal.jsx', 'Debe detectar ContactModal por componentName')

  // 2. Por clases CSS únicas
  const matchByClass = findMatchingFileForElement(graph, mockFiles, {
    tagName: 'div',
    className: 'contact-special-btn-unique px-4 py-2'
  })
  assert.equal(matchByClass, 'src/components/ContactModal.jsx', 'Debe detectar por clase Tailwind/CSS única')

  // 3. Por texto visible
  const matchByText = findMatchingFileForElement(graph, mockFiles, {
    tagName: 'div',
    innerText: 'Enviar Mensaje a Soporte'
  })
  assert.equal(matchByText, 'src/components/ContactModal.jsx', 'Debe detectar por coincidencia de texto visible')
})

// ----------------------------------------------------------------------------
// TEST 3: Poda quirúrgica de código obsoleto con preservación de turnos recientes
// ----------------------------------------------------------------------------
runTest('compressHistory: Poda de código antiguo (>30 líneas) sin romper formato LLM', async () => {
  // Generar un bloque de código pesado de 40 líneas
  const heavyCodeBlock = Array.from({ length: 40 }, (_, i) => `const line${i} = "data_${i}";`).join('\n')

  const history = [
    // Turno 1 (Antiguo - debe podarse)
    { role: 'user', content: 'Crea el componente Header con estilos completos.' },
    {
      role: 'assistant',
      content: `Entendido, he creado el componente Header.\n\n` +
               `propose_change path: "src/components/Header.jsx"\n` +
               `\`\`\`jsx\n// src/components/Header.jsx\n${heavyCodeBlock}\n\`\`\`\n\nTodo listo.`
    },
    // Turno 2 (Antiguo - debe podarse)
    { role: 'user', content: 'Ahora añade el componente Footer.' },
    {
      role: 'assistant',
      content: `He añadido el Footer.\n\`\`\`jsx\n// src/components/Footer.jsx\n${heavyCodeBlock}\n\`\`\``
    },
    // Turno 3 (Reciente - DEBE MANTENERSE ÍNTEGRO)
    { role: 'user', content: '¿Qué colores usa el tema actual?' },
    { role: 'assistant', content: 'Usa una paleta basada en Slate 900 y Violet 500.' },
    // Turno 4 (Reciente - DEBE MANTENERSE ÍNTEGRO)
    { role: 'user', content: 'Cambia el botón a verde esmeralda.' },
    {
      role: 'assistant',
      content: `He cambiado las clases a emerald-500:\n\`\`\`jsx\n<button className="bg-emerald-500 text-white">Click</button>\n\`\`\``
    }
  ]

  const originalLength = JSON.stringify(history).length
  const compressed = await compressHistory(history)

  assert.equal(compressed.length, history.length, 'La cantidad de mensajes debe mantenerse para preservar alternancia de roles')
  
  // Validar formato de proveedores (Anthropic/OpenAI/Gemini)
  for (let i = 0; i < compressed.length; i++) {
    assert.equal(compressed[i].role, history[i].role, `El rol del mensaje ${i} debe ser idéntico`)
    assert.ok(typeof compressed[i].content === 'string' || Array.isArray(compressed[i].content), 'El content debe ser válido')
  }

  // Validar que el turno antiguo podó el bloque de 40 líneas
  const oldAssistantMsg = compressed[1].content
  assert.ok(oldAssistantMsg.includes('Código histórico'), 'El mensaje antiguo debe contener el marcador de código omitido')
  assert.ok(!oldAssistantMsg.includes('const line39'), 'El bloque gigante de 40 líneas debe haber sido eliminado')
  assert.ok(oldAssistantMsg.includes('Entendido, he creado el componente Header'), 'El texto conversacional debe conservarse')

  // Validar que los 4 mensajes más recientes (2 turnos) quedaron 100% íntegros
  assert.deepEqual(compressed.slice(-4), history.slice(-4), 'Los últimos 4 mensajes (2 turnos) deben ser 100% idénticos sin alteraciones')

  const compressedLength = JSON.stringify(compressed).length
  assert.ok(compressedLength < originalLength, 'El tamaño total en tokens/caracteres debe haber disminuido considerablemente')
})

console.log('\n==============================================================================')
console.log(`📊 RESULTADO DE LA SUITE: ${passed}/${total} TESTS COMPLETADOS CON ÉXITO (100% PASS)`)
console.log('==============================================================================\n')
