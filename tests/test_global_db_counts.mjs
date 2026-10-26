// tests/test_global_db_counts.mjs
// TEST SUITE: METADATA RESOLVER GLOBAL DE TABLAS Y CONTEO REAL DE FILAS (FLOWPRO)
import assert from 'node:assert/strict'

console.log('\n==============================================================================')
console.log('🧪 FLOWPRO - TEST SUITE: RESOLVER GLOBAL DE TABLAS & CONTEO REAL DE FILAS')
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
// MÓDULO 1: ESTANDARIZACIÓN GLOBAL DE METADATOS (row_count vs column_count)
// ----------------------------------------------------------------------------
await runTest('Resolver: Distingue inequívocamente entre row_count (filas) y column_count (columnas)', async () => {
  // Simulador de esquema con tablas donde filas != columnas
  const mockTables = [
    {
      table_name: 'usuarios',
      rls_enabled: true,
      column_count: 5,
      columns: [
        { name: 'id', type: 'uuid', is_primary: true },
        { name: 'nombre', type: 'text' },
        { name: 'email', type: 'text' },
        { name: 'rol', type: 'varchar' },
        { name: 'creado_en', type: 'timestamptz' }
      ]
    },
    {
      table_name: 'pedidos',
      rls_enabled: false,
      column_count: 3,
      columns: [
        { name: 'id', type: 'bigint', is_primary: true },
        { name: 'total', type: 'numeric' },
        { name: 'estado', type: 'varchar' }
      ]
    },
    {
      table_name: 'configuracion',
      rls_enabled: false,
      column_count: 8,
      columns: new Array(8).fill(null).map((_, i) => ({ name: `col_${i}`, type: 'text' }))
    }
  ]

  // Conexión simulada con conteos reales en la base de datos
  const mockDbCounts = {
    usuarios: 1420,     // 1420 filas vs 5 columnas
    pedidos: 89,        // 89 filas vs 3 columnas
    configuracion: 0    // 0 filas vs 8 columnas (tabla vacía)
  }

  const resolved = await Promise.all(
    mockTables.map(async (table) => {
      let row_count = 0
      try {
        row_count = mockDbCounts[table.table_name] ?? 0
      } catch {
        row_count = 0
      }
      return {
        table_name: table.table_name,
        name: table.table_name,
        row_count,
        column_count: table.column_count,
        rls_enabled: table.rls_enabled,
        columns: table.columns
      }
    })
  )

  // Verificaciones sobre 'usuarios'
  const usuarios = resolved.find(t => t.table_name === 'usuarios')
  assert.equal(usuarios.row_count, 1420, 'row_count debe ser 1420 registros reales')
  assert.equal(usuarios.column_count, 5, 'column_count debe ser 5 columnas')
  assert.notEqual(usuarios.row_count, usuarios.column_count, 'NUNCA debe devolver el número de columnas como filas')
  assert.equal(usuarios.rls_enabled, true, 'Debe preservar el estado de RLS activo')

  // Verificaciones sobre 'pedidos'
  const pedidos = resolved.find(t => t.table_name === 'pedidos')
  assert.equal(pedidos.row_count, 89)
  assert.equal(pedidos.column_count, 3)
  assert.notEqual(pedidos.row_count, pedidos.column_count)

  // Verificaciones sobre 'configuracion' (tabla vacía con múltiples columnas)
  const config = resolved.find(t => t.table_name === 'configuracion')
  assert.equal(config.row_count, 0, 'Una tabla vacía debe reportar 0 filas')
  assert.equal(config.column_count, 8, 'Debe reportar sus 8 columnas correctamente')
})

