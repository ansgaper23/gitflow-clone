// tests/test_phase6_cognitive_and_ui_guard.mjs
// CERTIFICACIÓN DE LA FASE 6: AMPLIFICACIÓN COGNITIVA, EJECUCIÓN FULL-STACK Y GUARDIÁN DE INTEGRIDAD UI
// Valida:
// 1. Detección de componentes huérfanos recién creados en uiIntegrityGuard.js
// 2. Detección de botones mudos (dead buttons) en uiIntegrityGuard.js
// 3. Exclusión inteligente de falsos positivos (triggers Radix asChild, type=submit, onClick)
// 4. Amplificación cognitiva de prompts simples en promptAmplifier.js (KPIs, CRUD, toolbar, empty states)
// 5. Preservación de cirugía focalizada ante Click-to-Edit y elementContext
// 6. Ley Full-Stack Real y Blueprints empresariales en el contrato de agent.js

import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const srcDir = fs.existsSync(path.resolve(__dirname, '../backend/src'))
  ? path.resolve(__dirname, '../backend/src')
  : path.resolve(__dirname, '../src')

const toUrl = (p) => pathToFileURL(p).href

const { amplifyPrompt, isSurgicalEdit, isModuleOrAppCreation } = await import(toUrl(path.join(srcDir, 'services/promptAmplifier.js')))
const { validateUiIntegrity, scanDeadButtons, isEntrypointStillScaffold, inspectEntrypointScaffold, buildReachabilityGraph } = await import(toUrl(path.join(srcDir, 'services/uiIntegrityGuard.js')))

console.log('\n' + '='.repeat(78))
console.log('🛡️  FLOWPRO - SUITE DE CERTIFICACIÓN FASE 6: COGNITIVE AMPLIFIER & UI GUARD')
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

// -------------------------------------------------------------
// SECCIÓN 1: Detección de Componentes Huérfanos (uiIntegrityGuard)
// -------------------------------------------------------------

await runTest('uiIntegrityGuard: detecta componente huérfano recién creado (src/components/VentasModal.jsx no importado en App.jsx)', async () => {
  const stagedContent = new Map([
    ['src/components/VentasModal.jsx', `
      import React from 'react';
      export default function VentasModal({ isOpen, onClose }) {
        if (!isOpen) return null;
        return <div className="modal"><h3>Registrar Venta</h3></div>;
      }
    `],
    ['src/App.jsx', `
      import React from 'react';
      export default function App() {
        return <div className="app"><h1>Sistema Principal</h1></div>;
      }
    `]
  ])

  const result = await validateUiIntegrity({
    stagedContent,
    proposedChanges: [{ type: 'create', path: 'src/components/VentasModal.jsx' }],
    projectFilesList: ['src/App.jsx']
  })

  assert.equal(result.valid, false, 'El resultado debe ser inválido por componente huérfano')
  assert.equal(result.orphanComponents.length, 1, 'Debe detectar exactamente 1 componente huérfano')
  assert.equal(result.orphanComponents[0], 'src/components/VentasModal.jsx')
  assert.ok(result.errors.some(e => e.includes('COMPONENTE HUÉRFANO DETECTADO') && e.includes('src/components/VentasModal.jsx')))
  return 'Componente huérfano identificado y alertado con advertencia explícita'
})

await runTest('uiIntegrityGuard: aprueba componente cuando SÍ está importado y renderizado en App.jsx', async () => {
  const stagedContent = new Map([
    ['src/components/VentasModal.jsx', `
      import React from 'react';
      export default function VentasModal() {
        return <div>Ventas Modal</div>;
      }
    `],
    ['src/App.jsx', `
      import React, { useState } from 'react';
      import VentasModal from './components/VentasModal';
      export default function App() {
        return (
          <div>
            <VentasModal />
          </div>
        );
      }
    `]
  ])

  const result = await validateUiIntegrity({
    stagedContent,
    proposedChanges: [{ type: 'create', path: 'src/components/VentasModal.jsx' }],
    projectFilesList: ['src/App.jsx']
  })

  assert.equal(result.valid, true, 'El resultado debe ser válido cuando el componente está importado')
  assert.equal(result.orphanComponents.length, 0)
  return 'Componente conectado verificado exitosamente'
})

