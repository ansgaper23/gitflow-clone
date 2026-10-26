// tests/test_phase4_subsystems.mjs
// TEST SUITE: EDICIÓN VISUAL INSTANTÁNEA (ZERO-LLM), MAPA SEMÁNTICO SQL Y SALVAGUARDAS LRU/SPLASH (FASE 4)
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

import { mutateTailwindClasses, parseTailwindToken, getTailwindClassGroup } from '../backend/src/services/tailwindMutator.js'
import { isDynamicExpression, DYNAMIC_JSX_PATTERNS } from '../backend/src/services/quickEditService.js'
import { parseSqlSchema, formatCompactDbSchema, invalidateDbSchemaGraph } from '../backend/src/services/dbSchemaGraph.js'

console.log('\n==============================================================================')
console.log('🧪 FLOWPRO - TEST SUITE: FASE 4 BLINDADA (ZERO-LLM, DB GRAPH, LRU & SPLASH)')
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
// MÓDULO 1: MUTADOR INTELIGENTE DE TAILWIND (ZERO-LLM)
// ----------------------------------------------------------------------------
runTest('TailwindMutator: Reemplazo limpio de color de fondo sin acumular clases', () => {
  const initial = 'flex items-center bg-blue-600 text-white p-4'
  const updated = mutateTailwindClasses(initial, { bg: 'bg-emerald-600' })
  
  assert.ok(updated.includes('bg-emerald-600'), 'Debe incluir la nueva clase de fondo')
  assert.ok(!updated.includes('bg-blue-600'), 'Debe eliminar la clase de fondo previa')
  assert.equal(updated.split('bg-').length - 1, 1, 'No debe apilar múltiples clases de fondo')
  assert.ok(updated.includes('text-white') && updated.includes('p-4'), 'Debe preservar las demás clases')
})

runTest('TailwindMutator: Reemplazo de border-radius y padding sin colisiones', () => {
  const initial = 'px-4 py-2 rounded-md bg-zinc-900 border border-zinc-800'
  const updated = mutateTailwindClasses(initial, {
    rounded: 'rounded-2xl',
    p: 'p-6'
  })

  assert.ok(updated.includes('rounded-2xl'), 'Debe tener rounded-2xl')
  assert.ok(!updated.includes('rounded-md'), 'No debe conservar rounded-md')
  assert.ok(updated.includes('p-6'), 'Debe tener p-6')
  assert.ok(!updated.includes('px-4') && !updated.includes('py-2'), 'Debe reemplazar px y py por p-6')
})

runTest('TailwindMutator: Preservación estricta de modificadores y variantes (hover:, dark:, md:)', () => {
  const initial = 'bg-blue-600 hover:bg-blue-700 dark:bg-blue-900 text-white'
  
  // Reemplazar solo la clase base
  const updatedBase = mutateTailwindClasses(initial, { bg: 'bg-red-500' })
  assert.ok(updatedBase.includes('bg-red-500'), 'Debe actualizar base a bg-red-500')
  assert.ok(updatedBase.includes('hover:bg-blue-700'), 'Debe conservar hover:bg-blue-700 intacto')
  assert.ok(updatedBase.includes('dark:bg-blue-900'), 'Debe conservar dark:bg-blue-900 intacto')

  // Reemplazar solo la variante hover
  const updatedHover = mutateTailwindClasses(initial, { hoverBg: 'hover:bg-emerald-500' })
  assert.ok(updatedHover.includes('bg-blue-600'), 'Debe conservar base bg-blue-600')
  assert.ok(updatedHover.includes('hover:bg-emerald-500'), 'Debe cambiar hover a hover:bg-emerald-500')
  assert.ok(!updatedHover.includes('hover:bg-blue-700'), 'No debe tener la vieja clase hover')
})

runTest('TailwindMutator: Manejo de múltiples tokens en una sola actualización y nuevas utilidades', () => {
  const initial = 'inline-block text-sm'
  const updated = mutateTailwindClasses(initial, {
    combined: 'bg-indigo-600 text-white rounded-lg shadow-md'
  })

  assert.ok(updated.includes('bg-indigo-600'))
  assert.ok(updated.includes('text-white'))
  assert.ok(updated.includes('rounded-lg'))
  assert.ok(updated.includes('shadow-md'))
  assert.ok(updated.includes('inline-block'))
  assert.ok(updated.includes('text-sm'), 'text-sm (tamaño) coexiste armónicamente con text-white (color)')
})

