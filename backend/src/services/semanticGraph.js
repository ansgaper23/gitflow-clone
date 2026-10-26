// backend/src/services/semanticGraph.js
// INDEXADOR SEMÁNTICO Y GRAFO DE DEPENDENCIAS INVERSO
// Extrae exports, firmas de props y el grafo inverso (ImportedBy) de los archivos en src/

import path from 'node:path'
import { supabase } from '../db/supabaseClient.js'
import { isVirtualRepo } from './projectResolver.js'
import { listProjectFiles, readProjectFile } from './projectStorage.js'

// Extensiones de código a inspeccionar
const CODE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx'])

/**
 * Normaliza una ruta de archivo (separadores POSIX)
 */
function normalizePath(p) {
  return p.replace(/\\/g, '/').replace(/^\.\//, '')
}

/**
 * Resuelve una ruta de importación relativa o con alias (@/)
 * contra las rutas reales existentes en el proyecto.
 */
function resolveImportPath(importSpecifier, sourceFilePath, availablePaths) {
  if (!importSpecifier || typeof importSpecifier !== 'string') return null
  
  // Ignorar librerías de terceros (node_modules)
  if (!importSpecifier.startsWith('.') && !importSpecifier.startsWith('@/')) {
    return null
  }

  let basePath = ''
  if (importSpecifier.startsWith('@/')) {
    basePath = 'src/' + importSpecifier.slice(2)
  } else {
    const sourceDir = path.dirname(sourceFilePath).replace(/\\/g, '/')
    basePath = normalizePath(path.join(sourceDir, importSpecifier))
  }

  // Comprobar coincidencia exacta
  if (availablePaths.has(basePath)) return basePath

  // Probar extensiones estándar
  for (const ext of ['.jsx', '.tsx', '.js', '.ts']) {
    const candidate = `${basePath}${ext}`
    if (availablePaths.has(candidate)) return candidate
  }

  // Probar index interno
  for (const ext of ['/index.jsx', '/index.tsx', '/index.js', '/index.ts']) {
    const candidate = `${basePath}${ext}`
    if (availablePaths.has(candidate)) return candidate
  }

  return null
}

/**
 * Extrae la firma de props del componente principal
 */
function extractPropsSignature(content) {
  if (!content) return ''

  // 1. function Component({ a, b, c }) o function({ a, b })
  const fnDestruct = content.match(/(?:export\s+default\s+)?function(?:\s+[A-Z]\w*)?\s*\(\s*(\{[\s\S]*?\})\s*[:\w<>\s]*\)/)
  if (fnDestruct && fnDestruct[1]) {
    const clean = fnDestruct[1].replace(/\s+/g, ' ').trim()
    if (clean.length < 120) return clean
  }

  // 2. const Component = ({ a, b }) =>
  const arrowDestruct = content.match(/(?:export\s+)?const\s+[A-Z]\w*\s*=\s*(?:\([^)]*\)\s*=>\s*|\(\s*(\{[\s\S]*?\})\s*[:\w<>\s]*\)\s*=>)/)
  if (arrowDestruct && arrowDestruct[1]) {
    const clean = arrowDestruct[1].replace(/\s+/g, ' ').trim()
    if (clean.length < 120) return clean
  }

  // 3. Parámetro simple: function Component(props)
  const fnProps = content.match(/(?:export\s+default\s+)?function(?:\s+[A-Z]\w*)?\s*\(\s*(props)\s*[:\w<>\s]*\)/)
  if (fnProps) return '(props)'

  return ''
}

/**
 * Extrae exports (funciones, componentes, constantes) de un archivo
 */
function extractExports(content) {
  if (!content) return { defaultExport: null, namedExports: [] }

  let defaultExport = null
  const namedExports = new Set()

  // Export default con función o clase nombrada: export default function Header(...)
  const defaultFnMatch = content.match(/export\s+default\s+(?:function|class)(?:\s+([A-Za-z0-9_$]+))?/)
  if (defaultFnMatch) {
    defaultExport = defaultFnMatch[1] || 'default'
  } else {
    // Export default identificador: export default Header;
    const defaultIdMatch = content.match(/export\s+default\s+([A-Za-z0-9_$]+)/)
    if (defaultIdMatch && !['function', 'class', 'const', 'let', 'var'].includes(defaultIdMatch[1])) {
      defaultExport = defaultIdMatch[1]
    }
  }

  // Named export functions: export function calculateTotal(...)
  const fnMatches = content.matchAll(/export\s+function\s+([A-Za-z0-9_$]+)/g)
  for (const m of fnMatches) {
    if (m[1]) namedExports.add(m[1])
  }

  // Named export const/let: export const API_URL = ... o export const Button = ...
  const constMatches = content.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/g)
  for (const m of constMatches) {
    if (m[1]) namedExports.add(m[1])
  }

  // Export list: export { a, b as c }
  const exportListMatches = content.matchAll(/export\s*\{\s*([^}]+)\s*\}/g)
  for (const m of exportListMatches) {
    const items = m[1].split(',')
    for (const rawItem of items) {
      const item = rawItem.trim()
      if (!item) continue
      const parts = item.split(/\s+as\s+/)
      const exportedName = parts[parts.length - 1].trim()
      if (exportedName === 'default') {
        defaultExport = parts[0].trim()
      } else if (exportedName) {
        namedExports.add(exportedName)
      }
    }
  }

  return {
    defaultExport,
    namedExports: Array.from(namedExports),
  }
}

