// backend/src/services/importGuard.js
// GUARDIÁN ESTÁTICO DE IMPORTACIONES, ESCUDO LUCIDE-REACT Y AUTO-CORRECTOR DE EXPORTS (FASE 4)
// 1. Valida rutas de importación local (./, ../, @/) con verificación estricta de mayúsculas/minúsculas para Linux/Docker
// 2. Auto-corrige desajustes entre export default vs named exports (evita crashes de runtime)
// 3. Escudo anti-alucinación de íconos lucide-react y auto-inyección de íconos JSX faltantes
// 4. Auto-sana package.json inyectando dependencias externas faltantes (lucide-react, framer-motion, clsx, etc.)

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { autoInjectDependencies, normalizePackageName } from './dependencyAutoInjector.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const CODE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte'])
const RESOLVE_EXTENSIONS = ['', '.jsx', '.tsx', '.js', '.ts', '.mjs', '.cjs', '.css', '.json', '.svg', '.png', '/index.jsx', '/index.tsx', '/index.js', '/index.ts']

function normalizePosix(p) {
  return p.replace(/\\/g, '/').replace(/^\.\//, '')
}

// ────────────────────────────────────────────────────────────────
// DICCIONARIO Y MAPA DE SUSTITUCIÓN PARA ÍCONOS DE LUCIDE-REACT
// ────────────────────────────────────────────────────────────────

export const LUCIDE_HALLUCINATIONS_MAP = {
  Tool: 'Wrench',
  Tools: 'Wrench',
  Electric: 'Zap',
  Electricity: 'Zap',
  Lightning: 'Zap',
  Transformer: 'Cpu',
  Substation: 'Factory',
  Certificate: 'Award',
  Certification: 'Award',
  Helmet: 'HardHat',
  Whatsapp: 'MessageCircle',
  WhatsApp: 'MessageCircle',
  CheckShield: 'ShieldCheck',
  ShieldTick: 'ShieldCheck',
  Light: 'Sparkles',
  Security: 'ShieldCheck',
  Document: 'FileText',
  Paper: 'FileText',
  Gear: 'Settings',
  Gears: 'Settings',
  Fire: 'Flame',
  Warning: 'AlertTriangle',
  Danger: 'AlertCircle',
  Chat: 'MessageSquare',
  PhoneCall: 'Phone',
  Email: 'Mail',
  Support: 'LifeBuoy',
  Robot: 'Bot',
  Bulb: 'Lightbulb',
  Industry: 'Factory',
  Speed: 'Gauge',
  GaugeCircle: 'Gauge',
  Metric: 'BarChart',
  Graph: 'TrendingUp',
  Chart: 'BarChart',
  Analytics: 'LineChart',
  CloudCheck: 'CloudRain',
  UserShield: 'ShieldCheck',
  Card: 'CreditCard',
  Handshake: 'Users',
  BriefcaseMedical: 'Cross',
  Money: 'DollarSign',
  Coins: 'Coins',
  Coin: 'Coins',
  Speedometer: 'Gauge',
  Diagram: 'Network',
  Chip: 'Cpu',
  DatabaseAlert: 'Database',
  ServerAlert: 'Server',
}

export const KNOWN_LUCIDE_ICONS = new Set()
try {
  const jsonPath = path.join(__dirname, 'lucideIconNames.json')
  if (fs.existsSync(jsonPath)) {
    const list = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
    for (const item of list) {
      KNOWN_LUCIDE_ICONS.add(item)
    }
  }
} catch (_) {}

// Fallback robusto con los más de 120 íconos estándar de Lucide
if (KNOWN_LUCIDE_ICONS.size === 0) {
  const fallbackIcons = [
    'Activity', 'Airplay', 'AlertCircle', 'AlertOctagon', 'AlertTriangle', 'AlignCenter',
    'AlignJustify', 'AlignLeft', 'AlignRight', 'ArrowDown', 'ArrowDownLeft', 'ArrowDownRight',
    'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowUpLeft', 'ArrowUpRight', 'Award', 'BarChart',
    'Bell', 'Book', 'Bookmark', 'Bot', 'Building', 'Building2', 'Calendar', 'Camera', 'Check',
    'CheckCircle', 'CheckCircle2', 'ChevronDown', 'ChevronLeft', 'ChevronRight', 'ChevronUp',
    'Circle', 'Clock', 'Cloud', 'CloudRain', 'Code', 'Compass', 'Copy', 'Cpu', 'CreditCard',
    'Database', 'Download', 'Edit', 'Eye', 'EyeOff', 'Factory', 'File', 'FileCheck', 'FileCheck2',
    'FileText', 'Filter', 'Flame', 'Folder', 'Globe', 'Grid', 'HardHat', 'Heart', 'HelpCircle',
    'Home', 'Image', 'Inbox', 'Info', 'Layers', 'Layout', 'Lightbulb', 'LineChart', 'Link',
    'List', 'Lock', 'Mail', 'MapPin', 'Maximize', 'Menu', 'MessageCircle', 'MessageSquare',
    'Mic', 'Minimize', 'Moon', 'MoreHorizontal', 'MoreVertical', 'Navigation', 'Network',
    'Package', 'Phone', 'Play', 'Plus', 'Power', 'Radio', 'RefreshCw', 'Save', 'Scale',
    'Search', 'Send', 'Server', 'Settings', 'Share', 'Shield', 'ShieldAlert', 'ShieldCheck',
    'Sliders', 'Sparkles', 'Star', 'Sun', 'Terminal', 'ThumbsUp', 'Trash2', 'TrendingUp',
    'Truck', 'Tv', 'Unlock', 'Upload', 'User', 'UserCheck', 'Users', 'Video', 'Volume2',
    'Wifi', 'Wind', 'Wrench', 'X', 'Zap'
  ]
  fallbackIcons.forEach(i => KNOWN_LUCIDE_ICONS.add(i))
}

/**
 * Escudo anti-alucinación y auto-sanación de íconos de lucide-react:
 * 1. Sustituye íconos alucinados por íconos reales mediante alias (ej. Substation -> Factory as Substation)
 * 2. Si un elemento JSX usa un ícono conocido de Lucide pero se olvidó en el import, lo auto-agrega
 */
export function sanitizeLucideIcons(code) {
  if (!code || typeof code !== 'string') return { code, modified: false, fixes: [] }
  let newCode = code
  const fixes = []
  let modified = false

  // 1. Detectar todas las sentencias de importación desde 'lucide-react'
  const lucideImportRegex = /import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/g
  const importedIcons = new Set()
  let hasLucideImport = false

  newCode = newCode.replace(lucideImportRegex, (fullMatch, specifiersStr) => {
    hasLucideImport = true
    const items = specifiersStr.split(',').map(s => s.trim()).filter(Boolean)
    const newItems = []

    for (const item of items) {
      const asMatch = item.match(/^([a-zA-Z0-9_]+)\s+as\s+([a-zA-Z0-9_]+)$/)
      if (asMatch) {
        const [, originalName, alias] = asMatch
        importedIcons.add(alias)
        if (KNOWN_LUCIDE_ICONS.has(originalName)) {
          newItems.push(item)
        } else {
          const substitute = LUCIDE_HALLUCINATIONS_MAP[originalName] || 'Sparkles'
          newItems.push(`${substitute} as ${alias}`)
          fixes.push(`Ícono inexistente en lucide-react "${originalName}" sustituido por "${substitute} as ${alias}"`)
          modified = true
        }
      } else {
        const iconName = item
        importedIcons.add(iconName)
        if (KNOWN_LUCIDE_ICONS.has(iconName)) {
          newItems.push(item)
        } else {
          const substitute = LUCIDE_HALLUCINATIONS_MAP[iconName] || 'Sparkles'
          newItems.push(`${substitute} as ${iconName}`)
          fixes.push(`Ícono inexistente en lucide-react "${iconName}" sustituido por "${substitute} as ${iconName}"`)
          modified = true
        }
      }
    }

    return `import { ${newItems.join(', ')} } from 'lucide-react'`
  })

  // 2. Escanear elementos JSX en el código para detectar íconos de lucide usados pero olvidados en el import
  const jsxTagRegex = /<([A-Z][a-zA-Z0-9_]*)(?:\s|\/|>)/g
  let tagMatch
  const missingLucideIcons = new Set()

  const declaredRegex = /(?:function|const|let|var|class|import)\s+([a-zA-Z0-9_]+)/g
  const localDeclared = new Set()
  let declMatch
  while ((declMatch = declaredRegex.exec(newCode)) !== null) {
    localDeclared.add(declMatch[1])
  }

  while ((tagMatch = jsxTagRegex.exec(newCode)) !== null) {
    const tagName = tagMatch[1]
    if (KNOWN_LUCIDE_ICONS.has(tagName) && !importedIcons.has(tagName) && !localDeclared.has(tagName)) {
      missingLucideIcons.add(tagName)
    }
  }

  // 3. Auto-inyectar los íconos de Lucide faltantes detectados en JSX
  if (missingLucideIcons.size > 0) {
    const missingArr = Array.from(missingLucideIcons)
    if (hasLucideImport) {
      newCode = newCode.replace(/import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/, (match, specs) => {
        return `import { ${specs.trim()}, ${missingArr.join(', ')} } from 'lucide-react'`
      })
      fixes.push(`Auto-inyectados íconos de lucide-react faltantes usados en JSX: ${missingArr.join(', ')}`)
      modified = true
    } else {
      newCode = `import { ${missingArr.join(', ')} } from 'lucide-react';\n` + newCode
      fixes.push(`Añadido import de lucide-react para íconos usados en JSX: ${missingArr.join(', ')}`)
      modified = true
    }
  }

  return { code: newCode, modified, fixes }
}

/**
 * Auto-armoniza desajustes entre "export default" y named exports entre archivos locales:
 * Si A hace "import B from './B'" pero B solo tiene "export function B", agrega "export default B;" en B.
 * Si A hace "import { B } from './B'" pero B solo tiene "export default function B", agrega "export { B };" en B.
 */
export function autoFixDefaultAndNamedExports(stagedContent, projectFilesList = []) {
  const fixes = []

  const availablePaths = new Map()
  for (const p of projectFilesList) {
    if (p) availablePaths.set(normalizePosix(p).toLowerCase(), normalizePosix(p))
  }
  for (const p of stagedContent.keys()) {
    if (p) availablePaths.set(normalizePosix(p).toLowerCase(), normalizePosix(p))
  }

  function resolveLocalTarget(importerPath, spec) {
    const importerDir = path.dirname(importerPath).replace(/\\/g, '/')
    let base = ''
    if (spec.startsWith('@/')) {
      base = 'src/' + spec.slice(2)
    } else if (spec.startsWith('~/')) {
      base = spec.slice(2)
    } else {
      base = path.normalize(path.join(importerDir, spec)).replace(/\\/g, '/')
    }
    base = normalizePosix(base)

    for (const ext of RESOLVE_EXTENSIONS) {
      const candidate = (base + ext).toLowerCase()
      if (availablePaths.has(candidate)) {
        return availablePaths.get(candidate)
      }
    }
    return null
  }

  for (const [importerPath, importerContent] of Array.from(stagedContent.entries())) {
    const ext = path.extname(importerPath).toLowerCase()
    if (!CODE_EXTENSIONS.has(ext)) continue

    // 1. Extraer imports con default: import Foo from './Target' o import Foo, { Bar } from './Target'
    const defaultImportRegex = /import\s+([a-zA-Z0-9_]+)(?:\s*,\s*\{[^}]*\})?\s+from\s+['"]([^'"]+)['"]/g
    let dMatch
    while ((dMatch = defaultImportRegex.exec(importerContent)) !== null) {
      const defaultIdentifier = dMatch[1]
      const spec = dMatch[2]
      if (!spec.startsWith('.') && !spec.startsWith('@/') && !spec.startsWith('~/')) continue

      const resolved = resolveLocalTarget(importerPath, spec)
      if (resolved && stagedContent.has(resolved)) {
        let targetCode = stagedContent.get(resolved)
        const hasDefaultExport = /export\s+default\s+/m.test(targetCode)

        if (!hasDefaultExport) {
          let exportSymbol = defaultIdentifier
          const funcNamedRegex = new RegExp(`(?:export\\s+)?(?:function|const|class)\\s+(${defaultIdentifier})\\b`, 'm')
          if (!funcNamedRegex.test(targetCode)) {
            const firstExport = targetCode.match(/export\s+(?:function|const|class)\s+([A-Z][a-zA-Z0-9_]*)/)
            if (firstExport) {
              exportSymbol = firstExport[1]
            }
          }
          targetCode = targetCode.trimEnd() + `\n\nexport default ${exportSymbol};\n`
          stagedContent.set(resolved, targetCode)
          fixes.push(`Auto-agregado "export default ${exportSymbol};" en "${resolved}" requerido por "${importerPath}"`)
        }
      }
    }

    // 2. Extraer named imports: import { Foo, Bar } from './Target'
    const namedImportRegex = /import\s+(?:[a-zA-Z0-9_]+\s*,\s*)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g
    let nMatch
    while ((nMatch = namedImportRegex.exec(importerContent)) !== null) {
      const namedSpecs = nMatch[1]
      const spec = nMatch[2]
      if (!spec.startsWith('.') && !spec.startsWith('@/') && !spec.startsWith('~/')) continue

      const resolved = resolveLocalTarget(importerPath, spec)
      if (resolved && stagedContent.has(resolved)) {
        let targetCode = stagedContent.get(resolved)
        const items = namedSpecs.split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)

        for (const namedSymbol of items) {
          const hasNamedExport = new RegExp(`export\\s+(?:function|const|let|var|class)\\s+${namedSymbol}\\b|export\\s*\\{[^}]*\\b${namedSymbol}\\b[^}]*\\}`, 'm').test(targetCode)

          if (!hasNamedExport) {
            const hasSymbolDef = new RegExp(`(?:export\\s+default\\s+)?(?:function|const|class)\\s+${namedSymbol}\\b`, 'm').test(targetCode)
            if (hasSymbolDef) {
              targetCode = targetCode.trimEnd() + `\n\nexport { ${namedSymbol} };\n`
              stagedContent.set(resolved, targetCode)
              fixes.push(`Auto-agregado "export { ${namedSymbol} };" en "${resolved}" requerido por "${importerPath}"`)
            }
          }
        }
      }
    }
  }

  return fixes
}

