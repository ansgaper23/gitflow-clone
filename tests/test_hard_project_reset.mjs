// tests/test_hard_project_reset.mjs
// Suite de certificación del Protocolo Físico de Hard Reset de Proyecto (executeHardProjectReset):
// 1. Detección semántica infalible de órdenes de reinicio y pivote total.
// 2. Identificación precisa de archivos obsoletos a purgar vs plantillas base a preservar.
// 3. Purga física en almacenamiento (project_files), reseteo de App.jsx y eliminación de tablas en BD.
// 4. Bypass de comprobación destructiva (isTruncatedOrDestructive) durante reinicio.
// 5. Blindaje del guardián de interfaz (uiIntegrityGuard) contra componentes antiguos huérfanos.

import assert from 'node:assert/strict'

import {
  analyzePromptIntent,
  executeHardProjectReset
} from '../backend/src/services/agent.js'

import {
  isObsoleteProjectFile,
  CLEAN_APP_SCAFFOLD
} from '../backend/src/services/projectReset.js'

import { isTruncatedOrDestructive } from '../backend/src/services/fuzzyPatcher.js'
import { validateUiIntegrity } from '../backend/src/services/uiIntegrityGuard.js'

console.log('--- INICIANDO CERTIFICACIÓN DE HARD PROJECT RESET ---\n')

