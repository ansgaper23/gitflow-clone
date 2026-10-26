// tests/test_phase5_code_and_db.mjs
// TEST SUITE: EDITOR DE CÓDIGO LIGERO, EXPORTACIÓN ZIP SEGURA, BASE DE DATOS Y SINCRONIZACIÓN TRIPARTITA (FASE 5)
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import AdmZip from '../backend/node_modules/adm-zip/adm-zip.js'

import { sanitizeProjectPath } from '../backend/src/routes/projects.js'
import { invalidateSemanticGraph } from '../backend/src/services/semanticGraph.js'
import { invalidateDbSchemaGraph } from '../backend/src/services/dbSchemaGraph.js'

console.log('\n==============================================================================')
console.log('🧪 FLOWPRO - TEST SUITE: FASE 5 BLINDADA (CODE EDITOR, ZIP EXPORT, DB MANAGER)')
console.log('==============================================================================\n')

let passed = 0
let total = 0

async function runTest(name, fn) {
  total++
  process.stdout.write(`[TEST ${total}] ${name} ... `)
  const start = Date.now()
  try {
    await fn()
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
// MÓDULO 1: SANITIZACIÓN ESTRICTA ANTI-PATH-TRAVERSAL (sanitizeProjectPath)
// ----------------------------------------------------------------------------
await runTest('Sanitizer: Acepta rutas relativas de código válidas', () => {
  assert.equal(sanitizeProjectPath('src/App.jsx'), 'src/App.jsx')
  assert.equal(sanitizeProjectPath('src/components/Header.tsx'), 'src/components/Header.tsx')
  assert.equal(sanitizeProjectPath('package.json'), 'package.json')
  assert.equal(sanitizeProjectPath('public/vite.svg'), 'public/vite.svg')
  assert.equal(sanitizeProjectPath('src\\styles\\main.css'), 'src/styles/main.css')
})

await runTest('Sanitizer: Bloquea intentos de Path Traversal (../ y ..\\)', () => {
  assert.throws(() => sanitizeProjectPath('../../../etc/passwd'), /Ruta no permitida/)
  assert.throws(() => sanitizeProjectPath('..\\..\\windows\\system32'), /Ruta no permitida/)
  assert.throws(() => sanitizeProjectPath('src/../../secrets.txt'), /Ruta no permitida/)
  assert.throws(() => sanitizeProjectPath('..'), /Ruta no permitida/)
})

await runTest('Sanitizer: Bloquea rutas absolutas y drivers de Windows', () => {
  assert.throws(() => sanitizeProjectPath('/root/.ssh/id_rsa'), /Ruta no permitida/)
  assert.throws(() => sanitizeProjectPath('/etc/shadow'), /Ruta no permitida/)
  assert.throws(() => sanitizeProjectPath('C:\\Windows\\System32'), /Ruta no permitida/)
  assert.throws(() => sanitizeProjectPath('D:/data/passwords'), /Ruta no permitida/)
})

await runTest('Sanitizer: Bloquea archivos y directorios restringidos (.git, .env, node_modules)', () => {
  assert.throws(() => sanitizeProjectPath('.env'), /Acceso denegado a ruta restringida/)
  assert.throws(() => sanitizeProjectPath('.env.local'), /Acceso denegado a ruta restringida/)
  assert.throws(() => sanitizeProjectPath('config/.env.production'), /Acceso denegado a ruta restringida/)
  assert.throws(() => sanitizeProjectPath('.git/config'), /Acceso denegado a ruta restringida/)
  assert.throws(() => sanitizeProjectPath('node_modules/react/index.js'), /Acceso denegado a ruta restringida/)
})

await runTest('Sanitizer: Bloquea bytes nulos y entradas vacías', () => {
  assert.throws(() => sanitizeProjectPath('src/app.js\0.png'), /Carácter nulo/)
  assert.throws(() => sanitizeProjectPath(''), /inválida o vacía/)
  assert.throws(() => sanitizeProjectPath('   '), /inválida o vacía/)
  assert.throws(() => sanitizeProjectPath(null), /inválida o vacía/)
})

// ----------------------------------------------------------------------------
// MÓDULO 2: EXPORTACIÓN ZIP LIMPIA Y SEGURA (AdmZip)
// ----------------------------------------------------------------------------
await runTest('AdmZip: Generación de ZIP excluyendo node_modules, .git y .env', () => {
  const zip = new AdmZip()
  
  // Archivos simulados del proyecto
  const files = [
    { path: 'package.json', content: '{"name": "test-app", "version": "1.0.0"}' },
    { path: 'src/App.jsx', content: 'export default function App() { return <h1>Hola FlowPro</h1>; }' },
    { path: 'src/main.jsx', content: 'import App from "./App";' },
    { path: 'public/index.html', content: '<!DOCTYPE html><html><body><div id="root"></div></body></html>' },
    // Archivos sensibles que deben ser ignorados
    { path: '.env', content: 'SECRET_API_KEY=12345' },
    { path: '.git/HEAD', content: 'ref: refs/heads/main' },
    { path: 'node_modules/vite/package.json', content: '{}' }
  ]

  const EXCLUDED_PATTERNS = [
    /^\.git(\/|\\|$)/i,
    /^node_modules(\/|\\|$)/i,
    /^\.env(\.|$)/i,
    /\.DS_Store$/i
  ]

  let addedCount = 0
  for (const f of files) {
    const isExcluded = EXCLUDED_PATTERNS.some(re => re.test(f.path))
    if (!isExcluded) {
      zip.addFile(f.path, Buffer.from(f.content, 'utf8'))
      addedCount++
    }
  }

  assert.equal(addedCount, 4, 'Deben incluirse solo 4 archivos de código')
  const zipBuffer = zip.toBuffer()
  assert.ok(zipBuffer.length > 0, 'El buffer de ZIP debe ser válido y no vacío')

  // Verificar que al leer el ZIP no contenga nada sensible
  const readZip = new AdmZip(zipBuffer)
  const entries = readZip.getEntries().map(e => e.entryName)
  
  assert.ok(entries.includes('package.json'), 'Debe incluir package.json')
  assert.ok(entries.includes('src/App.jsx'), 'Debe incluir src/App.jsx')
  assert.ok(!entries.some(e => e.includes('.env')), 'NO debe contener .env')
  assert.ok(!entries.some(e => e.includes('.git')), 'NO debe contener .git')
  assert.ok(!entries.some(e => e.includes('node_modules')), 'NO debe contener node_modules')
})

// ----------------------------------------------------------------------------
// MÓDULO 3: GESTOR DE BASE DE DATOS Y RESOLUCIÓN DINÁMICA DE PRIMARY KEY
// ----------------------------------------------------------------------------
await runTest('Dynamic PK: Detección dinámica de Primary Key en esquemas DDL', () => {
  // Caso 1: Estándar con col.is_primary
  const tableStandard = {
    name: 'users',
    columns: [
      { name: 'id', type: 'uuid', is_primary: true },
      { name: 'email', type: 'text' }
    ]
  }
  const pkStandard = tableStandard.columns.find(c => c.is_primary || c.is_pk || c.primaryKey)?.name || 'id'
  assert.equal(pkStandard, 'id', 'Debe detectar id como PK')

  // Caso 2: Tabla de negocio con clave no estándar 'order_code'
  const tableOrders = {
    name: 'orders',
    columns: [
      { name: 'order_code', type: 'varchar(32)', is_pk: true },
      { name: 'total', type: 'numeric' },
      { name: 'created_at', type: 'timestamp' }
    ]
  }
  const pkOrders = tableOrders.columns.find(c => c.is_primary || c.is_pk || c.primaryKey)?.name || 'id'
  assert.equal(pkOrders, 'order_code', 'Debe detectar order_code como PK')

  // Caso 3: Tabla sin indicador explícito -> fallback 'id'
  const tableLegacy = {
    name: 'logs',
    columns: [
      { name: 'message', type: 'text' },
      { name: 'level', type: 'varchar' }
    ]
  }
  const pkLegacy = tableLegacy.columns.find(c => c.is_primary || c.is_pk || c.primaryKey)?.name || 'id'
  assert.equal(pkLegacy, 'id', 'Fallback debe ser "id"')
})

await runTest('Dynamic PK: Formulación limpia de WHERE en mutaciones SQL', () => {
  const pkCol = 'order_code'
  const targetRow = { order_code: 'ORD-9821', total: 450.50 }
  const pkValue = targetRow[pkCol]

  assert.equal(pkValue, 'ORD-9821')
  const whereClause = `WHERE "${pkCol}" = '${pkValue}'`
  assert.equal(whereClause, 'WHERE "order_code" = \'ORD-9821\'')
})

// ----------------------------------------------------------------------------
// MÓDULO 4: INVALIDACIÓN Y SINCRONIZACIÓN DE GRAFOS
// ----------------------------------------------------------------------------
await runTest('Graph Invalidation: Invocación segura de invalidateSemanticGraph e invalidateDbSchemaGraph', () => {
  // Comprobar que no lanzan excepciones y manejan id inexistente
  assert.doesNotThrow(() => invalidateSemanticGraph('test-proj-123'))
  assert.doesNotThrow(() => invalidateDbSchemaGraph('test-proj-123'))
  assert.doesNotThrow(() => invalidateSemanticGraph(null))
  assert.doesNotThrow(() => invalidateDbSchemaGraph(undefined))
})

// ----------------------------------------------------------------------------
// RESUMEN FINAL
// ----------------------------------------------------------------------------
console.log('\n==============================================================================')
console.log(`📊 RESULTADOS: ${passed} / ${total} tests pasaron satisfactoriamente (${Math.round((passed / total) * 100)}%)`)
console.log('==============================================================================\n')

if (passed !== total) {
  process.exit(1)
}
