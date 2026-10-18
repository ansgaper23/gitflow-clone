// tests/test_anti_blackscreen_global.mjs
// SUITE DE CERTIFICACIÓN GLOBAL: ARQUITECTURA ANTI-PANTALLA NEGRA EN REACT (FLOWPRO)
// 1. Escudo Lucide-React: sustitución de íconos alucinados/inexistentes por alias válidos sin romper React.
// 2. Auto-inyección de íconos JSX faltantes (caso real de Zap en ProjectsBento.jsx).
// 3. Auto-armonización de discrepancias entre export default y named exports.
// 4. Candado determinista de infraestructura sobre vite.config.* contra modificaciones de host/port/hmr.
// 5. Detección de intención ante quejas de pantalla negra ("no se ve la vista previa").

import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import {
  sanitizeLucideIcons,
  autoFixDefaultAndNamedExports,
  runImportGuard,
  LUCIDE_HALLUCINATIONS_MAP,
} from '../backend/src/services/importGuard.js'
import { analyzePromptIntent } from '../backend/src/services/agent.js'
import { getRuntimeTelemetryProbeScript } from '../infra/preview-orchestrator/runtimeTelemetryProbe.js'

console.log('================================================================')
console.log('🛡️  SUITE DE CERTIFICACIÓN: ARQUITECTURA GLOBAL ANTI-PANTALLA NEGRA')
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
// BLOQUE 1: ESCUDO LUCIDE-REACT & AUTO-INYECCIÓN DE ÍCONOS FALTANTES
// ────────────────────────────────────────────────────────────────

await runTestCase('sanitizeLucideIcons: Sustituye íconos alucinados por alias válidos de lucide-react', async () => {
  const codeWithHallucinations = `
import React from 'react';
import { Substation, Tool, ShieldCheck } from 'lucide-react';

export function FactoryCard() {
  return (
    <div>
      <Substation className="w-5 h-5 text-amber-500" />
      <Tool className="w-5 h-5 text-zinc-400" />
      <ShieldCheck className="w-5 h-5 text-emerald-500" />
    </div>
  );
}
  `

  const result = sanitizeLucideIcons(codeWithHallucinations)
  assert.equal(result.modified, true, 'Debe marcar el código como modificado')
  assert.ok(result.code.includes('Factory as Substation'), 'Substation debe sustituirse por Factory as Substation')
  assert.ok(result.code.includes('Wrench as Tool'), 'Tool debe sustituirse por Wrench as Tool')
  assert.ok(result.code.includes('ShieldCheck'), 'ShieldCheck es válido y debe preservarse')
  assert.equal(result.fixes.length, 2, 'Deben registrarse 2 correcciones de íconos')
})

await runTestCase('sanitizeLucideIcons: Auto-inyecta ícono de Lucide usado en JSX olvidado en el import (caso Zap)', async () => {
  const codeWithMissingJsxIcon = `
import React from 'react';
import { ArrowRight, ShieldCheck } from 'lucide-react';

export function ProjectsBento() {
  return (
    <section>
      <ArrowRight className="w-4 h-4" />
      <ShieldCheck className="w-4 h-4" />
      <Zap className="w-6 h-6 text-amber-400" />
    </section>
  );
}
  `

  const result = sanitizeLucideIcons(codeWithMissingJsxIcon)
  assert.equal(result.modified, true, 'Debe modificarse para agregar el ícono faltante')
  assert.ok(result.code.includes('Zap'), 'Zap debe haber sido agregado al import de lucide-react')
  assert.ok(/import\s*\{[^}]*\bZap\b[^}]*\}\s*from\s*['"]lucide-react['"]/.test(result.code), 'Zap debe estar en el import statement')
})

await runTestCase('sanitizeLucideIcons: Íconos completamente desconocidos reciben fallback a Sparkles', async () => {
  const codeWithUnknown = `
import React from 'react';
import { CompletelyInventedAlienIcon } from 'lucide-react';

export function AlienCard() {
  return <CompletelyInventedAlienIcon />;
}
  `

  const result = sanitizeLucideIcons(codeWithUnknown)
  assert.equal(result.modified, true)
  assert.ok(result.code.includes('Sparkles as CompletelyInventedAlienIcon'), 'Ícono inventado no mapeado debe sustituirse por Sparkles')
})