async function runTests() {
  let passed = 0
  let failed = 0

  const test = async (name, fn) => {
    try {
      await fn()
      console.log(`✅ [PASS] ${name}`)
      passed++
    } catch (err) {
      console.error(`❌ [FAIL] ${name}:`, err.message)
      failed++
    }
  }

  // ==========================================
  // TEST 1: Detección Semántica de Intención de Reinicio
  // ==========================================
  await test('analyzePromptIntent: Detecta con 100% de precisión órdenes de reinicio total', async () => {
    const prompt1 = 'borra el proyecto actual y haz una web para poder editar archivos pdf y word'
    const intent1 = analyzePromptIntent(prompt1)
    assert.strictEqual(intent1.isProjectResetOrder, true, 'Debe detectar "borra el proyecto actual"')
    assert.strictEqual(intent1.hasActionOrder, true)

    const prompt2 = 'reinicia el proyecto y empieza de cero con un saas de facturas'
    const intent2 = analyzePromptIntent(prompt2)
    assert.strictEqual(intent2.isProjectResetOrder, true, 'Debe detectar "reinicia el proyecto"')

    const prompt3 = 'borra todo y haz un ecommerce de zapatillas'
    const intent3 = analyzePromptIntent(prompt3)
    assert.strictEqual(intent3.isProjectResetOrder, true, 'Debe detectar "borra todo y haz"')

    const prompt4 = 'olvida lo anterior y haz otra cosa'
    const intent4 = analyzePromptIntent(prompt4)
    assert.strictEqual(intent4.isProjectResetOrder, true, 'Debe detectar "olvida lo anterior"')

    // Casos que NO deben ser considerados reinicio total
    const promptNonReset1 = 'borra el botón de cancelar del modal de login'
    const intentNonReset1 = analyzePromptIntent(promptNonReset1)
    assert.strictEqual(intentNonReset1.isProjectResetOrder, false, 'No debe confundir borrar botón con reset')

    const promptNonReset2 = 'elimina la columna teléfono de la tabla usuarios'
    const intentNonReset2 = analyzePromptIntent(promptNonReset2)
    assert.strictEqual(intentNonReset2.isProjectResetOrder, false, 'No debe confundir eliminar columna con reset')
  })

  // ==========================================
  // TEST 2: Clasificación de Archivos Obsoletos vs Archivos Base
  // ==========================================
  await test('isObsoleteProjectFile: Identifica componentes viejos para purga y preserva template base', async () => {
    // Archivos obsoletos que DEBEN ser eliminados físicamente
    assert.strictEqual(isObsoleteProjectFile('src/components/MapfreHeader.jsx'), true)
    assert.strictEqual(isObsoleteProjectFile('src/components/ScrtDocument.jsx'), true)
    assert.strictEqual(isObsoleteProjectFile('src/components/OldComponent.jsx'), true)
    assert.strictEqual(isObsoleteProjectFile('src/pages/Dashboard.jsx'), true)
    assert.strictEqual(isObsoleteProjectFile('src/views/CertificateView.jsx'), true)
    assert.strictEqual(isObsoleteProjectFile('src/lib/pdfHelper.js'), true)
    assert.strictEqual(isObsoleteProjectFile('src/utils/formatters.js'), true)
    assert.strictEqual(isObsoleteProjectFile('src/hooks/useOldCertificates.js'), true)

    // Archivos base que DEBEN ser preservados intactos
    assert.strictEqual(isObsoleteProjectFile('package.json'), false)
    assert.strictEqual(isObsoleteProjectFile('vite.config.js'), false)
    assert.strictEqual(isObsoleteProjectFile('index.html'), false)
    assert.strictEqual(isObsoleteProjectFile('src/main.jsx'), false)
    assert.strictEqual(isObsoleteProjectFile('src/index.css'), false)
    assert.strictEqual(isObsoleteProjectFile('src/App.jsx'), false) // App.jsx se sobrescribe, no se borra
  })

  // ==========================================
  // TEST 3: Ejecución Física de executeHardProjectReset
  // ==========================================
  await test('executeHardProjectReset: Purga archivos en project_files, resetea App.jsx y elimina tablas SQL', async () => {
    // Mock de almacenamiento en memoria simulando la tabla project_files
    const mockFilesTable = [
      { project_id: 'proj-123', path: 'package.json', content: '{}' },
      { project_id: 'proj-123', path: 'index.html', content: '<html />' },
      { project_id: 'proj-123', path: 'src/main.jsx', content: 'console.log("main")' },
      { project_id: 'proj-123', path: 'src/index.css', content: 'body {}' },
      { project_id: 'proj-123', path: 'src/App.jsx', content: '// 500 lineas de Mapfre y SCRT' },
      { project_id: 'proj-123', path: 'src/App.tsx', content: '// Old TSX' },
      { project_id: 'proj-123', path: 'src/components/MapfreHeader.jsx', content: '<header>Mapfre</header>' },
      { project_id: 'proj-123', path: 'src/components/ScrtDocument.jsx', content: '<div>Scrt</div>' },
      { project_id: 'proj-123', path: 'src/lib/oldHelper.js', content: 'export const x = 1' }
    ]

    const mockStorageClient = {
      from: (tableName) => {
        if (tableName === 'project_files') {
          return {
            select: () => ({
              eq: (field, val) => ({
                data: mockFilesTable.filter(f => f.project_id === val),
                error: null
              })
            }),
            delete: () => ({
              eq: (field, val) => ({
                in: (subField, paths) => {
                  const pathsSet = new Set(paths)
                  for (let i = mockFilesTable.length - 1; i >= 0; i--) {
                    if (mockFilesTable[i].project_id === val && pathsSet.has(mockFilesTable[i].path)) {
                      mockFilesTable.splice(i, 1)
                    }
                  }
                  return { error: null }
                },
                eq: (subField, pathVal) => {
                  for (let i = mockFilesTable.length - 1; i >= 0; i--) {
                    if (mockFilesTable[i].project_id === val && mockFilesTable[i].path === pathVal) {
                      mockFilesTable.splice(i, 1)
                    }
                  }
                  return { error: null }
                }
              })
            }),
            upsert: (row) => {
              const existingIdx = mockFilesTable.findIndex(f => f.project_id === row.project_id && f.path === row.path)
              if (existingIdx !== -1) {
                mockFilesTable[existingIdx] = { ...mockFilesTable[existingIdx], ...row }
              } else {
                mockFilesTable.push(row)
              }
              return { error: null }
            }
          }
        }
      }
    }

    // Mock de runner SQL
    const executedSqls = []
    const mockSqlRunner = async (conn, sql) => {
      executedSqls.push(sql)
      if (sql.includes('information_schema.tables')) {
        return {
          rows: [
            { table_name: 'scrt_certificates' },
            { table_name: 'mapfre_policies' }
          ]
        }
      }
      return { rows: [] }
    }

    let schemaCacheInvalidated = false
    const mockInvalidateSchemaCache = () => {
      schemaCacheInvalidated = true
    }

    const resetResult = await executeHardProjectReset({
      project: {
        id: 'proj-123',
        repo_full_name: 'virtual/proj-123'
      },
      dbConnection: { type: 'vps' },
      customStorageClient: mockStorageClient,
      customSqlRunner: mockSqlRunner,
      invalidateSchemaCacheFn: mockInvalidateSchemaCache
    })

    assert.strictEqual(resetResult.purged, true, 'Debe indicar purged: true')
    assert.ok(resetResult.deletedFiles.includes('src/components/MapfreHeader.jsx'), 'Debe eliminar MapfreHeader.jsx')
    assert.ok(resetResult.deletedFiles.includes('src/components/ScrtDocument.jsx'), 'Debe eliminar ScrtDocument.jsx')
    assert.ok(resetResult.deletedFiles.includes('src/lib/oldHelper.js'), 'Debe eliminar oldHelper.js')
    assert.ok(resetResult.droppedTables.includes('scrt_certificates'), 'Debe eliminar tabla scrt_certificates')
    assert.ok(resetResult.droppedTables.includes('mapfre_policies'), 'Debe eliminar tabla mapfre_policies')

    // Verificar estado final de mockFilesTable
    const remainingPaths = mockFilesTable.map(f => f.path)
    assert.ok(remainingPaths.includes('package.json'), 'package.json debe preservarse')
    assert.ok(remainingPaths.includes('index.html'), 'index.html debe preservarse')
    assert.ok(remainingPaths.includes('src/main.jsx'), 'src/main.jsx debe preservarse')
    assert.ok(remainingPaths.includes('src/App.jsx'), 'src/App.jsx debe existir')
    assert.ok(!remainingPaths.includes('src/App.tsx'), 'src/App.tsx debe haber sido purgado')
    assert.ok(!remainingPaths.includes('src/components/MapfreHeader.jsx'), 'MapfreHeader debe estar eliminado')

    // Verificar que src/App.jsx fue reseteado al scaffold limpio
    const resetApp = mockFilesTable.find(f => f.path === 'src/App.jsx')
    assert.strictEqual(resetApp.content, CLEAN_APP_SCAFFOLD)

    // Verificar que los DROP TABLE se ejecutaron con CASCADE
    assert.ok(executedSqls.some(s => s.includes('DROP TABLE IF EXISTS "public"."scrt_certificates" CASCADE;')), 'DROP TABLE scrt_certificates CASCADE')
    assert.ok(executedSqls.some(s => s.includes('DROP TABLE IF EXISTS "public"."mapfre_policies" CASCADE;')), 'DROP TABLE mapfre_policies CASCADE')
    assert.strictEqual(schemaCacheInvalidated, true, 'Debe invalidar caché de esquemas')
  })

  // ==========================================
  // TEST 4: Bypass de Anti-Truncamiento en fuzzyPatcher durante Reset
  // ==========================================
  await test('fuzzyPatcher.isTruncatedOrDestructive: Permite reducir y reemplazar App.jsx cuando isReset: true', async () => {
    const hugeOldApp = `
      import React from 'react'
      import MapfreHeader from './components/MapfreHeader'
      import ScrtDocument from './components/ScrtDocument'
      ${Array.from({ length: 100 }, (_, i) => `// Linea de logica previa ${i}`).join('\n')}
      export default function App() {
        return <div><MapfreHeader /><ScrtDocument /></div>
      }
    `

    const freshNewApp = `
      import React from 'react'
      import PdfEditor from './components/PdfEditor'
      export default function App() {
        return <main><PdfEditor /></main>
      }
    `

    // Sin reset (edición normal): debe bloquear la reducción de líneas
    const normalCheck = isTruncatedOrDestructive('src/App.jsx', hugeOldApp, freshNewApp, { isReset: false })
    assert.strictEqual(normalCheck.isDestructive, true, 'Sin isReset debe bloquear reducción drástica')

    // Con isReset: true: debe permitir la reducción y reconstrucción desde cero
    const resetCheck = isTruncatedOrDestructive('src/App.jsx', hugeOldApp, freshNewApp, { isReset: true })
    assert.strictEqual(resetCheck.isDestructive, false, 'Con isReset debe autorizar el reemplazo total')

    // Pero si contiene marcadores explícitos de código truncado ("// ... rest"), aún con isReset debe bloquear
    const truncatedWithMarkers = `
      import React from 'react'
      // ... rest of code
      export default function App() { return <div /> }
    `
    const markerCheck = isTruncatedOrDestructive('src/App.jsx', hugeOldApp, truncatedWithMarkers, { isReset: true })
    assert.strictEqual(markerCheck.isDestructive, true, 'Incluso con isReset, los marcadores // ... rest deben bloquearse')
  })

  // ==========================================
  // TEST 5: uiIntegrityGuard NO sabotea ni exige componentes viejos durante Reset
  // ==========================================
  await test('uiIntegrityGuard: No exige componentes viejos como huérfanos cuando isProjectResetOrder: true', async () => {
    const staged = new Map()
    // El LLM crea la nueva aplicación de edición de PDF/Word
    staged.set('src/App.jsx', `
      import React from 'react'
      import DocumentEditor from './components/DocumentEditor'
      export default function App() {
        return (
          <main className="p-8">
            <header><nav>Document Studio</nav></header>
            <section><DocumentEditor /></section>
          </main>
        )
      }
    `)
    staged.set('src/components/DocumentEditor.jsx', `
      import React from 'react'
      export default function DocumentEditor() {
        return <button onClick={() => alert('Cargar')}>Cargar PDF</button>
      }
    `)

    // Simular que en projectFilesList aún figuraban componentes viejos de una llamada previa
    const projectFilesListWithOld = [
      'package.json',
      'src/main.jsx',
      'src/App.jsx',
      'src/components/MapfreHeader.jsx',
      'src/components/ScrtDocument.jsx'
    ]

    const result = await validateUiIntegrity({
      stagedContent: staged,
      proposedChanges: [
        { type: 'modify', path: 'src/App.jsx' },
        { type: 'create', path: 'src/components/DocumentEditor.jsx' }
      ],
      projectFilesList: projectFilesListWithOld,
      userMessage: 'borra el proyecto actual y haz una web para poder editar archivos pdf y word',
      isProjectResetOrder: true
    })

    assert.strictEqual(result.valid, true, 'Debe ser válido sin bloquear el guardado')
    assert.strictEqual(result.errors.length, 0, 'No debe haber errores de componentes huérfanos')
    assert.strictEqual(result.orphanComponents.length, 0, 'No debe exigir importar MapfreHeader ni ScrtDocument')
  })

  console.log(`\n========================================`)
  console.log(`RESULTADOS CERTIFICACIÓN HARD RESET:`)
  console.log(`Pruebas superadas: ${passed}`)
  console.log(`Pruebas fallidas:  ${failed}`)
  console.log(`========================================\n`)

  if (failed > 0) {
    process.exit(1)
  }
}

runTests().catch(err => {
  console.error('Error fatal ejecutando suite Hard Reset:', err)
  process.exit(1)
})
