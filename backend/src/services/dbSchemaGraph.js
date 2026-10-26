// backend/src/services/dbSchemaGraph.js
// MAPA SEMÁNTICO ULTRACOMPACTO DE BASE DE DATOS SQL (FASE 4)
// Formato estricto de una línea por tabla (< 300 tokens) para erradicar alucinaciones de columnas.

import { readAllProjectFiles } from './projectStorage.js'
import { isVirtualRepo } from './projectResolver.js'

// Caché en memoria con TTL de 3 minutos (180,000 ms)
const schemaCache = new Map()
const CACHE_TTL_MS = 3 * 60 * 1000

/**
 * Invalida el caché del esquema de base de datos para un proyecto específico
 * @param {string} projectId
 */
export function invalidateDbSchemaGraph(projectId) {
  if (projectId) {
    schemaCache.delete(projectId)
  }
}

/**
 * Limpia y normaliza el tipo de dato SQL para que sea ultracompacto
 */
function normalizeType(rawType) {
  const t = (rawType || '').toLowerCase().trim()
  if (t.includes('uuid')) return 'uuid'
  if (t.includes('timestamp')) return 'timestamptz'
  if (t.includes('int')) return t.includes('big') ? 'bigint' : 'int'
  if (t.includes('bool')) return 'boolean'
  if (t.includes('json')) return 'jsonb'
  if (t.includes('numeric') || t.includes('decimal') || t.includes('money')) return 'numeric'
  if (t.includes('float') || t.includes('double') || t.includes('real')) return 'float'
  if (t.includes('char') || t.includes('text') || t.includes('string')) return 'text'
  return t.split(/\s+/)[0] || 'text'
}

/**
 * Parsea definiciones DDL de SQL y extrae tablas, columnas, PKs, FKs y RLS
 * @param {string} sqlContent
 * @returns {Record<string, { columns: Array<{ name: string, type: string, isPk: boolean, fkTarget: string|null }>, rls: boolean }>}
 */
