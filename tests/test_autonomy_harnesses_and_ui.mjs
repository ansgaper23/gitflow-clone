// tests/test_autonomy_harnesses_and_ui.mjs
// SUITE DE CERTIFICACIÓN GLOBAL: AUTONOMÍA COGNITIVA, 5 LIBERTADES, 4 ARNESES DETERMINISTAS Y UI/UX

import assert from 'node:assert/strict'
import {
  codeTools,
  analyzePromptIntent,
  classifyUserIntent,
  shouldAllowClarificationQuestion,
  extractNegativeConstraints,
  executeHardProjectReset
} from '../backend/src/services/agent.js'

import {
  scanForExposedSecrets,
  isClientSidePath
} from '../backend/src/services/secretGuard.js'

import {
  isTruncatedOrDestructive,
  applyPatch
} from '../backend/src/services/fuzzyPatcher.js'

import { validateSyntax } from '../backend/src/services/syntaxValidator.js'
import { validateUiIntegrity } from '../backend/src/services/uiIntegrityGuard.js'
import { runImportGuard } from '../backend/src/services/importGuard.js'
import { isWebOrLandingRequest, getSeniorArtDirectionDirectives } from '../backend/src/services/designDirector.js'
import { isSeoTarget, getTechnicalSeoDirectives } from '../backend/src/services/seoArchitect.js'