/**
 * Extrae todas las rutas de importación de un archivo
 */
function extractImports(content) {
  if (!content) return []
  const imports = []
  
  // import ... from '...'
  const fromMatches = content.matchAll(/(?:import|from)\s+['"]([^'"]+)['"]/g)
  for (const m of fromMatches) {
    if (m[1]) imports.push(m[1])
  }

  // dynamic import('...')
  const dynamicMatches = content.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)
  for (const m of dynamicMatches) {
    if (m[1]) imports.push(m[1])
  }

  return imports
}

/**
 * Construye el grafo semántico a partir de un mapa de archivos { [path]: content }
 * @param {Record<string, string>} filesMap
 * @returns {Record<string, { exports: string[], props: string, importedBy: string[] }>}
 */
export function buildSemanticGraphFromFiles(filesMap) {
  const filePaths = Object.keys(filesMap).filter((p) => {
    const ext = path.extname(p).toLowerCase()
    return p.startsWith('src/') && CODE_EXTENSIONS.has(ext)
  })

  const availablePathsSet = new Set(filePaths)
  const graph = {}

  // Inicializar nodos
  for (const filePath of filePaths) {
    const content = filesMap[filePath] || ''
    const { defaultExport, namedExports } = extractExports(content)
    const props = extractPropsSignature(content)

    const exportList = []
    if (defaultExport) {
      exportList.push(`default ${defaultExport}${props ? `(${props})` : ''}`)
    }
    for (const exp of namedExports) {
      if (exp !== defaultExport) exportList.push(exp)
    }

    graph[filePath] = {
      defaultExport,
      namedExports,
      props,
      exportSummary: exportList.join(', ') || '(sin exports)',
      importedBy: new Set(),
      rawImports: extractImports(content),
    }
  }

  // Construir grafo inverso (ImportedBy)
  for (const filePath of filePaths) {
    const node = graph[filePath]
    for (const imp of node.rawImports) {
      const resolvedTarget = resolveImportPath(imp, filePath, availablePathsSet)
      if (resolvedTarget && graph[resolvedTarget] && resolvedTarget !== filePath) {
        graph[resolvedTarget].importedBy.add(filePath)
      }
    }
  }

  // Convertir Sets a arrays ordenados para serialización determinística
  const result = {}
  for (const [filePath, data] of Object.entries(graph)) {
    result[filePath] = {
      exports: data.exportSummary,
      props: data.props,
      importedBy: Array.from(data.importedBy).sort(),
    }
  }

  return result
}

/**
 * Formatea el grafo semántico en un texto compacto de alta densidad para inyectar en el prompt
 */
export function formatSemanticGraph(graph) {
  if (!graph || Object.keys(graph).length === 0) return ''

  const lines = [
    '=== MAPA SEMÁNTICO Y GRAFO DE DEPENDENCIAS (SRC/) ===',
    'REGLA CRÍTICA: Si modificas las props, exports o firma de un archivo, revisa siempre su lista "ImportedBy" para no romper los componentes padres que lo consumen.',
    '',
  ]

  const sortedPaths = Object.keys(graph).sort()
  for (const filePath of sortedPaths) {
    const entry = graph[filePath]
    const importedByStr = entry.importedBy.length > 0
      ? entry.importedBy.join(', ')
      : '(ninguno - raíz o ruta final)'

    lines.push(`• ${filePath}`)
    lines.push(`  Exports: ${entry.exports}`)
    lines.push(`  ImportedBy: ${importedByStr}`)
  }

  lines.push('=== FIN DEL MAPA SEMÁNTICO ===\n')
  return lines.join('\n')
}

/**
 * Identifica qué archivo del mapa semántico coincide con el elemento visual seleccionado
 * @param {Record<string, any>} graph
 * @param {Record<string, string>} filesMap
 * @param {object} elementContext
 * @returns {string|null}
 */