/**
 * Extrae todos los especificadores de importación y exportación de un archivo de código
 */
export function extractImportSpecifiers(content) {
  if (!content || typeof content !== 'string') return []
  const specifiers = []
  
  // 1. import ... from 'specifier' o export ... from 'specifier'
  const staticRegex = /(?:import|export)\s+(?:[\w*\s{},]*\s+from\s+)?['"]([^'"]+)['"]/g
  let match
  while ((match = staticRegex.exec(content)) !== null) {
    if (match[1]) specifiers.push(match[1])
  }

  // 2. import('specifier') dinámico o require('specifier')
  const dynamicRegex = /(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  while ((match = dynamicRegex.exec(content)) !== null) {
    if (match[1]) specifiers.push(match[1])
  }

  return specifiers
}

/**
 * Valida todas las importaciones locales en los archivos en stagedContent contra el árbol del proyecto
 * @param {object} params
 * @param {Map<string, string>} params.stagedContent - Archivos modificados o nuevos
 * @param {string[]} params.projectFilesList - Lista de todos los archivos existentes en el proyecto
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateLocalImports({ stagedContent, projectFilesList = [] }) {
  const errors = []
  
  // Construir conjunto de todas las rutas de archivos disponibles (actuales + staged)
  const actualPaths = new Set()
  const lowerToActual = new Map()

  function registerPath(p) {
    const norm = normalizePosix(p)
    actualPaths.add(norm)
    lowerToActual.set(norm.toLowerCase(), norm)
  }

  for (const p of projectFilesList) {
    if (p) registerPath(p)
  }
  for (const p of stagedContent.keys()) {
    if (p) registerPath(p)
  }

  for (const [importerPath, content] of stagedContent.entries()) {
    const ext = path.extname(importerPath).toLowerCase()
    if (!CODE_EXTENSIONS.has(ext)) continue

    const specifiers = extractImportSpecifiers(content)
    const importerDir = path.dirname(importerPath).replace(/\\/g, '/')

    for (const spec of specifiers) {
      // Solo nos interesan importaciones locales (no paquetes npm bare)
      const isLocal = spec.startsWith('.') || spec.startsWith('@/') || spec.startsWith('~/')
      if (!isLocal) continue

      let resolvedBase = ''
      if (spec.startsWith('@/')) {
        resolvedBase = 'src/' + spec.slice(2)
      } else if (spec.startsWith('~/')) {
        resolvedBase = spec.slice(2)
      } else {
        resolvedBase = path.normalize(path.join(importerDir, spec)).replace(/\\/g, '/')
      }
      resolvedBase = normalizePosix(resolvedBase)

      let matchFound = false
      let caseMismatch = null

      for (const candidateExt of RESOLVE_EXTENSIONS) {
        const candidate = resolvedBase + candidateExt
        if (actualPaths.has(candidate)) {
          matchFound = true
          break
        }
        const candidateLower = candidate.toLowerCase()
        if (!caseMismatch && lowerToActual.has(candidateLower)) {
          caseMismatch = lowerToActual.get(candidateLower)
        }
      }

      if (matchFound) {
        continue
      }

      if (caseMismatch) {
        errors.push(
          `Discrepancia de mayúsculas/minúsculas en "${importerPath}": se importa "${spec}", pero el archivo real en disco es "${caseMismatch}". En servidores Linux/Docker esto causa fallo fatal (ERR_MODULE_NOT_FOUND). Corrige el import a "${caseMismatch}".`
        )
      } else {
        errors.push(
          `Archivo no encontrado para importación en "${importerPath}": se importa "${spec}" (resuelto como "${resolvedBase}"), pero no existe en el proyecto. Crea este archivo o ajusta la ruta del import.`
        )
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  }
}

/**
 * Ejecuta el guardián completo: auto-sana package.json, armoniza exports y valida importaciones locales
 */
export async function runImportGuard({ stagedContent, proposedChanges = [], existingPackageJsonContent, projectFilesList = [] }) {
  // 1. Auto-corrección de exports default vs named entre archivos en stagedContent
  const exportFixes = autoFixDefaultAndNamedExports(stagedContent, projectFilesList)

  // 2. Escudo y auto-sanación de íconos de lucide-react en todos los archivos de stagedContent
  const iconFixes = []
  for (const [filePath, content] of Array.from(stagedContent.entries())) {
    const ext = path.extname(filePath).toLowerCase()
    if (!CODE_EXTENSIONS.has(ext)) continue
    const { code: sanitizedCode, modified, fixes } = sanitizeLucideIcons(content)
    if (modified) {
      stagedContent.set(filePath, sanitizedCode)
      iconFixes.push(...fixes)
      const pIdx = proposedChanges.findIndex(c => c.path === filePath)
      if (pIdx !== -1) {
        proposedChanges[pIdx].newContent = sanitizedCode
      }
    }
  }

  // Sincronizar cualquier cambio de exportFixes en proposedChanges
  for (const [filePath, content] of stagedContent.entries()) {
    const pIdx = proposedChanges.findIndex(c => c.path === filePath)
    if (pIdx !== -1 && proposedChanges[pIdx].newContent !== content) {
      proposedChanges[pIdx].newContent = content
    }
  }

  // 3. Auto-sanación de dependencias externas en package.json
  const autoInjectResult = await autoInjectDependencies(stagedContent, proposedChanges, existingPackageJsonContent)

  // 4. Validación de importaciones locales y case-sensitivity para Linux/Docker
  const localValidation = validateLocalImports({ stagedContent, projectFilesList })

  return {
    autoInjectResult,
    localValidation,
    exportFixes,
    iconFixes
  }
}