// ----------------------------------------------------------------------------
// MÓDULO 1: SALVAGUARDA DE EXPRESIONES DINÁMICAS (FALLBACK A IA)
// ----------------------------------------------------------------------------
runTest('QuickEdit: Detección precisa de expresiones dinámicas JSX ({item.title}, etc.)', () => {
  // Expresiones dinámicas que deben activar el fallback a IA
  assert.equal(isDynamicExpression('{user.name}'), true, '{user.name} es dinámico')
  assert.equal(isDynamicExpression('{item.title}'), true, '{item.title} es dinámico')
  assert.equal(isDynamicExpression('{props.label}'), true, '{props.label} es dinámico')
  assert.equal(isDynamicExpression('{t("common.save")}'), true, 't(...) es dinámico')
  assert.equal(isDynamicExpression('${price} USD'), true, 'Template string es dinámico')
  assert.equal(isDynamicExpression('{count + 1}'), true, 'Expresión con llaves es dinámica')

  // Textos estáticos que son seguros para edición Zero-LLM
  assert.equal(isDynamicExpression('Comprar Ahora'), false, '"Comprar Ahora" es estático')
  assert.equal(isDynamicExpression('FlowPro Cloud Dashboard'), false, 'Título es estático')
  assert.equal(isDynamicExpression('¿Olvidaste tu contraseña?'), false, 'Pregunta es estática')
  assert.equal(isDynamicExpression('v2.4.0'), false, 'Versión es estática')
})

// ----------------------------------------------------------------------------
// MÓDULO 2: MAPA SEMÁNTICO ULTRACOMPACTO DE BASE DE DATOS SQL (< 300 TOKENS)
// ----------------------------------------------------------------------------
runTest('DbSchemaGraph: Parseo de DDL SQL con PKs, FKs y RLS', () => {
  const sqlMock = `
    CREATE TABLE IF NOT EXISTS public.users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT NOT NULL UNIQUE,
      full_name TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS public.orders (
      id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
      user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
      total_amount NUMERIC(10, 2) NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP
    );

    CREATE TABLE items (
      id INT,
      order_id BIGINT REFERENCES orders(id),
      product_name VARCHAR(255),
      price NUMERIC,
      PRIMARY KEY (id)
    );

    ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
  `

  const schema = parseSqlSchema(sqlMock)
  
  assert.ok(schema.users, 'Debe parsear la tabla users')
  assert.ok(schema.orders, 'Debe parsear la tabla orders')
  assert.ok(schema.items, 'Debe parsear la tabla items')

  // Chequeo de columnas y tipos normalizados
  const usersId = schema.users.columns.find(c => c.name === 'id')
  assert.equal(usersId.type, 'uuid')
  assert.equal(usersId.isPk, true)
  assert.equal(schema.users.rls, true, 'users debe tener RLS habilitado')

  const orderUserId = schema.orders.columns.find(c => c.name === 'user_id')
  assert.equal(orderUserId.fkTarget, 'public.users', 'order.user_id debe referenciar public.users')
  assert.equal(schema.orders.rls, false, 'orders no tiene RLS habilitado')

  const itemsId = schema.items.columns.find(c => c.name === 'id')
  assert.equal(itemsId.isPk, true, 'items.id debe ser PK vía constraint PRIMARY KEY (id)')
})

runTest('DbSchemaGraph: Formato estricto 1-línea por tabla y límite de tokens (< 300 tokens)', () => {
  const mockTables = {
    users: {
      columns: [
        { name: 'id', type: 'uuid', isPk: true },
        { name: 'email', type: 'text' },
        { name: 'role', type: 'text' }
      ],
      rls: true
    },
    projects: {
      columns: [
        { name: 'id', type: 'uuid', isPk: true },
        { name: 'owner_id', type: 'uuid', fkTarget: 'users' },
        { name: 'name', type: 'text' },
        { name: 'status', type: 'text' }
      ],
      rls: true
    },
    tickets: {
      columns: [
        { name: 'id', type: 'int', isPk: true },
        { name: 'project_id', type: 'uuid', fkTarget: 'projects' },
        { name: 'title', type: 'text' },
        { name: 'points', type: 'numeric' }
      ],
      rls: false
    }
  }

  const output = formatCompactDbSchema(mockTables)
  const lines = output.split('\n').filter(l => l.startsWith('📦'))

  assert.equal(lines.length, 3, 'Debe haber exactamente una línea por tabla')
  const usersLine = lines.find(l => l.includes('📦 users'))
  const projectsLine = lines.find(l => l.includes('📦 projects'))
  const ticketsLine = lines.find(l => l.includes('📦 tickets'))

  assert.ok(usersLine && usersLine.includes('📦 users(id uuid PK, email text, role text) [RLS: ON]'))
  assert.ok(projectsLine && projectsLine.includes('📦 projects(id uuid PK, owner_id uuid FK->users, name text, status text) [RLS: ON]'))
  assert.ok(ticketsLine && ticketsLine.includes('📦 tickets(id int PK, project_id uuid FK->projects, title text, points numeric) [RLS: OFF]'))

  // Token estimate: 1 token ≈ 4 caracteres
  const estimatedTokens = Math.ceil(output.length / 4)
  assert.ok(estimatedTokens < 300, `El esquema debe consumir menos de 300 tokens (actual: ~${estimatedTokens} tokens)`)
})