// -------------------------------------------------------------
// SECCIÓN 2: Detección de Botones Mudos (Dead Buttons)
// -------------------------------------------------------------

await runTest('uiIntegrityGuard: detecta botón mudo sin onClick ni type="submit"', async () => {
  const code = `
    export default function Formulario() {
      return (
        <div className="card">
          <input type="text" placeholder="Nombre" />
          <button className="px-4 py-2 bg-blue-600 text-white rounded">Guardar</button>
        </div>
      );
    }
  `
  const dead = scanDeadButtons('src/components/Formulario.jsx', code)
  assert.equal(dead.length, 1, 'Debe detectar 1 botón mudo')
  assert.equal(dead[0].label, 'Guardar')

  const stagedContent = new Map([['src/components/Formulario.jsx', code]])
  const result = await validateUiIntegrity({ stagedContent })
  assert.equal(result.valid, false)
  assert.ok(result.errors.some(e => e.includes('BOTÓN MUDO DETECTADO') && e.includes('Guardar')))
  return 'Botón mudo con texto "Guardar" detectado'
})

await runTest('uiIntegrityGuard: aprueba botones interactivos con onClick o type="submit"', async () => {
  const code = `
    export default function Acciones() {
      const handleSave = () => console.log('saving');
      return (
        <div>
          <button type="submit" className="btn-primary">Enviar Formulario</button>
          <button onClick={handleSave} className="btn-secondary">Guardar Borrador</button>
          <button onClick={() => alert('ok')}>Cancelar</button>
        </div>
      );
    }
  `
  const dead = scanDeadButtons('src/components/Acciones.jsx', code)
  assert.equal(dead.length, 0, 'No debe detectar botones mudos cuando tienen handler o submit')
  return '3 botones con handlers y submit validados como interactivos'
})

await runTest('uiIntegrityGuard: aprueba botones envueltos en triggers Radix/shadcn (asChild)', async () => {
  const code = `
    export default function Header() {
      return (
        <DialogTrigger asChild>
          <button className="btn-novo">+ Nuevo Cliente</button>
        </DialogTrigger>
      );
    }
  `
  const dead = scanDeadButtons('src/components/Header.jsx', code)
  assert.equal(dead.length, 0, 'No debe flaggear triggers de Radix con asChild')
  return 'Trigger DialogTrigger asChild reconocido como interactivo'
})

// -------------------------------------------------------------
// SECCIÓN 3: Amplificador Cognitivo de Prompts (promptAmplifier)
// -------------------------------------------------------------

await runTest('promptAmplifier: amplifica prompt corto de creación de módulo ("hazme un control de gastos")', async () => {
  const userMsg = 'hazme un control de gastos'
  assert.equal(isModuleOrAppCreation(userMsg), true)
  assert.equal(isSurgicalEdit(userMsg), false)

  const amp = amplifyPrompt(userMsg, { turnMode: 'BUILD', hasDatabase: true })
  assert.equal(amp.isAmplified, true)
  assert.equal(amp.scope, 'FULL_MODULE')
  assert.ok(amp.amplifiedDirectives.includes('CABECERA CON KPIS Y MÉTRICAS EN VIVO'))
  assert.ok(amp.amplifiedDirectives.includes('BARRA DE HERRAMIENTAS Y CONTROL'))
  assert.ok(amp.amplifiedDirectives.includes('FLUJO CRUD COMPLETO Y ROBUSTO'))
  assert.ok(amp.amplifiedDirectives.includes('ESTADOS VACÍOS PROFESIONALES'))
  assert.ok(amp.amplifiedDirectives.includes('PERSISTENCIA REAL Y AUTOMÁTICA EN BASE DE DATOS'))
  return 'Prompt corto amplificado con arquitectura completa Lovable/Enterprise'
})