export function parseSqlSchema(sqlContent) {
  if (!sqlContent || typeof sqlContent !== 'string') return {}

  const tables = {}

  // 1. Encontrar CREATE TABLE ... (...)
  const createTableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:([a-zA-Z0-9_]+)\.)?([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\)(?:\s*;|\s*$)/gi
  let match

  while ((match = createTableRegex.exec(sqlContent)) !== null) {
    const tableName = match[2].toLowerCase()
    const body = match[3]

    if (!tables[tableName]) {
      tables[tableName] = { columns: [], rls: false }
    }

    // Dividir columnas por coma que no esté dentro de paréntesis
    const lines = []
    let parenDepth = 0
    let currentLine = ''
    for (let i = 0; i < body.length; i++) {
      const char = body[i]
      if (char === '(') parenDepth++
      else if (char === ')') parenDepth--
      else if (char === ',' && parenDepth === 0) {
        lines.push(currentLine.trim())
        currentLine = ''
        continue
      }
      currentLine += char
    }
    if (currentLine.trim()) lines.push(currentLine.trim())

    for (const rawCol of lines) {
      const colLine = rawCol.trim()
      if (!colLine) continue

      // Descartar constraints a nivel de tabla
      if (/^(CONSTRAINT|PRIMARY\s+KEY|FOREIGN\s+KEY|CHECK|UNIQUE)\b/i.test(colLine)) {
        // Chequear si es PRIMARY KEY (col1, col2)
        const pkMatch = colLine.match(/PRIMARY\s+KEY\s*\(\s*([a-zA-Z0-9_]+)\s*\)/i)
        if (pkMatch) {
          const colName = pkMatch[1].toLowerCase()
          const existing = tables[tableName].columns.find((c) => c.name === colName)
          if (existing) existing.isPk = true
        }
        continue
      }

      const colParts = colLine.split(/\s+/)
      if (colParts.length < 2) continue

      const colName = colParts[0].replace(/["`]/g, '').toLowerCase()
      const rawType = colParts[1].replace(/["`,()]/g, '')
      const colType = normalizeType(rawType)

      const isPk = /\bPRIMARY\s+KEY\b/i.test(colLine)
      
      let fkTarget = null
      const refMatch = colLine.match(/REFERENCES\s+(?:([a-zA-Z0-9_]+)\.)?([a-zA-Z0-9_]+)/i)
      if (refMatch) {
        const schema = refMatch[1] ? refMatch[1] + '.' : ''
        fkTarget = `${schema}${refMatch[2].toLowerCase()}`
      }

      // Evitar duplicados
      if (!tables[tableName].columns.some((c) => c.name === colName)) {
        tables[tableName].columns.push({
          name: colName,
          type: colType,
          isPk,
          fkTarget,
        })
      }
    }
  }

  // 2. Detectar ALTER TABLE ... ENABLE ROW LEVEL SECURITY
  const rlsRegex = /ALTER\s+TABLE\s+(?:([a-zA-Z0-9_]+)\.)?([a-zA-Z0-9_]+)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi
  let rlsMatch
  while ((rlsMatch = rlsRegex.exec(sqlContent)) !== null) {
    const tableName = rlsMatch[2].toLowerCase()
    if (tables[tableName]) {
      tables[tableName].rls = true
    }
  }

  return tables
}

/**
 * Formatea el esquema en una sola línea ultracompacta por tabla
 * Ejemplo: 📦 tabla_nombre(id uuid PK, user_id uuid FK->auth.users, nombre text) [RLS: ON]
 * 
 * @param {Record<string, { columns: Array<{ name: string, type: string, isPk: boolean, fkTarget: string|null }>, rls: boolean }>} tables
 * @returns {string}
 */
export function formatCompactDbSchema(tables) {
  if (!tables || Object.keys(tables).length === 0) return ''

  const tableNames = Object.keys(tables).sort()
  const lines = [
    '=== ESQUEMA ACTUAL DE BASE DE DATOS (USAR NOMBRES DE COLUMNAS EXACTOS) ===',
  ]

  let charBudget = 1000 // Mantener estrictamente < 300 tokens (~1200 chars)

  for (const tName of tableNames) {
    const data = tables[tName]
    const colStrs = data.columns.map((c) => {
      let str = `${c.name} ${c.type}`
      if (c.isPk) str += ' PK'
      if (c.fkTarget) str += ` FK->${c.fkTarget}`
      return str
    })

    const rlsStr = data.rls ? ' [RLS: ON]' : ' [RLS: OFF]'
    const line = `📦 ${tName}(${colStrs.join(', ')})${rlsStr}`

    if (charBudget - line.length < 100 && tableNames.indexOf(tName) < tableNames.length - 1) {
      lines.push(`... (+${tableNames.length - tableNames.indexOf(tName)} tablas adicionales omitidas)`)
      break
    }

    lines.push(line)
    charBudget -= line.length
  }

  lines.push('=== FIN DEL ESQUEMA DE BASE DE DATOS ===')
  return lines.join('\n')
}

/**
 * Obtiene el mapa semántico de BD para el proyecto (con caché de 3 minutos)
 * @param {object} project
 * @param {object} [schemaDetails] - Esquema vivo pasado por dbConnectionResolver
 * @returns {Promise<string>} Bloque de texto compacto listo para inyectar en agent.js
 */
export async function getDbSchemaGraph(project, schemaDetails = null) {
  if (!project?.id) return ''

  // 1. Revisar caché en memoria
  const cached = schemaCache.get(project.id)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.formatted
  }

  const combinedTables = {}

  // 2. Si hay schemaDetails del resolver de BD en vivo (mapa de tabla -> columnas)
  if (schemaDetails && typeof schemaDetails === 'object') {
    for (const [tName, cols] of Object.entries(schemaDetails)) {
      const cleanName = tName.toLowerCase()
      if (!combinedTables[cleanName]) {
        combinedTables[cleanName] = { columns: [], rls: true } // Las tablas de Supabase tienen RLS activado por defecto
      }
      if (Array.isArray(cols)) {
        for (const col of cols) {
          const colName = String(col).toLowerCase()
          combinedTables[cleanName].columns.push({
            name: colName,
            type: colName === 'id' ? 'uuid' : colName.endsWith('_id') ? 'uuid' : 'text',
            isPk: colName === 'id',
            fkTarget: colName.endsWith('_id') ? colName.replace(/_id$/, '') : null,
          })
        }
      }
    }
  }

  // 3. Escanear archivos SQL del proyecto en busca de definiciones completas DDL
  try {
    let sqlFilesContent = ''
    if (isVirtualRepo(project.repo_full_name)) {
      const files = await readAllProjectFiles(project.id).catch(() => [])
      for (const f of files) {
        if (f.path.endsWith('.sql')) {
          sqlFilesContent += `\n${f.content || ''}`
        }
      }
    }

    if (sqlFilesContent) {
      const parsed = parseSqlSchema(sqlFilesContent)
      for (const [tName, data] of Object.entries(parsed)) {
        combinedTables[tName] = data
      }
    }
  } catch (_) {}

  const formatted = formatCompactDbSchema(combinedTables)

  // 4. Guardar en caché
  schemaCache.set(project.id, {
    formatted,
    timestamp: Date.now(),
  })

  return formatted
}