// ----------------------------------------------------------------------------
// MÓDULO 3: ANTI-502 SPLASH Y CONFIGURACIÓN NGINX
// ----------------------------------------------------------------------------
runTest('Nginx & Anti-502 Splash: Retorno HTTP 200 y script de auto-reload', () => {
  const candidateNginxPaths = [
    '/etc/nginx/sites-available/gitflow-preview-subdomains',
    '/etc/nginx/sites-enabled/gitflow-preview-subdomains',
    path.resolve(process.cwd(), 'infra/nginx/gitflow-preview-subdomains')
  ]
  const nginxConfPath = candidateNginxPaths.find(p => fs.existsSync(p))
  assert.ok(nginxConfPath, 'El archivo de configuración de Nginx debe existir')

  const content = fs.readFileSync(nginxConfPath, 'utf-8')
  
  // Verificación 1: error_page 502 503 504 =200 (crucial para Cloudflare)
  assert.ok(
    content.includes('error_page 502 503 504 =200 /_preview_starting;'),
    'Nginx debe interceptar 502/503/504 y responder con status 200 a Cloudflare'
  )

  // Verificación 2: Ubicación interna /_preview_starting
  assert.ok(
    content.includes('location = /_preview_starting'),
    'Debe definir la ubicación interna /_preview_starting'
  )

  // Verificación 3: Script de sondeo/auto-recarga en 1500ms
  assert.ok(
    content.includes('1500') && content.includes('poll()'),
    'Debe contener el polling continuo cada 1500ms para auto-recarga'
  )

  // Verificación 4: Diseño moderno oscuro con spinner
  assert.ok(
    content.includes('Despertando la vista previa'),
    'Debe incluir mensaje amigable de inicialización de preview'
  )
})

// ----------------------------------------------------------------------------
// MÓDULO 3: GESTIÓN DE POOL LRU EN SERVER.MJS (DRENAJE Y OCUPACIÓN)
// ----------------------------------------------------------------------------
runTest('Server.mjs: Protección contra desalojo de slots en estado starting o busy', () => {
  const candidateServerPaths = [
    '/opt/gitflow-previews/orchestrator/server.mjs',
    path.resolve(process.cwd(), 'infra/preview-orchestrator/server.mjs')
  ]
  const serverPath = candidateServerPaths.find(p => fs.existsSync(p))
  assert.ok(serverPath, 'El archivo server.mjs del orquestador debe existir')
  const content = fs.readFileSync(serverPath, 'utf-8')

  assert.ok(
    content.includes("s.status === 'starting'"),
    'findLruSlot debe ignorar slots en estado starting'
  )
  assert.ok(
    content.includes("s.status === 'draining'"),
    'findLruSlot debe ignorar slots en proceso de drenaje'
  )
  assert.ok(
    content.includes("s.isBusy"),
    'findLruSlot debe comprobar si el slot está ocupado (s.isBusy)'
  )
})

// ----------------------------------------------------------------------------
// RESUMEN FINAL
// ----------------------------------------------------------------------------
console.log('\n------------------------------------------------------------------------------')
if (passed === total) {
  console.log(`\x1b[32m✨ TODOS LOS TESTS PASARON EXITOSAMENTE (${passed}/${total})\x1b[0m`)
} else {
  console.log(`\x1b[31m❌ ALGUNOS TESTS FALLARON: ${passed}/${total} superados\x1b[0m`)
}
console.log('------------------------------------------------------------------------------\n')

if (passed !== total) {
  process.exit(1)
}