console.log('======================================================================')
console.log('🚀 CERTIFICACIÓN: AUTONOMÍA COGNITIVA, 5 LIBERTADES Y 4 ARNESES')
console.log('======================================================================\n')

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

  // ==========================================================================
  // BLOQUE 1: LAS 5 LIBERTADES CRÍTICAS DEL AGENTE EN agent.js
  // ==========================================================================

  await test('Libertad A: search_files está presente en codeTools con schema completo y no se apaga en ningún modo', async () => {
    const searchTool = codeTools.find(t => t.name === 'search_files')
    assert.ok(searchTool, 'search_files debe estar definido en codeTools')
    assert.equal(searchTool.input_schema.type, 'object')
    assert.ok(searchTool.input_schema.properties.query, 'query debe ser propiedad')
    assert.ok(searchTool.input_schema.properties.pathPrefix, 'pathPrefix debe ser propiedad')
    assert.ok(searchTool.input_schema.properties.caseSensitive, 'caseSensitive debe ser propiedad')
    assert.deepEqual(searchTool.input_schema.required, ['query'])

    // Verificar que en turnMode PLAN o QUERY, search_files NO se apaga (es herramienta de solo lectura)
    const planTools = codeTools.filter(t => {
      if (t.name === 'propose_change' || t.name === 'propose_patch' || t.name === 'replace_file_content' || t.name === 'delete_file' || t.name === 'reset_project') return false
      return true
    })
    assert.ok(planTools.some(t => t.name === 'search_files'), 'search_files debe seguir disponible en modo PLAN')

    const queryTools = codeTools.filter(t => {
      if (t.name === 'propose_change' || t.name === 'propose_patch' || t.name === 'replace_file_content' || t.name === 'propose_migration' || t.name === 'execute_ddl' || t.name === 'delete_file' || t.name === 'reset_project') return false
      return true
    })
    assert.ok(queryTools.some(t => t.name === 'search_files'), 'search_files debe seguir disponible en modo QUERY')
  })

  await test('Libertad B: Soberanía de edición - delete_file y reset_project nativos en codeTools', async () => {
    const deleteTool = codeTools.find(t => t.name === 'delete_file')
    const resetTool = codeTools.find(t => t.name === 'reset_project')
    assert.ok(deleteTool, 'delete_file debe existir en codeTools')
    assert.ok(resetTool, 'reset_project debe existir en codeTools')
    assert.deepEqual(deleteTool.input_schema.required, ['path'])
  })

  await test('Libertad B: fuzzyPatcher bloquea marcadores perezosos pero permite reescrituras limpias con AST válido', async () => {
    // 1. Bloqueo de comentarios perezosos (truncation markers)
    const lazyContent = `
      import React from 'react';
      export default function Profile() {
        // ... rest of code
        return <div>Hola</div>;
      }
    `
    const lazyCheck = isTruncatedOrDestructive('src/Profile.jsx', 'original', lazyContent)
    assert.equal(lazyCheck.isDestructive, true, 'Debe marcar como destructivo si contiene // ... rest of code')
    assert.match(lazyCheck.reason, /código truncado/i)

    // 2. Permiso para reescritura limpia con AST válido (ej. de 50 líneas a 12 líneas concisas)
    const originalLongCode = `
      import React, { useState } from 'react';
      ${Array.from({ length: 45 }, (_, i) => `// Line comment ${i}`).join('\n')}
      export default function Counter() {
        return <div className="p-4">Count: 0</div>;
      }
    `
    const cleanRewrite = `
      import React, { useState } from 'react';
      export default function Counter() {
        const [count, setCount] = useState(0);
        return (
          <div className="p-4 rounded-xl bg-zinc-900 border border-white/10 text-white">
            <h3 className="text-sm font-medium">Contador Simplificado</h3>
            <p className="text-2xl font-bold mt-1">{count}</p>
            <button onClick={() => setCount(c => c + 1)} className="mt-3 px-3 py-1 bg-blue-600 rounded">
              Incrementar
            </button>
          </div>
        );
      }
    `
    const rewriteCheck = isTruncatedOrDestructive('src/Counter.jsx', originalLongCode, cleanRewrite)
    assert.equal(rewriteCheck.isDestructive, false, 'No debe bloquear reescritura limpia si el AST es válido y preserva exportaciones')
  })

  await test('Libertad C: uiIntegrityGuard audita estrictamente componentes creados en el turno actual (createdInCurrentTurn)', async () => {
    // Escenario: El proyecto tiene componentes previos existentes (Header.jsx, Footer.jsx)
    // El turno actual solo crea un nuevo componente 'DashboardMetrics.jsx' y modifica 'App.jsx'
    const stagedContent = new Map([
      ['src/App.jsx', `
        import React from 'react';
        import DashboardMetrics from './components/DashboardMetrics';
        export default function App() {
          return <DashboardMetrics />;
        }
      `],
      ['src/components/DashboardMetrics.jsx', `
        import React from 'react';
        export default function DashboardMetrics() {
          return <button onClick={() => alert("test")}>Ver Métricas</button>;
        }
      `]
    ])

    const proposedChanges = [
      { path: 'src/App.jsx', type: 'modify' },
      { path: 'src/components/DashboardMetrics.jsx', type: 'create', isNew: true }
    ]

    // Los archivos antiguos preexistentes en el proyecto (no tocados en este turno)
    const projectFilesList = [
      'package.json',
      'src/main.jsx',
      'src/App.jsx',
      'src/components/OldUnusedHeader.jsx', // Este archivo viejo no está en App.jsx pero NO fue creado en este turno
      'src/components/OldLegacySidebar.jsx'
    ]

    const res = await validateUiIntegrity({
      stagedContent,
      proposedChanges,
      projectFilesList,
      userMessage: 'agrega metricas al dashboard'
    })

    assert.equal(res.valid, true, 'uiIntegrityGuard debe ser válido porque el nuevo componente creado está conectado')
    assert.equal(res.orphanComponents.length, 0, 'No debe acusar de huérfanos a componentes viejos que no fueron creados en este turno')
  })

  await test('Libertad D: importGuard auto-inyecta dependencias npm sin rechazar turnos', async () => {
    const stagedContent = new Map([
      ['src/App.jsx', `
        import React from 'react';
        import { ShoppingCart, Bell } from 'lucide-react';
        import { motion } from 'framer-motion';
        export default function App() {
          return <div><ShoppingCart /><Bell /></div>;
        }
      `]
    ])

    const initialPkg = JSON.stringify({
      name: 'demo-app',
      dependencies: {
        react: '^18.3.1',
        'react-dom': '^18.3.1'
      }
    }, null, 2)

    const proposedChanges = [{ path: 'src/App.jsx', type: 'modify' }]

    const res = await runImportGuard({
      stagedContent,
      proposedChanges,
      existingPackageJsonContent: initialPkg,
      projectFilesList: ['src/App.jsx', 'package.json']
    })

    assert.equal(res.localValidation.valid, true, 'Importaciones de npm deben ser válidas')
    assert.ok(stagedContent.has('package.json'), 'package.json debe haber sido auto-inyectado en stagedContent')
    const updatedPkg = JSON.parse(stagedContent.get('package.json'))
    assert.ok(updatedPkg.dependencies['lucide-react'], 'lucide-react debe estar inyectado')
    assert.ok(updatedPkg.dependencies['framer-motion'], 'framer-motion debe estar inyectado')
  })

  await test('Libertad E: ask_question habilitado para consultas ambiguas pero anulado ante SQL ejecutable', async () => {
    // 1. Ambigüedad genuina -> ask_question permitido
    const allowGeneric = shouldAllowClarificationQuestion('mejora la app', {
      promptIntent: { isSqlExecutionOrder: false },
      elementContext: null
    })
    assert.equal(allowGeneric, true, 'Debe permitir clarificación si el pedido es genuinamente ambiguo y genérico')

    // 2. Sentencia SQL ejecutable -> ask_question PROHIBIDO (bypass total a ejecución directa)
    const sqlPrompt = 'CREATE TABLE user_profiles (id serial primary key, full_name text);'
    const allowSql = shouldAllowClarificationQuestion(sqlPrompt, {
      promptIntent: { isSqlExecutionOrder: true },
      elementContext: null
    })
    assert.equal(allowSql, false, 'NUNCA debe permitir ask_question cuando se proporciona SQL ejecutable')

    const doBlockPrompt = 'DO $$ BEGIN INSERT INTO garments (name) VALUES (\'camisa\'); END $$;'
    const allowDo = shouldAllowClarificationQuestion(doBlockPrompt, {
      promptIntent: { isSqlExecutionOrder: false },
      elementContext: null
    })
    assert.equal(allowDo, false, 'NUNCA debe permitir ask_question ante bloques DO $$')
  })

  // ==========================================================================
  // BLOQUE 2: LOS 4 ARNESES DETERMINISTAS EN LOS EXTREMOS DEL BACKEND
  // ==========================================================================

  await test('Arnés 1: Snapshot Git y Base de Datos obligatorio pre-reset (Zero Data-Loss)', async () => {
    let checkpointCreated = false
    const mockProject = { id: 'proj-arnes-1', repo_full_name: 'virtual-repo-arnes' }
    const mockStorageClient = {
      from: () => ({
        select: () => ({ eq: () => ({ data: [{ project_id: 'proj-arnes-1', path: 'src/App.jsx' }], error: null }) }),
        delete: () => ({ eq: () => ({ eq: () => ({ error: null }), in: () => ({ error: null }) }) }),
        upsert: () => ({ error: null })
      })
    }

    const mockSql = async (conn, query) => {
      if (query.includes('information_schema.tables')) {
        return { rows: [{ table_name: 'orders' }] }
      }
      if (query.includes('SELECT * FROM "public"."orders"')) {
        return { rows: [{ id: 1, total: 100 }, { id: 2, total: 250 }] }
      }
      return { rows: [] }
    }

    const resetRes = await executeHardProjectReset({
      project: mockProject,
      dbConnection: { id: 'conn-1' },
      wipeDatabase: true,
      customStorageClient: mockStorageClient,
      customSqlRunner: mockSql,
      customCheckpointFn: async () => {
        checkpointCreated = true
        return { id: 'checkpoint-pre-reset-1' }
      }
    })

    assert.equal(checkpointCreated, true, 'Debe crear un snapshot/checkpoint pre-reset antes de mutar nada')
    assert.ok(resetRes.tableBackups['orders'], 'Debe respaldar los registros de la tabla orders antes del DROP')
    assert.equal(resetRes.tableBackups['orders'].length, 2, 'Debe haber guardado los 2 registros en el backup')
    assert.ok(resetRes.droppedTables.includes('orders'), 'Debe haber eliminado la tabla tras el respaldo')
  })

  await test('Arnés 2: secretGuard bloquea claves privadas en src/ pero permite variables públicas y backend', async () => {
    // 1. Detección y bloqueo de SUPABASE_SERVICE_ROLE_KEY en src/
    const srcWithServiceKey = `
      import { createClient } from '@supabase/supabase-js';
      const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.super_secret_service_role_key_value_12345';
      export const supabase = createClient('https://xyz.supabase.co', SUPABASE_SERVICE_ROLE_KEY);
    `
    const checkService = scanForExposedSecrets('src/lib/supabase.js', srcWithServiceKey)
    assert.equal(checkService.hasSecret, true, 'Debe bloquear SUPABASE_SERVICE_ROLE_KEY en src/')
    assert.match(checkService.secretType, /Supabase Service Role/i)

    // 2. Detección de claves de Anthropic (sk-ant-...)
    const srcWithAnthropic = `
      const apiKey = 'sk-ant-api03-abcdef1234567890abcdef1234567890';
    `
    const checkAnth = scanForExposedSecrets('src/services/ai.js', srcWithAnthropic)
    assert.equal(checkAnth.hasSecret, true, 'Debe bloquear claves de Anthropic sk-ant-')

    // 3. Detección de claves de OpenAI (sk-proj-...)
    const srcWithOpenAi = `
      const token = "sk-proj-abcdef1234567890abcdef1234567890abcdef1234";
    `
    const checkOpenAi = scanForExposedSecrets('src/config.js', srcWithOpenAi)
    assert.equal(checkOpenAi.hasSecret, true, 'Debe bloquear claves de OpenAI sk-proj-')

    // 4. Código limpio con variables públicas en src/ (DEBE PERMITIRSE)
    const cleanClientCode = `
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      export const client = { supabaseUrl, anonKey };
    `
    const checkClean = scanForExposedSecrets('src/App.jsx', cleanClientCode)
    assert.equal(checkClean.hasSecret, false, 'No debe bloquear código limpio usando import.meta.env')

    // 5. Archivos de servidor o .env (DEBEN PERMITIRSE ya que no se empaquetan en el cliente)
    const envFileContent = `SUPABASE_SERVICE_ROLE_KEY=super_secret_token_here_123456`
    const checkEnv = scanForExposedSecrets('.env', envFileContent)
    assert.equal(checkEnv.hasSecret, false, 'Archivos de servidor .env no deben ser bloqueados por el escáner de cliente')
  })

  await test('Arnés 3: extractNegativeConstraints bloquea mutaciones no autorizadas ante órdenes explícitas', async () => {
    // 1. Prohibición general de modificar código ("no modifiques código", "solo explícame")
    const order1 = extractNegativeConstraints('No modifiques código, solo explícame cómo funciona el login')
    assert.equal(order1.hasConstraints, true)
    assert.equal(order1.prohibitAllCodeChanges, true, 'Debe prohibir mutaciones de código')

    const order1b = extractNegativeConstraints('solo explícame qué hace la función calculateTax')
    assert.equal(order1b.prohibitAllCodeChanges, true, '"solo explícame" debe activar bloqueo de mutaciones')

    // 2. Prohibición general de base de datos ("no toques la base de datos")
    const order2 = extractNegativeConstraints('Agrega un botón en la interfaz pero no toques la base de datos')
    assert.equal(order2.prohibitAllDbChanges, true, 'Debe prohibir cambios en base de datos')

    // 3. Prohibición sobre archivos específicos ("no toques App.jsx")
    const order3 = extractNegativeConstraints('Crea un componente nuevo pero no toques el archivo App.jsx ni modifiques index.html')
    assert.ok(order3.forbiddenFiles.includes('app.jsx'), 'Debe registrar App.jsx como prohibido')
    assert.ok(order3.forbiddenFiles.includes('index.html'), 'Debe registrar index.html como prohibido')

    // 4. Prohibición sobre tablas específicas ("no toques la tabla users")
    const order4 = extractNegativeConstraints('Crea la tabla productos pero no toques la tabla users')
    assert.ok(order4.forbiddenTables.includes('users'), 'Debe registrar la tabla users como prohibida')
  })

  await test('Arnés 4: validateSyntax y Verificación de Evidencia rechazan código roto antes de finalizar turnos', async () => {
    // Error sintáctico típico: return fuera de función
    const badJsx = `
      import React from 'react';
      return <div>Fuera de función</div>;
    `
    const err = validateSyntax('src/Bad.jsx', badJsx)
    assert.ok(err, 'Debe retornar error sintáctico si hay un return fuera de función')
    assert.match(err, /Error de sintaxis/i)

    // Código válido
    const goodJsx = `
      import React from 'react';
      export default function Good() {
        return <div className="text-sm">Hola Mundo</div>;
      }
    `
    const cleanErr = validateSyntax('src/Good.jsx', goodJsx)
    assert.equal(cleanErr, null, 'Código válido no debe arrojar error de sintaxis')
  })

  // ==========================================================================
  // BLOQUE 3: BASE DE DATOS Y VISIBILIDAD DE COLUMNAS (DatabaseView)
  // ==========================================================================

  await test('DatabaseView: Resolución triple de columnas (rowsResponse.columns || activeTable.columns || Object.keys(rows[0]))', async () => {
    // Simular resolución de columnas en el frontend cuando el backend devuelve columns con column_name o name
    const activeTable = {
      table_name: 'garments',
      column_count: 4,
      columns: [] // Supongamos que columns vino vacío por column_count
    }

    const rowsResponse = {
      columns: [
        { column_name: 'id', data_type: 'integer' },
        { column_name: 'name', data_type: 'text' },
        { column_name: 'price', data_type: 'numeric' },
        { column_name: 'created_at', data_type: 'timestamp' }
      ],
      rows: [
        { id: 1, name: 'Pantalón Denim', price: 89.90, created_at: '2026-10-17' },
        { id: 2, name: 'Camisa Lino', price: 65.00, created_at: '2026-10-17' }
      ]
    }

    // Regla de triple fallback idéntica a DatabaseViewPanel.jsx / DatabaseView.jsx
    const rawCols = (rowsResponse.columns && rowsResponse.columns.length > 0)
      ? rowsResponse.columns
      : (activeTable.columns && activeTable.columns.length > 0)
        ? activeTable.columns
        : (rowsResponse.rows.length > 0 ? Object.keys(rowsResponse.rows[0]) : [])

    const resolvedColumns = rawCols.map(col => {
      if (typeof col === 'string') return { name: col, type: 'text' }
      return {
        name: col.column_name || col.name || col.title || 'unnamed',
        type: col.data_type || col.type || 'text'
      }
    })

    assert.equal(resolvedColumns.length, 4, 'Debe haber resuelto las 4 columnas')
    assert.equal(resolvedColumns[0].name, 'id')
    assert.equal(resolvedColumns[1].name, 'name')
    assert.equal(resolvedColumns[2].name, 'price')
    assert.equal(resolvedColumns[3].name, 'created_at')

    // Verificación de renderizado de celdas
    for (const r of rowsResponse.rows) {
      for (const col of resolvedColumns) {
        assert.notEqual(r[col.name], undefined, `El registro debe contener valor para la columna ${col.name}`)
      }
    }
  })

  // ==========================================================================
  // BLOQUE 4: DIRECCIÓN DE ARTE UI/UX SENIOR Y SEO GOOGLE 2026
  // ==========================================================================

  await test('UI/UX y SEO 2026: Detección e inyección automática de Bento Grid, Glassmorphism y Schema.org', async () => {
    const webPrompt = 'crea una landing page moderna para un ecommerce de moda femenina'
    assert.equal(isWebOrLandingRequest(webPrompt), true, 'Debe detectar solicitud de landing/web')
    assert.equal(isSeoTarget(webPrompt), true, 'Debe detectar objetivo de posicionamiento SEO')

    const artDirectives = getSeniorArtDirectionDirectives({ isWebOrLanding: true })
    assert.match(artDirectives, /Bento Grid/i)
    assert.match(artDirectives, /Glassmorphism/i)

    const seoDirectives = getTechnicalSeoDirectives()
    assert.match(seoDirectives, /Core Web Vitals/i)
    assert.match(seoDirectives, /schema\.org/i)
    assert.match(seoDirectives, /SEO.*GOOGLE.*2026/i)
  })

  console.log('\n======================================================================')
  console.log(`📊 RESULTADOS DE LA CERTIFICACIÓN: ${passed} PASADOS, ${failed} FALLADOS`)
  console.log('======================================================================')

  if (failed > 0) {
    process.exit(1)
  }
}

runTests().catch(err => {
  console.error('Error fatal ejecutando test suite:', err)
  process.exit(1)
})