await runTest('promptAmplifier: amplifica solicitud de módulo de clientes con reportes', async () => {
  const userMsg = 'agrega un módulo de clientes con reportes'
  const amp = amplifyPrompt(userMsg, { turnMode: 'BUILD', hasDatabase: true })
  assert.equal(amp.isAmplified, true)
  assert.equal(amp.scope, 'FULL_MODULE')
  assert.ok(amp.amplifiedDirectives.includes('AMPLIFICACIÓN COGNITIVA DE PRODUCTO'))
  return 'Solicitud de clientes con reportes amplificada'
})

await runTest('promptAmplifier: NO amplifica solicitudes quirúrgicas (Click-to-Edit)', async () => {
  const surgical1 = 'cambia el color de este botón a azul'
  assert.equal(isSurgicalEdit(surgical1), true)
  const amp1 = amplifyPrompt(surgical1, { turnMode: 'BUILD' })
  assert.equal(amp1.isAmplified, false)
  assert.equal(amp1.scope, 'SURGICAL')
  assert.equal(amp1.amplifiedDirectives, '')

  const surgical2 = 'haz el texto más grande y centrado'
  assert.equal(isSurgicalEdit(surgical2), true)
  const amp2 = amplifyPrompt(surgical2, { turnMode: 'BUILD' })
  assert.equal(amp2.isAmplified, false)
  assert.equal(amp2.scope, 'SURGICAL')

  const amp3 = amplifyPrompt('hazme un sistema de inventario', {
    turnMode: 'BUILD',
    elementContext: { selector: '.hero-btn', tag: 'BUTTON' }
  })
  assert.equal(amp3.isAmplified, false)
  assert.equal(amp3.scope, 'SURGICAL')
  return 'Cirugía focalizada preservada ante instrucciones de estilo e inspector visual'
})

await runTest('promptAmplifier: NO amplifica en modo QUERY ni PLAN', async () => {
  const ampQuery = amplifyPrompt('hazme un sistema de inventario', { turnMode: 'QUERY' })
  assert.equal(ampQuery.isAmplified, false)
  assert.equal(ampQuery.scope, 'NON_BUILD')

  const ampPlan = amplifyPrompt('hazme un sistema de inventario', { turnMode: 'PLAN' })
  assert.equal(ampPlan.isAmplified, false)
  assert.equal(ampPlan.scope, 'NON_BUILD')
  return 'Amplificador restringido estrictamente al modo BUILD'
})

// -------------------------------------------------------------
// SECCIÓN 4: Verificación de Contrato y Directivas en agent.js
// -------------------------------------------------------------

await runTest('agent.js: contiene la Ley de Ejecución Full-Stack Real y Blueprints empresariales', async () => {
  const agentPath = path.join(srcDir, 'services/agent.js')
  const content = fs.readFileSync(agentPath, 'utf-8')

  assert.ok(content.includes('LEY DE EJECUCIÓN FULL-STACK REAL (PROHIBICIÓN TOTAL DE MOCK DATA)'), 'Debe contener la ley full stack')
  assert.ok(content.includes('BLUEPRINTS DE SÚPER-PODERES EMPRESARIALES'), 'Debe contener blueprints empresariales')
  assert.ok(content.includes('DESCARGAR O IMPRIMIR PDF / COTIZACIÓN'), 'Debe incluir blueprint de PDF')
  assert.ok(content.includes('EXPORTAR A EXCEL / CSV'), 'Debe incluir blueprint de CSV/Excel con BOM UTF-8')
  assert.ok(content.includes('GRÁFICOS Y DASHBOARDS'), 'Debe incluir recharts y dashboards')
  assert.ok(content.includes('ENVIAR POR WHATSAPP'), 'Debe incluir WhatsApp con encodeURIComponent')
  assert.ok(content.includes('CERO COMPONENTES HUÉRFANOS'), 'Debe incluir regla de cero huérfanos')
  assert.ok(content.includes('CERO BOTONES MUDOS'), 'Debe incluir regla de cero botones mudos')
  assert.ok(content.includes('validateUiIntegrity'), 'Debe invocar validateUiIntegrity en el verification loop')
  assert.ok(content.includes('amplifyPrompt'), 'Debe invocar amplifyPrompt en la construcción del systemPrompt')
  return 'Todas las directivas arquitectónicas certificadas en el código fuente de agent.js'
})

