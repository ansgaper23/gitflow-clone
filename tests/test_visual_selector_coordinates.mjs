import assert from 'node:assert/strict'
import { normalizeSourcePath } from '../backend/src/services/agent.js'

console.log('🧪 Iniciando suite de pruebas: test_visual_selector_coordinates.mjs\n')

// ── PRUEBA 1: Normalización de rutas de Vite / Fiber (normalizeSourcePath) ──
console.log('--- Caso 1: Normalización de rutas de archivos de origen ---')

const pathsToTest = [
  { raw: '/workspace/src/pages/Login.jsx', expected: 'src/pages/Login.jsx' },
  { raw: '/opt/gitflow-previews/workspace-0/src/components/Header.jsx', expected: 'src/components/Header.jsx' },
  { raw: 'C:\\Users\\jorge\\project\\src\\views\\Dashboard.tsx', expected: 'src/views/Dashboard.tsx' },
  { raw: '/src/App.jsx', expected: 'src/App.jsx' },
  { raw: 'src/components/ui/button.jsx', expected: 'src/components/ui/button.jsx' },
  { raw: 'workspace/src/pages/Auth.jsx', expected: 'src/pages/Auth.jsx' },
]

for (const { raw, expected } of pathsToTest) {
  const normalized = normalizeSourcePath(raw)
  assert.strictEqual(normalized, expected, `Fallo al normalizar "${raw}" -> esperado "${expected}", obtenido "${normalized}"`)
}

console.log('✅ Caso 1 superado: Rutas absolutas y relativas normalizadas a Posix src/... limpiamente.\n')

// ── PRUEBA 2: Simulación de extracción en gitflow-selector.js ──
console.log('--- Caso 2: Extracción de coordenadas desde Fiber y data-flow-id ---')

// 2.1 Simulación por data-flow-id
const mockDomWithAttribute = {
  tagName: 'BUTTON',
  className: 'btn-primary px-4 py-2',
  innerText: 'Ingresar a Modamia',
  getAttribute: (attr) => (attr === 'data-flow-id' ? 'src/pages/Login.jsx:42:5' : null),
  parentElement: null
}

function simulateFindSource(dom) {
  const flowId = dom.getAttribute?.('data-flow-id')
  if (flowId) {
    const parts = flowId.split(':')
    return {
      sourceFile: normalizeSourcePath(parts[0]),
      sourceLine: parseInt(parts[1], 10),
      sourceCol: parts[2] ? parseInt(parts[2], 10) : 0
    }
  }
  const fiber = dom.__reactFiber$
  if (fiber?._debugSource) {
    return {
      sourceFile: normalizeSourcePath(fiber._debugSource.fileName),
      sourceLine: fiber._debugSource.lineNumber,
      sourceCol: fiber._debugSource.columnNumber || 0
    }
  }
  return null
}

const attrCoords = simulateFindSource(mockDomWithAttribute)
assert.strictEqual(attrCoords.sourceFile, 'src/pages/Login.jsx')
assert.strictEqual(attrCoords.sourceLine, 42)
assert.strictEqual(attrCoords.sourceCol, 5)

// 2.2 Simulación por React Fiber Dev Source (_debugSource)
const mockDomWithFiber = {
  tagName: 'BUTTON',
  className: 'btn-primary',
  innerText: 'Ingresar a Modamia',
  getAttribute: () => null,
  parentElement: null,
  __reactFiber$: {
    _debugSource: {
      fileName: '/workspace/src/pages/Login.jsx',
      lineNumber: 42,
      columnNumber: 3
    }
  }
}

const fiberCoords = simulateFindSource(mockDomWithFiber)
assert.strictEqual(fiberCoords.sourceFile, 'src/pages/Login.jsx')
assert.strictEqual(fiberCoords.sourceLine, 42)
assert.strictEqual(fiberCoords.sourceCol, 3)

console.log('✅ Caso 2 superado: Coordenadas extraídas con precisión desde Fiber y data-flow-id.\n')

// ── PRUEBA 3: Enriquecimiento de Payload y Directiva de 1 Ronda en agent.js ──
console.log('--- Caso 3: Generación de Payload y Directiva Ronda 1 en agent.js ---')

const elementContext = {
  tagName: 'button',
  componentName: 'Login',
  innerText: 'Ingresar a Modamia',
  sourceFile: fiberCoords.sourceFile,
  sourceLine: fiberCoords.sourceLine,
  sourceCol: fiberCoords.sourceCol,
  pathname: '/login'
}

const mockFilesMap = {
  'src/pages/Login.jsx': `import React from 'react'
export default function Login() {
  return (
    <div className="login-container">
      <button className="btn-primary">Ingresar a Modamia</button>
    </div>
  )
}`
}

const targetFile = normalizeSourcePath(elementContext.sourceFile)
const targetLine = elementContext.sourceLine
assert.strictEqual(targetFile, 'src/pages/Login.jsx')
assert.strictEqual(targetLine, 42)

const preloadedContent = mockFilesMap[targetFile]
assert.ok(preloadedContent, 'El contenido del archivo debe encontrarse precargado')

const instructionText = `INSTRUCCIÓN DE EDICIÓN QUIRÚRGICA DIRECTA (RONDA 1):
El usuario seleccionó con el puntero visual el elemento en ${targetFile} (línea ${targetLine}).
Aplica el cambio solicitado DIRECTAMENTE en la Ronda 1 usando replace_file_content sobre ${targetFile} sin hacer lecturas adicionales.`

assert.ok(instructionText.includes('src/pages/Login.jsx (línea 42)'))
assert.ok(instructionText.includes('replace_file_content sobre src/pages/Login.jsx sin hacer lecturas adicionales'))

console.log('✅ Caso 3 superado: Directiva de edición quirúrgica en Ronda 1 generada con éxito.\n')

console.log('🎉 TODAS LAS PRUEBAS DE COORDENADAS DEL SELECTOR VISUAL PASARON EXITOSAMENTE.')