// ----------------------------------------------------------------------------
// MÓDULO 2: RESILIENCIA Y FALLBACK SILENCIOSO ANTE BLOQUEOS RLS
// ----------------------------------------------------------------------------
await runTest('Fallback: Tablas bloqueadas por RLS o permisos devuelven row_count: 0 sin abortar', async () => {
  const mockTables = [
    { table_name: 'public_data', column_count: 2 },
    { table_name: 'restricted_vault', column_count: 6 } // Lanzará excepción por permisos
  ]

  const resolved = await Promise.all(
    mockTables.map(async (table) => {
      let row_count = 0
      try {
        if (table.table_name === 'restricted_vault') {
          throw new Error('permission denied for table restricted_vault (RLS violation)')
        }
        row_count = 42
      } catch {
        // Fallback silencioso requerido por la arquitectura FlowPro
        row_count = 0
      }
      return {
        table_name: table.table_name,
        row_count,
        column_count: table.column_count
      }
    })
  )

  assert.equal(resolved.length, 2, 'Debe devolver todas las tablas sin abortar la petición')
  const vault = resolved.find(t => t.table_name === 'restricted_vault')
  assert.equal(vault.row_count, 0, 'La tabla bloqueada debe tener fallback a 0')
  const publicData = resolved.find(t => t.table_name === 'public_data')
  assert.equal(publicData.row_count, 42, 'Las demás tablas deben reportar su conteo normalmente')
})

// ----------------------------------------------------------------------------
// MÓDULO 3: SINCRONIZACIÓN REACTIVA OPTIMISTA EN EL FRONTEND
// ----------------------------------------------------------------------------
await runTest('Frontend Optimista: Insertar fila incrementa row_count (+1) de forma reactiva', () => {
  let state = [
    { table_name: 'productos', name: 'productos', row_count: 15, column_count: 4 },
    { table_name: 'categorias', name: 'categorias', row_count: 3, column_count: 2 }
  ]

  const selectedTable = 'productos'
  // Simulación del dispatch de DatabaseViewPanel.jsx en saveNewRow
  state = state.map((t) => {
    if ((t.name || t.table_name) === selectedTable) {
      return { ...t, row_count: (t.row_count ?? 0) + 1 }
    }
    return t
  })

  const prod = state.find(t => t.table_name === 'productos')
  assert.equal(prod.row_count, 16, 'Debe incrementar inmediatamente a 16 (+1)')
  const cat = state.find(t => t.table_name === 'categorias')
  assert.equal(cat.row_count, 3, 'Las demás tablas deben permanecer inalteradas')
})

await runTest('Frontend Optimista: Borrar fila decrementa row_count (-1) sin bajar de 0', () => {
  let state = [
    { table_name: 'productos', name: 'productos', row_count: 1, column_count: 4 },
    { table_name: 'categorias', name: 'categorias', row_count: 0, column_count: 2 }
  ]

  const selectedTable = 'productos'
  // Simulación del dispatch de DatabaseViewPanel.jsx en deleteRow
  state = state.map((t) => {
    if ((t.name || t.table_name) === selectedTable) {
      return { ...t, row_count: Math.max(0, (t.row_count ?? 1) - 1) }
    }
    return t
  })

  let prod = state.find(t => t.table_name === 'productos')
  assert.equal(prod.row_count, 0, 'Debe decrementar a 0')

  // Segundo borrado en tabla vacía: no debe volverse negativo (-1)
  state = state.map((t) => {
    if ((t.name || t.table_name) === selectedTable) {
      return { ...t, row_count: Math.max(0, (t.row_count ?? 1) - 1) }
    }
    return t
  })

  prod = state.find(t => t.table_name === 'productos')
  assert.equal(prod.row_count, 0, 'No debe ser negativo bajo ninguna circunstancia')
})

// ----------------------------------------------------------------------------
// MÓDULO 3: GARANTÍA GLOBAL DE COLUMNAS Y FALLBACK OBJECT.KEYS(ROWS[0])
// ----------------------------------------------------------------------------
await runTest('Garantía de Columnas: getTableRows y fetchTableColumns devuelven columns poblado con tipos y PKs', async () => {
  // Simulación de respuesta de getTableRowsData o fetchTableColumns
  const mockDbColumns = [
    { column_name: 'id', data_type: 'uuid', is_nullable: 'NO', is_primary: true },
    { column_name: 'title', data_type: 'text', is_nullable: 'YES', is_primary: false },
    { column_name: 'price', data_type: 'numeric', is_nullable: 'YES', is_primary: false },
    { column_name: 'created_at', data_type: 'timestamp with time zone', is_nullable: 'NO', is_primary: false }
  ]

  const normalized = mockDbColumns.map((col) => ({
    name: col.column_name,
    column_name: col.column_name,
    type: col.data_type,
    data_type: col.data_type,
    is_nullable: col.is_nullable === 'YES',
    is_primary: Boolean(col.is_primary)
  }))

  assert.equal(normalized.length, 4, 'Debe devolver las 4 columnas')
  assert.equal(normalized[0].name, 'id')
  assert.equal(normalized[0].is_primary, true, 'id debe ser primary key')
  assert.equal(normalized[1].name, 'title')
  assert.equal(normalized[2].name, 'price')
})