// -------------------------------------------------------------
// SECCIÓN 5: Compatibilidad con Colores Tailwind y Desactivación de "Aviso de Calidad UI"
// -------------------------------------------------------------

await runTest('uiIntegrityGuard: aprueba componentes con paleta Tailwind estándar y estilos de gráficos sin restricciones', async () => {
  const code = `
    import React from 'react';
    import { BarChart, Bar, Tooltip, ResponsiveContainer } from 'recharts';

    export default function GastosDashboard() {
      const data = [{ name: 'Enero', total: 1200 }, { name: 'Febrero', total: 1900 }];
      const handleExport = () => alert('exporting');
      return (
        <div className="min-h-screen bg-slate-900 text-white p-6">
          <header className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-bold text-emerald-400">Control de Gastos e Insumos</h1>
            <button onClick={handleExport} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg font-medium shadow-md">
              Descargar en Excel
            </button>
          </header>
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data}>
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f8fafc' }} />
                <Bar dataKey="total" fill="#10b981" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      );
    }
  `
  const stagedContent = new Map([
    ['src/components/GastosDashboard.jsx', code],
    ['src/App.jsx', `
      import React from 'react';
      import GastosDashboard from './components/GastosDashboard';
      export default function App() {
        return <GastosDashboard />;
      }
    `]
  ])

  const result = await validateUiIntegrity({
    stagedContent,
    proposedChanges: [{ type: 'create', path: 'src/components/GastosDashboard.jsx' }],
    projectFilesList: ['src/App.jsx']
  })

  assert.equal(result.valid, true, 'El componente con colores Tailwind y Tooltip de recharts debe ser 100% válido')
  assert.equal(result.errors.length, 0)
  return 'Componente con bg-slate-900, text-emerald-400, bg-emerald-600 y tooltips validado sin alertas'
})

await runTest('agent.js: garantiza ausencia total del bloqueador "Aviso de Calidad UI"', async () => {
  const agentPath = path.join(srcDir, 'services/agent.js')
  const content = fs.readFileSync(agentPath, 'utf-8')

  assert.equal(content.includes('Aviso de Calidad UI'), false, 'agent.js NO debe contener ningún Aviso de Calidad UI ni bucle de rechazo estático de colores')
  assert.equal(content.includes('standards/design-tokens'), false)
  return 'Bloqueador destructivo "Aviso de Calidad UI" completamente erradicado de agent.js'
})

await runTest('agent.js: Kickoff Turno 1 exige reemplazo obligatorio de src/App.jsx contra scaffolds vacíos', async () => {
  const agentPath = path.join(srcDir, 'services/agent.js')
  const content = fs.readFileSync(agentPath, 'utf-8')

  assert.ok(content.includes('REEMPLAZO OBLIGATORIO DE LA PLANTILLA INICIAL (src/App.jsx)'), 'Debe incluir la directiva de reemplazo obligatorio de App.jsx')
  assert.ok(content.includes('NUNCA dejes la plantilla inicial con títulos placeholder'), 'Debe prohibir dejar scaffolds vacíos')
  return 'Directiva de reemplazo de plantilla inicial certificada en kickoffSection'
})