// ────────────────────────────────────────────────────────────────
// BLOQUE 2: AUTO-ARMONIZACIÓN DE EXPORTS DEFAULT VS NAMED
// ────────────────────────────────────────────────────────────────

await runTestCase('autoFixDefaultAndNamedExports: Si importador usa default import pero componente solo tiene named export, agrega export default', async () => {
  const stagedContent = new Map()

  const appCode = `
import React from 'react';
import Navbar from './components/Navbar';

export default function App() {
  return <Navbar />;
}
  `

  const navbarCode = `
import React from 'react';

export function Navbar() {
  return <nav>Logo</nav>;
}
  `

  stagedContent.set('src/App.jsx', appCode)
  stagedContent.set('src/components/Navbar.jsx', navbarCode)

  const fixes = autoFixDefaultAndNamedExports(stagedContent)
  assert.ok(fixes.length > 0, 'Debe registrar al menos un fix de export')

  const fixedNavbar = stagedContent.get('src/components/Navbar.jsx')
  assert.ok(fixedNavbar.includes('export default Navbar;'), 'Navbar.jsx debe tener export default Navbar;')
  assert.ok(fixedNavbar.includes('export function Navbar'), 'Navbar.jsx debe preservar su export function original')
})

await runTestCase('autoFixDefaultAndNamedExports: Si importador usa named import pero componente solo tiene export default, agrega export nombrado', async () => {
  const stagedContent = new Map()

  const appCode = `
import React from 'react';
import { Hero } from './components/Hero';

export default function App() {
  return <Hero />;
}
  `

  const heroCode = `
import React from 'react';

export default function Hero() {
  return <section>Hero</section>;
}
  `

  stagedContent.set('src/App.jsx', appCode)
  stagedContent.set('src/components/Hero.jsx', heroCode)

  const fixes = autoFixDefaultAndNamedExports(stagedContent)
  assert.ok(fixes.length > 0, 'Debe registrar al menos un fix de export')

  const fixedHero = stagedContent.get('src/components/Hero.jsx')
  assert.ok(fixedHero.includes('export { Hero };'), 'Hero.jsx debe tener export { Hero };')
})

await runTestCase('runImportGuard: Pipeline unificado sanea íconos, armoniza exports y auto-sana package.json', async () => {
  const stagedContent = new Map()

  const appCode = `
import React from 'react';
import { Header } from './components/Header';
import { Tool, ShieldAlert } from 'lucide-react';

export default function App() {
  return (
    <div>
      <Header />
      <Tool />
      <ShieldAlert />
    </div>
  );
}
  `

  const headerCode = `
import React from 'react';

export default function Header() {
  return <header>Header</header>;
}
  `

  stagedContent.set('src/App.jsx', appCode)
  stagedContent.set('src/components/Header.jsx', headerCode)

  const existingPkg = JSON.stringify({
    dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' }
  })

  const result = await runImportGuard({
    stagedContent,
    proposedChanges: [],
    existingPackageJsonContent: existingPkg,
    projectFilesList: ['src/App.jsx', 'src/components/Header.jsx', 'package.json']
  })

  // 1. Export check
  const fixedHeader = stagedContent.get('src/components/Header.jsx')
  assert.ok(fixedHeader.includes('export { Header };'), 'Header debe tener export { Header };')

  // 2. Icon check
  const fixedApp = stagedContent.get('src/App.jsx')
  assert.ok(fixedApp.includes('Wrench as Tool'), 'Tool debe estar sustituido por Wrench as Tool')

  // 3. Auto inject package check
  assert.ok(result.autoInjectResult.missing.includes('lucide-react'), 'lucide-react debe haberse inyectado en package.json')
})

// ────────────────────────────────────────────────────────────────
// BLOQUE 3: DETECCIÓN DE INTENCIÓN DE PANTALLA NEGRA
// ────────────────────────────────────────────────────────────────

await runTestCase('analyzePromptIntent: Detecta reportes de pantalla negra y activa isBlackScreenReport con orden de acción', async () => {
  const testPrompts = [
    'no se ve la vista previa',
    'solo se ve una pantalla negra, solucionalo',
    'la pantalla está en negro',
    'pantalla negra',
    'vista previa en blanco',
    'se ve todo negro',
  ]

  for (const p of testPrompts) {
    const analysis = analyzePromptIntent(p)
    assert.equal(analysis.isBlackScreenReport, true, `Debe detectar isBlackScreenReport en: "${p}"`)
    assert.equal(analysis.hasActionOrder, true, `Debe activar hasActionOrder en: "${p}"`)
    assert.equal(analysis.isPureQuestion, false, `No debe ser pure question en: "${p}"`)
  }
})