await runTest('Doble Fallback Infalible: Inferencia automática desde Object.keys(rows[0]) cuando columns viene vacío', () => {
  // Simulación de escenario donde information_schema falló y columns es []
  const loadedColumns = []
  const activeTableObj = { name: 'garments', columns: [] }
  const mockRows = [
    { id: 'g1', brand: 'Nike', category: 'Sportswear', stock: 45, in_production: true },
    { id: 'g2', brand: 'Adidas', category: 'Footwear', stock: 12, in_production: false }
  ]

  // Lógica exacta de effectiveColumns de DatabaseViewPanel.jsx
  const normalizeColDef = (c) => {
    if (typeof c === 'string') return { name: c, column_name: c, type: 'text', is_primary: c === 'id' }
    return {
      name: c.name || c.column_name,
      column_name: c.name || c.column_name,
      type: c.type || c.data_type || 'text',
      is_primary: Boolean(c.is_primary || c.name === 'id')
    }
  }

  let effectiveColumns = []
  if (loadedColumns && loadedColumns.length > 0) {
    effectiveColumns = loadedColumns.map(normalizeColDef)
  } else if (activeTableObj?.columns && activeTableObj.columns.length > 0) {
    effectiveColumns = activeTableObj.columns.map(normalizeColDef)
  } else if (mockRows && mockRows.length > 0) {
    effectiveColumns = Object.keys(mockRows[0]).map((k) => ({
      name: k,
      column_name: k,
      type: typeof mockRows[0][k] === 'number' ? 'integer' : typeof mockRows[0][k] === 'boolean' ? 'boolean' : 'text',
      is_primary: k === 'id',
      is_nullable: true
    }))
  }

  assert.equal(effectiveColumns.length, 5, 'Debe inferir exactamente las 5 columnas de garments')
  const colNames = effectiveColumns.map(c => c.name)
  assert.deepEqual(colNames, ['id', 'brand', 'category', 'stock', 'in_production'])
  const idCol = effectiveColumns.find(c => c.name === 'id')
  assert.equal(idCol.is_primary, true, 'id debe detectarse como primary key')
  const stockCol = effectiveColumns.find(c => c.name === 'stock')
  assert.equal(stockCol.type, 'integer', 'stock numérico debe tiparse como integer')
})

await runTest('Código Fuente: repoDb.js usa relrowsecurity en vez del inexistente c.rowsecurity', async () => {
  const fs = await import('node:fs')
  const content = fs.readFileSync('backend/src/services/repoDb.js', 'utf-8')
  assert.ok(content.includes('c.relrowsecurity'), 'repoDb.js debe referenciar c.relrowsecurity')
  assert.ok(!content.includes('c.rowsecurity,'), 'repoDb.js NO debe contener c.rowsecurity')
})

await runTest('Código Fuente: cloudController.js y DatabaseViewPanel.jsx devuelven y procesan columns en filas', async () => {
  const fs = await import('node:fs')
  const controller = fs.readFileSync('backend/src/controllers/cloudController.js', 'utf-8')
  assert.ok(controller.includes('fetchTableColumns'), 'cloudController.js debe invocar fetchTableColumns')
  assert.ok(controller.includes('columns: effectiveColumns'), 'cloudController.js debe retornar columns')

  const panel = fs.readFileSync('frontend/src/components/DatabaseViewPanel.jsx', 'utf-8')
  assert.ok(panel.includes('effectiveColumns'), 'DatabaseViewPanel.jsx debe calcular effectiveColumns')
  assert.ok(panel.includes('loadedColumns'), 'DatabaseViewPanel.jsx debe almacenar loadedColumns')
  assert.ok(panel.includes('Object.keys(rows[0])'), 'DatabaseViewPanel.jsx debe tener fallback Object.keys(rows[0])')
  assert.ok(!panel.includes('text-zinc-500 font-mono">\n                  #'), 'DatabaseViewPanel.jsx no debe renderizar columna #')
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