await runTest('uiIntegrityGuard: isEntrypointStillScaffold detecta con precisión la plantilla inicial vacía', async () => {
  const scaffoldCode = `
    export default function App() {
      return (
        <div className="flex min-h-screen items-center justify-center px-4 text-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">mi-sistema</h1>
            <p className="mt-3 text-white/60">
              Este proyecto se está construyendo. Pídele a la IA lo que necesites en el chat.
            </p>
          </div>
        </div>
      )
    }
  `
  assert.equal(isEntrypointStillScaffold(scaffoldCode), true, 'Debe detectar la plantilla scaffold estándar')
  assert.equal(isEntrypointStillScaffold('export default function App() { return <div><h1>Hola</h1></div> }'), true, 'Debe detectar placeholder básico sin imports locales ni interactividad')
  assert.equal(isEntrypointStillScaffold(''), true, 'Contenido vacío debe ser tratado como scaffold')
  return 'Plantillas scaffold vacías identificadas con 100% de precisión'
})

await runTest('uiIntegrityGuard: isEntrypointStillScaffold aprueba App.jsx con componentes locales o estado interactivo', async () => {
  const appWithImports = `
    import React from 'react';
    import Dashboard from './components/Dashboard';
    export default function App() {
      return <Dashboard />;
    }
  `
  const appWithState = `
    import React, { useState } from 'react';
    export default function App() {
      const [data, setData] = useState([]);
      return <div className="p-4"><button onClick={() => setData([1])}>Cargar</button></div>;
    }
  `
  assert.equal(isEntrypointStillScaffold(appWithImports), false, 'App.jsx que importa componentes locales NO es scaffold')
  assert.equal(isEntrypointStillScaffold(appWithState), false, 'App.jsx con estado y handlers NO es scaffold')
  return 'Entrypoints funcionales validados sin falsos positivos'
})

await runTest('uiIntegrityGuard: inspectEntrypointScaffold combina stagedContent y archivos del proyecto', async () => {
  const scaffoldCode = `export default function App() { return <p>Este proyecto se está construyendo...</p>; }`
  const inspected = await inspectEntrypointScaffold({
    stagedContent: new Map([['src/components/Table.jsx', 'export default function Table() {}']]),
    projectFilesList: ['src/App.jsx'],
    readProjectFile: async () => scaffoldCode
  })

  assert.equal(inspected.isScaffold, true, 'Debe detectar que el proyecto aún contiene el scaffold original sin sobrescribir')
  assert.equal(inspected.entryPath, 'src/App.jsx')
  return 'Inspección de entrypoint combinada (staged + VFS) certificada'
})

await runTest('uiIntegrityGuard: bloquea con ERROR ESTRUCTURAL si se crean tablas o componentes y App.jsx sigue siendo scaffold', async () => {
  const scaffoldCode = `export default function App() { return <h1>mi-app</h1>; }`
  const stagedContent = new Map([
    ['src/components/GastosTable.jsx', `
      import React from 'react';
      export default function GastosTable() {
        return <table className="w-full"><tbody><tr><td>Gasto 1</td></tr></tbody></table>;
      }
    `]
  ])

  const result = await validateUiIntegrity({
    stagedContent,
    proposedChanges: [{ type: 'create', path: 'src/components/GastosTable.jsx' }],
    proposedDbChanges: [{ sql: 'CREATE TABLE gastos (id uuid PRIMARY KEY);' }],
    projectFilesList: ['src/App.jsx'],
    readProjectFile: async () => scaffoldCode
  })

  assert.equal(result.valid, false, 'Debe bloquear el turno si App.jsx sigue en scaffold')
  assert.ok(result.errors.some(e => e.includes('ERROR ESTRUCTURAL') && e.includes('src/App.jsx')), 'Debe emitir el error estructural explícito exigiendo actualizar App.jsx')
  return 'Bloqueo preventivo de scaffold vacío verificado'
})