export function findMatchingFileForElement(graph, filesMap, elementContext) {
  if (!elementContext) return null

  // 1. Si source ya viene con fileName exacto
  if (elementContext.source?.fileName) {
    const norm = normalizePath(elementContext.source.fileName)
    for (const p of Object.keys(graph)) {
      if (norm.endsWith(p) || p.endsWith(norm)) return p
    }
  }

  // 2. Si componentName está presente (ej. "ContactModal" o "Navbar")
  if (elementContext.componentName) {
    const comp = elementContext.componentName.trim()
    for (const [filePath, data] of Object.entries(graph)) {
      if (data.exports && data.exports.includes(comp)) return filePath
      const base = path.basename(filePath, path.extname(filePath))
      if (base.toLowerCase() === comp.toLowerCase()) return filePath
    }
  }

  // 3. Buscar coincidencia por texto visible significativo
  const text = (elementContext.innerText || elementContext.textSnippet || '').trim()
  if (text.length >= 4 && filesMap) {
    const searchPhrase = text.slice(0, 50).toLowerCase()
    for (const [filePath, content] of Object.entries(filesMap)) {
      if (filePath.startsWith('src/') && content && content.toLowerCase().includes(searchPhrase)) {
        return filePath
      }
    }
    // Si la frase completa no coincide exacta (ej. texto compuesto), probar con bigramas
    const rawWords = text.split(/\s+/).filter((w) => w.length >= 4)
    if (rawWords.length >= 2) {
      const bigram = `${rawWords[0]} ${rawWords[1]}`.toLowerCase()
      for (const [filePath, content] of Object.entries(filesMap)) {
        if (filePath.startsWith('src/') && content && content.toLowerCase().includes(bigram)) {
          return filePath
        }
      }
    } else if (rawWords.length === 1 && rawWords[0].length >= 5) {
      const singleWord = rawWords[0].toLowerCase()
      for (const [filePath, content] of Object.entries(filesMap)) {
        if (filePath.startsWith('src/') && content && content.toLowerCase().includes(singleWord)) {
          return filePath
        }
      }
    }
  }

  // 4. Buscar coincidencia por clases Tailwind únicas o muy específicas
  const classes = (elementContext.className || '').trim().split(/\s+/).filter((c) => c.length > 6 && !c.includes(':'))
  if (classes.length > 0 && filesMap) {
    for (const cls of classes.slice(0, 3)) {
      for (const [filePath, content] of Object.entries(filesMap)) {
        if (filePath.startsWith('src/') && content && content.includes(cls)) {
          return filePath
        }
      }
    }
  }

  return null
}

// Caché en memoria para evitar reescanear en el mismo turno
const graphCache = new Map() // "projectId" -> { graph, formatted, filesMap, expiresAt }
const GRAPH_CACHE_TTL = 3 * 60 * 1000 // 3 minutos

export function invalidateSemanticGraph(projectId) {
  if (projectId) graphCache.delete(projectId)
}

/**
 * Obtiene o genera el mapa semántico de un proyecto cargando sus archivos src/
 */
export async function getProjectSemanticGraph(project, accessToken, signal) {
  if (!project) return { graph: {}, formatted: '', filesMap: {} }

  const cacheKey = project.id || project.repo_full_name
  const cached = graphCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached
  }

  const filesMap = {}

  try {
    // Si es repo virtual, consultar project_files para src/
    if (isVirtualRepo(project.repo_full_name)) {
      const { data, error } = await supabase
        .from('project_files')
        .select('path, content')
        .eq('project_id', project.id)
        .like('path', 'src/%')
      
      if (!error && Array.isArray(data)) {
        for (const file of data) {
          const ext = path.extname(file.path).toLowerCase()
          if (CODE_EXTENSIONS.has(ext)) {
            filesMap[file.path] = file.content || ''
          }
        }
      }
    } else {
      // Repositorio de GitHub: listar y leer archivos de src/
      const tree = await listProjectFiles(project, accessToken, signal).catch(() => [])
      const srcFiles = tree.filter((f) => f.path.startsWith('src/') && CODE_EXTENSIONS.has(path.extname(f.path).toLowerCase()))
      
      // Leer con límite de concurrencia
      await Promise.all(
        srcFiles.slice(0, 40).map(async (f) => {
          try {
            const content = await readProjectFile(project, accessToken, f.path, signal)
            filesMap[f.path] = content || ''
          } catch (_) {}
        })
      )
    }
  } catch (err) {
    console.warn('[semanticGraph] Error cargando archivos para mapa semántico:', err.message)
  }

  const graph = buildSemanticGraphFromFiles(filesMap)
  const formatted = formatSemanticGraph(graph)

  const payload = { graph, formatted, filesMap, expiresAt: Date.now() + GRAPH_CACHE_TTL }
  graphCache.set(cacheKey, payload)
  return payload
}