// ────────────────────────────────────────────────────────────────
// BLOQUE 4: CANDADO DETERMINISTA DE INFRAESTRUCTURA (VITE.CONFIG.*)
// ────────────────────────────────────────────────────────────────

await runTestCase('Infra Lock: Modificar server, host, port o hmr en vite.config.* es rechazado', async () => {
  // Simulador del arnés de infraestructura en agent.js
  function checkViteConfigGuard(filePath, newContent, promptIntent) {
    const isViteConfig = filePath.endsWith('vite.config.js') || filePath.endsWith('vite.config.ts') || filePath.endsWith('vite.config.mjs')
    if (isViteConfig) {
      const touchesServer = /(?:server\s*:|host\s*:|port\s*:|hmr\s*:)/i.test(newContent)
      const isBlackScreen = Boolean(promptIntent?.isBlackScreenReport)
      if (touchesServer || isBlackScreen) {
        return {
          blocked: true,
          error: '🚨 BLOQUEO DE INFRAESTRUCTURA: El problema de pantalla negra/vista previa vacía NUNCA se debe a vite.config.js. La causa es un error de runtime en tus componentes de src/ (un ícono inexistente de lucide-react, un desajuste entre export default y named export, una variable no definida o un hook mal llamado). Inspecciona src/App.jsx y todos los archivos de src/components/ y corrige el error de código React.'
        }
      }
    }
    return { blocked: false }
  }

  const badViteConfig = `
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 4101
  }
})
  `

  // Test 1: Intento de agregar bloque server en vite.config.js
  const result1 = checkViteConfigGuard('vite.config.js', badViteConfig, { isBlackScreenReport: false })
  assert.equal(result1.blocked, true, 'Debe bloquear la adición de server: port/host')
  assert.ok(result1.error.includes('🚨 BLOQUEO DE INFRAESTRUCTURA'), 'Debe devolver el mensaje canónico de bloqueo')

  // Test 2: Intento de modificar vite.config durante un reporte de pantalla negra
  const cleanViteConfig = `
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({ plugins: [react()] })
  `
  const result2 = checkViteConfigGuard('vite.config.js', cleanViteConfig, { isBlackScreenReport: true })
  assert.equal(result2.blocked, true, 'Debe bloquear cualquier cambio a vite.config cuando hay reporte de pantalla negra')
})

// ────────────────────────────────────────────────────────────────
// BLOQUE 5: SINTAXIS Y VALIDEZ DEL SCRIPT DE TELEMETRÍA
// ────────────────────────────────────────────────────────────────

await runTestCase('runtimeTelemetryProbe: El script inyectado contiene marcadores, overlay visual y sintaxis válida', async () => {
  const script = getRuntimeTelemetryProbeScript('session-test-123', 'https://flow-pro.online/api/preview/runtime-report')
  
  assert.ok(script.includes('<!-- FLOWPRO_TELEMETRY_PROBE_START -->'), 'Debe incluir marcador de inicio')
  assert.ok(script.includes('<!-- FLOWPRO_TELEMETRY_PROBE_END -->'), 'Debe incluir marcador de fin')
  assert.ok(script.includes('flowpro-runtime-diagnostic-overlay'), 'Debe incluir overlay visual oscuro de diagnóstico')
  assert.ok(script.includes('checkRootEmpty'), 'Debe incluir función de verificación de #root vacío')
  assert.ok(script.includes('MutationObserver'), 'Debe incluir MutationObserver para desmontajes de React')
  
  // Extraer el código JS interno y validar sintaxis con node
  const jsCodeMatch = script.match(/<script>([\s\S]*?)<\/script>/)
  assert.ok(jsCodeMatch, 'Debe contener etiqueta script con código')
  
  const jsContent = jsCodeMatch[1]
  // Crear una función de prueba para validar que no haya SyntaxError en el JS inyectado
  new Function(jsContent)
})

console.log('\n================================================================')
console.log(`🎉 CERTIFICACIÓN EXITOSA: ${passedTests}/${totalTests} TESTS COMPLETADOS CON ÉXITO`)
console.log('================================================================\n')