await runTest('uiIntegrityGuard: Reachability Graph valida alcance transitivo (App.jsx -> Dashboard.jsx -> ExpensesTable.jsx)', async () => {
  const stagedContent = new Map([
    ['src/App.jsx', `
      import React from 'react';
      import Dashboard from './pages/Dashboard';
      export default function App() {
        return <Dashboard />;
      }
    `],
    ['src/pages/Dashboard.jsx', `
      import React from 'react';
      import ExpensesTable from '../components/ExpensesTable';
      export default function Dashboard() {
        return (
          <div className="p-6">
            <h1>Panel de Control</h1>
            <ExpensesTable />
          </div>
        );
      }
    `],
    ['src/components/ExpensesTable.jsx', `
      import React from 'react';
      export default function ExpensesTable() {
        return <button onClick={() => alert('ok')}>Descargar</button>;
      }
    `]
  ])

  const result = await validateUiIntegrity({
    stagedContent,
    proposedChanges: [
      { type: 'create', path: 'src/pages/Dashboard.jsx' },
      { type: 'create', path: 'src/components/ExpensesTable.jsx' }
    ],
    projectFilesList: ['src/App.jsx']
  })

  assert.equal(result.valid, true, 'Todos los componentes del árbol transitivo deben ser alcanzables y válidos')
  assert.equal(result.errors.length, 0)
  return 'Grafo de alcance transitivo (BFS) verificado exitosamente'
})

await runTest('uiIntegrityGuard: Reachability Graph excluye primitivas de diseño en src/components/ui/', async () => {
  const stagedContent = new Map([
    ['src/App.jsx', `
      import React from 'react';
      export default function App() {
        return <div className="p-4">App con layout</div>;
      }
    `],
    ['src/components/ui/badge.jsx', `
      import React from 'react';
      export default function Badge({ children }) {
        return <span className="badge">{children}</span>;
      }
    `]
  ])

  const result = await validateUiIntegrity({
    stagedContent,
    proposedChanges: [{ type: 'create', path: 'src/components/ui/badge.jsx' }],
    projectFilesList: ['src/App.jsx']
  })

  assert.equal(result.valid, true, 'Las primitivas de diseño no deben ser forzadas como componentes huérfanos')
  assert.equal(result.orphanComponents.length, 0)
  return 'Exclusión de primitivas ui/ validada'
})

await runTest('providers: implementan presupuesto de iteración independiente (dbBonusRounds) para herramientas SQL', async () => {
  const providerFiles = ['anthropic.js', 'deepseek.js', 'gemini.js', 'openai.js', 'orcarouter.js']
  for (const file of providerFiles) {
    const fullPath = path.join(srcDir, 'services/providers', file)
    const content = fs.readFileSync(fullPath, 'utf-8')
    assert.ok(content.includes('DB_TOOL_NAMES'), `${file} debe definir DB_TOOL_NAMES`)
    assert.ok(content.includes('dbBonusRounds'), `${file} debe manejar dbBonusRounds`)
    assert.ok(content.includes('MAX_ROUNDS + dbBonusRounds'), `${file} debe expandir el presupuesto dinámicamente`)
  }
  return 'Presupuesto dinámico para DB (hasta +10 rondas) certificado en los 5 proveedores'
})

await runTest('conversationTurn.js: sincronización atómica ejecuta BD antes de código y unifica refreshPreview', async () => {
  const convoPath = path.join(srcDir, 'services/conversationTurn.js')
  const content = fs.readFileSync(convoPath, 'utf-8')

  const dbIndex = content.indexOf('applyDbChanges(dbChangesData')
  const codeIndex = content.indexOf('applyCodeChanges(project, user.github_access_token, changesData)')
  const refreshIndex = content.lastIndexOf('refreshPreview(`user:${user.id}`, project)')

  assert.ok(dbIndex > 0 && codeIndex > 0 && refreshIndex > 0, 'Deben existir las 3 fases')
  assert.ok(dbIndex < codeIndex, 'applyDbChanges debe ejecutarse ANTES de applyCodeChanges')
  assert.ok(codeIndex < refreshIndex, 'refreshPreview debe ejecutarse DESPUÉS de aplicar código y base de datos')
  return 'Sincronización atómica BD -> Código -> Preview certificada en conversationTurn.js'
})

console.log('\n' + '='.repeat(78))

console.log(`🏁 RESULTADOS: ${passedTests}/${totalTests} pruebas pasaron exitosamente.`)
console.log('='.repeat(78) + '\n')

if (passedTests !== totalTests) {
  process.exit(1)
}
