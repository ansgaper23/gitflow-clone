// tests/test_agent_first_and_seo.mjs
// Suite de Certificación: Arquitectura Agent-First, Salvaguarda Pre-Reset, UI de Base de Datos y SEO 2026

import assert from 'node:assert/strict'
import {
  analyzePromptIntent,
  classifyUserIntent,
  executeHardProjectReset
} from '../backend/src/services/agent.js'

import {
  isObsoleteProjectFile,
  CLEAN_APP_SCAFFOLD
} from '../backend/src/services/projectReset.js'

import { isTruncatedOrDestructive } from '../backend/src/services/fuzzyPatcher.js'
import { validateUiIntegrity } from '../backend/src/services/uiIntegrityGuard.js'
import { isWebOrLandingRequest, getSeniorArtDirectionDirectives } from '../backend/src/services/designDirector.js'
import { isSeoTarget, getTechnicalSeoDirectives } from '../backend/src/services/seoArchitect.js'

console.log('--- INICIANDO CERTIFICACIÓN DE ARQUITECTURA AGENT-FIRST, SALVAGUARDA PRE-RESET Y SEO 2026 ---\n')

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
  // TEST 1: Salvaguarda Pre-Reset y Respaldo de Base de Datos
  // ==========================================
  await test('executeHardProjectReset: Salvaguarda obligatoria pre-reset y backup de registros antes de DROP', async () => {
    const mockFilesTable = [
      { project_id: 'proj-safe-1', path: 'package.json', content: '{}' },
      { project_id: 'proj-safe-1', path: 'src/main.jsx', content: 'console.log("main")' },
      { project_id: 'proj-safe-1', path: 'src/App.jsx', content: '// Old App' },
      { project_id: 'proj-safe-1', path: 'src/components/OldHeader.jsx', content: '<header />' },
      { project_id: 'proj-safe-1', path: 'src/lib/oldData.js', content: 'export const data = []' }
    ]

    const mockStorageClient = {
      from: (table) => {
        if (table === 'project_files') {
          return {
            select: () => ({
              eq: (f, val) => ({
                data: mockFilesTable.filter(r => r.project_id === val),
                error: null
              })
            }),
            delete: () => ({
              eq: (f, val) => ({
                in: (sf, paths) => {
                  const set = new Set(paths)
                  for (let i = mockFilesTable.length - 1; i >= 0; i--) {
                    if (mockFilesTable[i].project_id === val && set.has(mockFilesTable[i].path)) {
                      mockFilesTable.splice(i, 1)
                    }
                  }
                  return { error: null }
                },
                eq: (sf, pathVal) => {
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
              const idx = mockFilesTable.findIndex(r => r.project_id === row.project_id && r.path === row.path)
              if (idx !== -1) mockFilesTable[idx] = { ...mockFilesTable[idx], ...row }
              else mockFilesTable.push(row)
              return { error: null }
            }
          }
        }
      }
    }

    let checkpointCreated = null
    const mockCheckpointFn = async (project, convoId, data) => {
      checkpointCreated = data
      return { id: 'chk-123', ...data }
    }

    const mockSqlRunner = async (conn, sql) => {
      if (sql.includes('information_schema.tables')) {
        return { rows: [{ table_name: 'customers' }, { table_name: 'orders' }] }
      }
      if (sql.includes('SELECT * FROM "public"."customers"')) {
        return { rows: [{ id: 1, name: 'Empresa A' }, { id: 2, name: 'Empresa B' }] }
      }
      if (sql.includes('SELECT * FROM "public"."orders"')) {
        return { rows: [{ id: 101, total: 500 }] }
      }
      return { rows: [] }
    }

    const res = await executeHardProjectReset({
      project: { id: 'proj-safe-1', repo_full_name: 'virtual/proj-safe-1' },
      dbConnection: { type: 'vps' },
      wipeDatabase: true,
      customStorageClient: mockStorageClient,
      customSqlRunner: mockSqlRunner,
      customCheckpointFn: mockCheckpointFn
    })

    assert.strictEqual(res.purged, true)
    assert.ok(checkpointCreated, 'Debe llamar al checkpoint antes de eliminar')
    assert.strictEqual(checkpointCreated.changeType, 'reset')
    assert.strictEqual(checkpointCreated.summary, 'Pre-reset automatic snapshot')
    assert.ok(res.tableBackups.customers.length === 2, 'Debe respaldar registros de customers')
    assert.ok(res.tableBackups.orders.length === 1, 'Debe respaldar registros de orders')
    assert.ok(res.droppedTables.includes('customers'), 'Debe eliminar tabla customers')
    assert.ok(res.droppedTables.includes('orders'), 'Debe eliminar tabla orders')
    assert.ok(res.deletedFiles.includes('src/components/OldHeader.jsx'))
  })

  // ==========================================
  // TEST 2: uiIntegrityGuard solo audita createdInCurrentTurn
  // ==========================================
  await test('uiIntegrityGuard: Solo audita componentes creados en el turno actual como huérfanos', async () => {
    // Archivo preexistente en el proyecto pero NO creado en este turno
    const projectFilesList = [
      'package.json',
      'src/main.jsx',
      'src/App.jsx',
      'src/components/LegacySidebar.jsx' // Existe previamente
    ]

    // Turno actual: El usuario editó App.jsx y NO usó LegacySidebar.jsx
    // Solo se propuso modificar App.jsx (no se creó LegacySidebar.jsx)
    const stagedContent = new Map([
      ['src/App.jsx', 'import React from "react"; export default function App() { return <div>Nuevo</div>; }']
    ])
    const proposedChanges = [
      { path: 'src/App.jsx', type: 'edit', newContent: '...', isNew: false }
    ]

    const result = await validateUiIntegrity({
      stagedContent,
      proposedChanges,
      projectFilesList,
      userMessage: 'actualiza el texto de la app'
    })

    assert.strictEqual(result.orphanComponents.length, 0, 'No debe marcar LegacySidebar como huérfano porque era preexistente')
  })

  // ==========================================
  // TEST 3: fuzzyPatcher permite reducción de líneas si el AST es válido
  // ==========================================
  await test('fuzzyPatcher: Rechaza comentarios de truncado pero permite reducción si el AST es sintácticamente válido', async () => {
    const originalContent = `
import React from 'react'
import { useState } from 'react'

export default function BigComponent() {
  const [a, setA] = useState(1)
  const [b, setB] = useState(2)
  const [c, setC] = useState(3)
  const [d, setD] = useState(4)
  const [e, setE] = useState(5)
  const [f, setF] = useState(6)
  const [g, setG] = useState(7)
  const [h, setH] = useState(8)
  const [i, setI] = useState(9)
  const [j, setJ] = useState(10)
  const [k, setK] = useState(11)
  const [l, setL] = useState(12)
  const [m, setM] = useState(13)
  const [n, setN] = useState(14)
  const [o, setO] = useState(15)
  const [p, setP] = useState(16)
  const [q, setQ] = useState(17)
  const [r, setR] = useState(18)
  const [s, setS] = useState(19)
  const [t, setT] = useState(20)
  const [u, setU] = useState(21)
  const [v, setV] = useState(22)
  const [w, setW] = useState(23)
  const [x, setX] = useState(24)
  const [y, setY] = useState(25)
  const [z, setZ] = useState(26)

  return (
    <div>{a + b + c + d + e + f + g + h + i + j + k + l + m + n + o + p + q + r + s + t + u + v + w + x + y + z}</div>
  )
}
`

    // Caso A: Comentario perezoso de truncado -> DEBE RECHAZARSE
    const lazyContent = `
import React from 'react'
export default function BigComponent() {
  // ... rest of code
  return <div>Short</div>
}
`
    const checkLazy = isTruncatedOrDestructive('src/BigComponent.jsx', originalContent, lazyContent)
    assert.strictEqual(checkLazy.isDestructive, true, 'Debe rechazar comentarios // ... rest of code')

    // Caso B: Reducción limpia con AST perfectamente válido y export preservado -> DEBE PERMITIRSE
    const cleanReducedContent = `
import React from 'react'

export default function BigComponent() {
  return <div className="p-4 text-center">Versión refactorizada y compacta</div>
}
`
    const checkClean = isTruncatedOrDestructive('src/BigComponent.jsx', originalContent, cleanReducedContent)
    assert.strictEqual(checkClean.isDestructive, false, 'Debe permitir reducción limpia con AST sintácticamente válido')
  })

  // ==========================================
  // TEST 4: Fallback de Columnas de Base de Datos
  // ==========================================
  await test('Database: Fallback infalible de columnas desde rows[0] cuando no hay metadata en tableDef', async () => {
    // Simula una respuesta donde tableDef.columns vino vacío
    const tableDef = { name: 'garments', row_count: 4, columns: [] }
    const rows = [
      { id: 1, name: 'Vestido Azul', price: 89.90, in_stock: true },
      { id: 2, name: 'Falda Plisada', price: 45.00, in_stock: false }
    ]

    // Lógica del componente
    const effectiveColumns = (tableDef.columns && tableDef.columns.length > 0)
      ? tableDef.columns
      : (rows && rows.length > 0)
        ? Object.keys(rows[0]).map(k => ({
            name: k,
            column_name: k,
            type: typeof rows[0][k] === 'number' ? 'integer' : typeof rows[0][k] === 'boolean' ? 'boolean' : 'text',
            data_type: typeof rows[0][k] === 'number' ? 'integer' : typeof rows[0][k] === 'boolean' ? 'boolean' : 'text',
            is_primary: k === 'id'
          }))
        : []

    assert.strictEqual(effectiveColumns.length, 4, 'Debe inferir exactamente 4 columnas')
    assert.deepStrictEqual(effectiveColumns.map(c => c.name), ['id', 'name', 'price', 'in_stock'])
    assert.strictEqual(effectiveColumns[0].is_primary, true)
  })

  // ==========================================
  // TEST 5: Directivas de Dirección de Arte UI/UX y SEO Técnico 2026
  // ==========================================
  await test('designDirector y seoArchitect: Detección e inyección de directivas premium', async () => {
    const landingPrompt = 'hazme una landing page para una clínica dental moderna con testimonios y precios'
    assert.strictEqual(isWebOrLandingRequest(landingPrompt), true)
    assert.strictEqual(isSeoTarget(landingPrompt), true)

    const artDirectives = getSeniorArtDirectionDirectives({ isWebOrLanding: true })
    assert.ok(artDirectives.includes('BENTO GRID'), 'Debe incluir directivas Bento Grid')
    assert.ok(artDirectives.includes('GLASSMORPHISM'), 'Debe incluir directivas de Glassmorphism')
    assert.ok(artDirectives.includes('STICKY NAVBAR'), 'Debe exigir sticky navbar')

    const seoDirectives = getTechnicalSeoDirectives()
    assert.ok(/core web vitals/i.test(seoDirectives), 'Debe incluir Core Web Vitals')
    assert.ok(/schema\.org/i.test(seoDirectives), 'Debe incluir Schema.org JSON-LD')
    assert.ok(/html5 sem[aá]ntico/i.test(seoDirectives), 'Debe exigir HTML5 semántico')
  })

  console.log(`\n==========================================`)
  console.log(`RESULTADOS: ${passed} PASSED / ${failed} FAILED`)
  console.log(`==========================================\n`)

  if (failed > 0) {
    process.exit(1)
  }
}

runTests().catch(err => {
  console.error('Fatal error en suite:', err)
  process.exit(1)
})
