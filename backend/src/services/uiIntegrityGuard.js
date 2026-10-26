// backend/src/services/uiIntegrityGuard.js
// GUARDIÁN DE INTEGRIDAD DE INTERFAZ (FASE 6)
// 1. Detección Dinámica Universal de Entrypoint Scaffold (isEntrypointStillScaffold / inspectEntrypointScaffold)
// 2. Grafo Global de Alcance (Reachability Graph) desde App.jsx a todos los componentes
// 3. Detección de Componentes Huérfanos e Inalcanzables
// 4. Detección de Botones Mudos (Dead Buttons) sin 'onClick', sin 'type="submit"' y sin trigger interactivo

import path from 'node:path'
import fs from 'node:fs'
import { isWebOrLandingRequest } from './designDirector.js'
import { isSeoTarget, auditIndexHtmlSeo } from './seoArchitect.js'
import { isObsoleteProjectFile } from './projectReset.js'
import { UI_COMPONENTS_SEED } from './uiComponentsSeed.js'
import { KNOWN_LUCIDE_ICONS, LUCIDE_HALLUCINATIONS_MAP } from './importGuard.js'

const ROOT_CSS_NAMES = new Set([
  'src/index.css',
  'src/app.css',
  'src/styles/globals.css',
  'src/main.css',
  'index.css',
  'app.css',
  'styles/globals.css',
  'main.css'
]);

/**
 * Sanitiza hojas de estilo raíz para erradicar sintaxis incompatible de Tailwind v4
 * (@import "tailwindcss" y @theme { ... }) restaurando las directivas canónicas de Tailwind v3.
 * @param {string} filePath - Ruta del archivo
 * @param {string} content - Contenido de la hoja de estilo
 * @returns {string} - Contenido sanitizado
 */
export function sanitizeStylesheets(filePath, content) {
  if (!content || typeof content !== 'string') return content;

  const norm = (filePath || '')
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .toLowerCase();

  // Aplica únicamente a hojas de estilo CSS raíz
  if (!ROOT_CSS_NAMES.has(norm)) {
    return content;
  }

  let cleaned = content;

  // 1. Eliminar bloques @theme { ... } de Tailwind v4 con soporte de llaves balanceadas
  let themeMatch;
  while ((themeMatch = /@theme(?:\s+default)?\s*\{/i.exec(cleaned)) !== null) {
    const startIndex = themeMatch.index;
    let braceCount = 0;
    let endIndex = -1;
    for (let i = startIndex; i < cleaned.length; i++) {
      if (cleaned[i] === '{') braceCount++;
      else if (cleaned[i] === '}') {
        braceCount--;
        if (braceCount === 0) {
          endIndex = i + 1;
          break;
        }
      }
    }
    if (endIndex !== -1) {
      console.warn(`[uiIntegrityGuard:sanitizeStylesheets] Bloque @theme v4 eliminado en "${filePath}" por incompatibilidad con PostCSS/Tailwind v3.`);
      cleaned = cleaned.slice(0, startIndex) + cleaned.slice(endIndex);
    } else {
      break;
    }
  }

  // 2. Reemplazo de @import "tailwindcss" por las 3 directivas canónicas de Tailwind v3
  const tailwindImportRegex = /@import\s+['"]tailwindcss(?:[^'"]*)?['"]\s*;?/gi;
  if (tailwindImportRegex.test(cleaned)) {
    const hasCanonicalV3 =
      cleaned.includes('@tailwind base') ||
      cleaned.includes('@tailwind components') ||
      cleaned.includes('@tailwind utilities');

    if (!hasCanonicalV3) {
      cleaned = cleaned.replace(
        tailwindImportRegex,
        '@tailwind base;\n@tailwind components;\n@tailwind utilities;'
      );
      console.warn(`[uiIntegrityGuard:sanitizeStylesheets] Sustituido @import "tailwindcss" por directivas v3 en "${filePath}".`);
    } else {
      cleaned = cleaned.replace(tailwindImportRegex, '');
    }
  }

  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  return cleaned;
}

const NODE_BUILTIN_MODULES = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
  'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain',
  'events', 'fs', 'fs/promises', 'http', 'http2', 'https', 'inspector',
  'module', 'net', 'os', 'path', 'path/posix', 'path/win32', 'perf_hooks',
  'process', 'punycode', 'querystring', 'readline', 'repl', 'stream',
  'stream/promises', 'stream/web', 'string_decoder', 'timers', 'timers/promises',
  'tls', 'trace_events', 'tty', 'url', 'util', 'util/types', 'v8', 'vm', 'wasi',
  'worker_threads', 'zlib', 'test',
  // Pre-incluidos en templates Vite / React
  'react', 'react-dom', 'react/jsx-runtime'
]);

/**
 * Resuelve y parsea package.json a partir de una ruta o contenido.
 * @param {string|object} projectPathOrPackage
 * @returns {object|null}
 */
export function resolvePackageJson(projectPathOrPackage) {
  if (!projectPathOrPackage) return null;
  if (typeof projectPathOrPackage === 'object') {
    return projectPathOrPackage;
  }
  if (typeof projectPathOrPackage === 'string') {
    const trimmed = projectPathOrPackage.trim();
    if (trimmed.startsWith('{')) {
      try { return JSON.parse(trimmed); } catch { return null; }
    }
    try {
      let targetPath = projectPathOrPackage;
      if (fs.existsSync(targetPath)) {
        const stat = fs.statSync(targetPath);
        if (stat.isDirectory()) {
          targetPath = path.join(targetPath, 'package.json');
        }
        if (fs.existsSync(targetPath)) {
          const raw = fs.readFileSync(targetPath, 'utf-8');
          return JSON.parse(raw);
        }
      }
    } catch (_) {}
  }
  return null;
}

/**
 * Extrae el nombre canónico del paquete base de npm ignorando alias, rutas relativas y módulos nativos.
 * @param {string} specifier
 * @returns {string|null}
 */
export function extractBasePackageName(specifier) {
  if (!specifier || typeof specifier !== 'string') return null;
  const s = specifier.trim();

  // Ignorar rutas relativas, alias típicos de Vite/Next/TS y protocolos
  if (
    s.startsWith('.') ||
    s.startsWith('/') ||
    s.startsWith('\\') ||
    s.startsWith('@/') ||
    s.startsWith('~/') ||
    s.startsWith('#') ||
    s.startsWith('http:') ||
    s.startsWith('https:') ||
    s.startsWith('data:') ||
    s.startsWith('blob:') ||
    s.startsWith('node:') ||
    s.startsWith('virtual:') ||
    s.includes('?raw') ||
    s.includes('?url') ||
    s.includes('?worker')
  ) {
    return null;
  }

  // Paquete con scope (@scope/pkg o @scope/pkg/subpath)
  if (s.startsWith('@')) {
    const parts = s.split('/');
    if (parts.length >= 2) {
      const pkg = `${parts[0]}/${parts[1]}`;
      return NODE_BUILTIN_MODULES.has(pkg) ? null : pkg;
    }
    return null;
  }

  // Paquete estándar (pkg o pkg/subpath)
  const pkg = s.split('/')[0];
  if (NODE_BUILTIN_MODULES.has(pkg)) return null;
  return pkg;
}

/**
 * Extrae todos los paquetes externos importados (estática y dinámicamente) de un archivo.
 * @param {string} content
 * @returns {string[]}
 */
export function extractImportedPackages(content) {
  if (!content || typeof content !== 'string') return [];

  // Remover comentarios para evitar falsos positivos
  const codeWithoutComments = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '');

  const packages = new Set();

  // Imports estáticos: import ... from '...' o import '...' o export ... from '...'
  const staticImportRegex = /(?:import|export)\s+(?:[\w*\s{},]*\s+from\s+)?['"]([^'"]+)['"]/g;
  let match;
  while ((match = staticImportRegex.exec(codeWithoutComments)) !== null) {
    const pkg = extractBasePackageName(match[1]);
    if (pkg) packages.add(pkg);
  }

  // Imports dinámicos: import('...')
  const dynamicImportRegex = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = dynamicImportRegex.exec(codeWithoutComments)) !== null) {
    const pkg = extractBasePackageName(match[1]);
    if (pkg) packages.add(pkg);
  }

  return Array.from(packages);
}

/**
 * Valida que todos los imports externos requeridos por un archivo JS/TS existan en package.json.
 * @param {string} filePath - Ruta del archivo (.js, .jsx, .ts, .tsx)
 * @param {string} content - Contenido del archivo
 * @param {string|object} projectPath - Directorio del proyecto, ruta a package.json o contenido parseado
 * @returns {{ valid: boolean, missingPackages: string[], error?: string }}
 */
export function validateImportsAgainstPackageJson(filePath, content, projectPath) {
  const ext = path.extname(filePath || '').toLowerCase();
  if (!COMPONENT_EXTENSIONS.has(ext)) {
    return { valid: true, missingPackages: [] };
  }

  const pkgJson = resolvePackageJson(projectPath);
  if (!pkgJson) {
    // Si no se puede leer o no existe package.json, no bloquear
    return { valid: true, missingPackages: [] };
  }

  const installedDeps = new Set([
    ...Object.keys(pkgJson.dependencies || {}),
    ...Object.keys(pkgJson.devDependencies || {}),
    ...Object.keys(pkgJson.peerDependencies || {})
  ]);

  const importedPackages = extractImportedPackages(content);
  const missingPackages = [];

  for (const pkg of importedPackages) {
    if (!installedDeps.has(pkg)) {
      missingPackages.push(pkg);
    }
  }

  if (missingPackages.length > 0) {
    const firstMissing = missingPackages[0];
    const errorMsg = `Error de validación: El paquete '${firstMissing}' no está instalado en este proyecto. Utiliza las librerías existentes o solicita su instalación explícita.`;
    return {
      valid: false,
      missingPackages,
      error: errorMsg
    };
  }

  return {
    valid: true,
    missingPackages: []
  };
}

/**
 * Verificación Estática Pre-Escritura (Arnés de Prevención):
 * Intercepta componentes con importaciones rotas o íconos inexistentes ANTES de escribir el archivo en disco,
 * devolviendo un error descriptivo como tool_error para que el LLM lo corrija en la misma ronda sin romper la vista previa.
 *
 * @param {string} filePath - Ruta del archivo que se intenta crear/modificar
 * @param {string} content - Contenido propuesto
 * @param {object} context - Contexto del proyecto
 * @param {string[]} context.projectFiles - Lista de archivos existentes en el proyecto
 * @param {Map<string, string>|object} context.stagedContent - Archivos en memoria pendientes de escritura
 * @returns {{ valid: boolean, error?: string }}
 */
export function validatePreWriteComponent(filePath, content, { projectFiles = [], stagedContent = null } = {}) {
  if (!content || typeof content !== 'string') return { valid: true };

  const ext = path.extname(filePath || '').toLowerCase();
  const isComponent = ['.jsx', '.tsx', '.js', '.ts'].includes(ext);
  if (!isComponent) return { valid: true };

  const norm = (p) => (p || '').replace(/\\/g, '/').replace(/^\.?\//, '').toLowerCase();

  // 1. Verificación de imports de módulos propios de @/components/ui/
  const uiImportRegex = /import\s+(?:(?:\{[^}]*\}|\w+|\*\s+as\s+\w+)\s+from\s+)?['"]@\/components\/ui\/([^'"]+)['"]/g;
  let uiMatch;
  while ((uiMatch = uiImportRegex.exec(content)) !== null) {
    const rawModule = uiMatch[1].replace(/\.(jsx?|tsx?)$/, '').trim();
    if (!rawModule) continue;

    const baseName = rawModule.toLowerCase();
    const candidatePaths = [
      `src/components/ui/${baseName}.jsx`,
      `src/components/ui/${baseName}.tsx`,
      `src/components/ui/${baseName}.js`,
      `src/components/ui/${baseName}.ts`,
      `src/components/ui/${baseName}/index.jsx`,
      `src/components/ui/${baseName}/index.tsx`,
    ];

    let existsInStaged = false;
    if (stagedContent) {
      if (typeof stagedContent.has === 'function') {
        existsInStaged = candidatePaths.some((p) => stagedContent.has(p) || stagedContent.has(p.toLowerCase()));
      } else if (typeof stagedContent === 'object') {
        const stagedKeys = Object.keys(stagedContent).map(norm);
        existsInStaged = candidatePaths.some((p) => stagedKeys.includes(norm(p)));
      }
    }

    const projectFilesNorm = Array.isArray(projectFiles) ? projectFiles.map(norm) : [];
    const existsInProject = candidatePaths.some((p) => projectFilesNorm.includes(norm(p)));

    const seedKeys = Object.keys(UI_COMPONENTS_SEED || {}).map(norm);
    const existsInSeed = candidatePaths.some((p) => seedKeys.includes(norm(p)));

    if (!existsInStaged && !existsInProject && !existsInSeed) {
      return {
        valid: false,
        error: `Error de validación previa: El componente UI "@/components/ui/${rawModule}" no existe en el proyecto ni en el catálogo de componentes base. Utiliza los componentes UI disponibles o crea el archivo 'src/components/ui/${rawModule}.jsx' con propose_change antes de importarlo.`
      };
    }
  }

  // 2. Verificación de íconos de lucide-react
  const lucideRegex = /import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/g;
  let lucideMatch;
  while ((lucideMatch = lucideRegex.exec(content)) !== null) {
    const specifiers = lucideMatch[1].split(',').map((s) => s.trim()).filter(Boolean);
    for (const spec of specifiers) {
      const iconName = spec.split(/\s+as\s+/)[0].trim();
      if (!iconName) continue;

      const isKnown = KNOWN_LUCIDE_ICONS.has(iconName) || Boolean(LUCIDE_HALLUCINATIONS_MAP && LUCIDE_HALLUCINATIONS_MAP[iconName]);
      if (!isKnown) {
        return {
          valid: false,
          error: `Error de validación previa: El ícono "${iconName}" no existe en la librería lucide-react. Utiliza un ícono estándar válido de Lucide (ej: Sparkles, AlertCircle, Check, Wrench, Settings, ArrowRight) o reemplaza la importación.`
        };
      }
    }
  }

  return { valid: true };
}


/**
 * Sanitiza automáticamente el contenido de vite.config.* para remover
 * cualquier importación o plugin de @tailwindcss/vite no compatible con el entorno base.
 * @param {string} content
 * @returns {string}
 */
export function sanitizeViteConfig(content) {
  if (!content || typeof content !== 'string') return content;
  if (!content.includes('@tailwindcss/vite') && !content.includes('tailwindcss()')) return content;
  let cleaned = content;
  cleaned = cleaned.replace(/import\s+(?:tailwindcss|[A-Za-z0-9_$,\s*{}\s*]+)\s+from\s+['"]@tailwindcss\/vite['"]\s*;?/g, '');
  cleaned = cleaned.replace(/tailwindcss\s*\([^)]*\)\s*,?/g, '');
  cleaned = cleaned.replace(/\[\s*,/g, '[').replace(/,\s*,/g, ',').replace(/,\s*\]/g, ']');
  cleaned = cleaned.replace(/\n\s*\n\s*\n/g, '\n\n');
  return cleaned;
}

const COMPONENT_EXTENSIONS = new Set(['.jsx', '.tsx', '.js', '.ts'])

function normalizePath(p) {
  return (p || '').replace(/\\/g, '/').replace(/^\.\//, '')
}

/**
 * Extrae el nombre canónico del componente a partir de la ruta y el contenido
 */
function extractComponentName(filePath, content) {
  const norm = normalizePath(filePath)
  const baseName = path.basename(norm, path.extname(norm))

  if (baseName.toLowerCase() === 'index') {
    const parentDir = path.basename(path.dirname(norm))
    return parentDir || 'IndexComponent'
  }

  // Buscar export default function Nombre
  const defaultFuncMatch = /export\s+default\s+function\s+([A-Z][A-Za-z0-9_]*)/.exec(content)
  if (defaultFuncMatch) return defaultFuncMatch[1]

  // Buscar export const Nombre = ...
  const namedConstMatch = /export\s+const\s+([A-Z][A-Za-z0-9_]*)\s*=/.exec(content)
  if (namedConstMatch) return namedConstMatch[1]

  // Buscar export default Nombre
  const defaultIdentMatch = /export\s+default\s+([A-Z][A-Za-z0-9_]*)/.exec(content)
  if (defaultIdentMatch) return defaultIdentMatch[1]

  return baseName
}

/**
 * Determina dinámicamente si el código de un entrypoint (App.jsx / App.tsx)
 * sigue en estado de plantilla inicial vacía (scaffold).
 * @param {string} content
 * @returns {boolean}
 */
export function isEntrypointStillScaffold(content) {
  if (!content || typeof content !== 'string') return true
  const trimmed = content.trim()
  if (trimmed.length === 0) return true

  // 1. Marcadores textuales inequívocos de plantilla vacía inicial
  if (/este proyecto se est[aá] construyendo/i.test(trimmed)) return true
  if (/p[ií]dele a la ia lo que necesites/i.test(trimmed)) return true
  if (/bienvenido a tu nuevo proyecto/i.test(trimmed)) return true

  // 2. Análisis estructural de líneas efectivas (sin comentarios ni líneas en blanco)
  const codeWithoutComments = trimmed
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')

  const effectiveLines = codeWithoutComments
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  if (effectiveLines.length < 35) {
    // ¿Importa algún componente hijo local de componentes/páginas/vistas?
    const hasLocalChildImports =
      /(?:import\s+(?:\{[^}]+\}|[A-Za-z0-9_$,\s*]+)\s+from\s+|import\s*\(?\s*)['"](?:\.|\.\.|\@|\~)\/(?:components|pages|views|features|modules)\/[^'"]+['"]/i.test(codeWithoutComments) ||
      /(?:from|import\s*\(?\s*)['"]\.[^'"]*\.(?:jsx|tsx)['"]/i.test(codeWithoutComments)

    // ¿Tiene estado interactivo, hooks o llamadas a datos?
    const hasInteractiveStateOrData =
      /\b(?:useState|useReducer|useEffect|useQuery|useContext|useMemo|useCallback)\b/.test(codeWithoutComments) ||
      /\b(?:db\.from|supabase\.from|fetch\(|axios\.)/.test(codeWithoutComments) ||
      /\bon[A-Z][a-zA-Z]*\s*=/.test(codeWithoutComments)

    // Si tiene menos de 35 líneas y no importa ningún componente local ni tiene interactividad ni datos,
    // se trata del contenedor scaffold inicial
    if (!hasLocalChildImports && !hasInteractiveStateOrData) {
      return true
    }
  }

  return false
}

/**
 * Inspecciona el estado del entrypoint del proyecto (App.jsx / App.tsx)
 * combinando archivos propuestos (staged) y archivos existentes del proyecto.
 * @param {object} params
 * @param {Map<string, string>|object} [params.stagedContent]
 * @param {string[]} [params.projectFilesList]
 * @param {Function} [params.readProjectFile]
 * @param {object} [params.filesMap]
 * @returns {Promise<{ isScaffold: boolean, entryPath: string, content: string, source: string }>}
 */
export async function inspectEntrypointScaffold({
  stagedContent = null,
  projectFilesList = [],
  readProjectFile = null,
  filesMap = null
} = {}) {
  const candidateEntrypoints = [
    'src/App.jsx',
    'src/App.tsx',
    'src/App.js',
    'App.jsx',
    'App.tsx',
    'App.js'
  ]

  const getFromStaged = (p) => {
    if (!stagedContent) return null
    if (stagedContent instanceof Map) return stagedContent.get(p)
    return stagedContent[p] || null
  }

  const getFromFilesMap = (p) => {
    if (!filesMap) return null
    return filesMap[p]?.content || filesMap[p] || null
  }

  // 1. Buscar primero en stagedContent (lo que el agente acaba de proponer)
  for (const ep of candidateEntrypoints) {
    const code = getFromStaged(ep)
    if (code != null) {
      const isScaffold = isEntrypointStillScaffold(code)
      return { isScaffold, entryPath: ep, content: code, source: 'staged' }
    }
  }

  // 2. Buscar en filesMap
  for (const ep of candidateEntrypoints) {
    const code = getFromFilesMap(ep)
    if (code != null) {
      const isScaffold = isEntrypointStillScaffold(code)
      return { isScaffold, entryPath: ep, content: code, source: 'filesMap' }
    }
  }

  // 3. Buscar en projectFilesList y leer con readProjectFile
  const projectSet = new Set((projectFilesList || []).map(normalizePath))
  if (readProjectFile) {
    for (const ep of candidateEntrypoints) {
      const normEp = normalizePath(ep)
      if (projectSet.has(normEp)) {
        try {
          const fileCode = await readProjectFile(normEp)
          if (fileCode != null) {
            const isScaffold = isEntrypointStillScaffold(fileCode)
            return { isScaffold, entryPath: ep, content: fileCode, source: 'project' }
          }
        } catch (_) {}
      }
    }
  }

  // Si no se encuentra ningún entrypoint, se asume scaffold pendiente
  return { isScaffold: true, entryPath: 'src/App.jsx', content: '', source: 'none' }
}

/**
 * Resuelve una ruta de importación local relativa al archivo importador
 */
function resolveImportPath(fromFile, importSpecifier, knownFilesSet) {
  if (!importSpecifier || typeof importSpecifier !== 'string') return null
  const cleanSpec = importSpecifier.trim()

  let candidate = null
  if (cleanSpec.startsWith('@/')) {
    candidate = 'src/' + cleanSpec.slice(2)
  } else if (cleanSpec.startsWith('~/')) {
    candidate = 'src/' + cleanSpec.slice(2)
  } else if (cleanSpec.startsWith('./') || cleanSpec.startsWith('../')) {
    const dir = path.dirname(fromFile)
    candidate = normalizePath(path.join(dir, cleanSpec))
  } else {
    // Módulo de npm (react, lucide-react, etc.)
    return null
  }

  candidate = normalizePath(candidate)

  // 1. Coincidencia directa
  if (knownFilesSet.has(candidate)) return candidate

  // 2. Intentar extensiones estándar
  const extensions = ['.jsx', '.tsx', '.js', '.ts', '/index.jsx', '/index.tsx', '/index.js', '/index.ts']
  for (const ext of extensions) {
    const full = candidate + ext
    if (knownFilesSet.has(full)) return full
  }

  // 3. Búsqueda por prefijo si falta extensión
  for (const known of knownFilesSet) {
    if (known.startsWith(candidate) && (known === candidate + '.jsx' || known === candidate + '.tsx')) {
      return known
    }
  }

  return null
}

/**
 * Construye el grafo de alcance (Reachability Graph) desde App.jsx y main.jsx
 * utilizando búsqueda en amplitud (BFS).
 */
export async function buildReachabilityGraph({
  entryPoints = ['src/App.jsx', 'src/App.tsx', 'src/main.jsx', 'src/main.tsx', 'App.jsx', 'App.tsx'],
  referenceTexts = new Map(),
  knownFilesSet = new Set(),
  readProjectFile = null
}) {
  const reachableFiles = new Set()
  const queue = []

  for (const ep of entryPoints) {
    const norm = normalizePath(ep)
    if (referenceTexts.has(norm) || knownFilesSet.has(norm)) {
      reachableFiles.add(norm)
      queue.push(norm)
    }
  }

  const importRegex = /(?:import\s+(?:\{[^}]+\}|[A-Za-z0-9_$,\s*]+)\s+from\s+|import\s*\(\s*|React\.lazy\s*\(\s*\(\)\s*=>\s*import\s*\(\s*)['"]([^'"]+)['"]/g

  while (queue.length > 0) {
    const current = queue.shift()
    let content = referenceTexts.get(current)

    if (!content && readProjectFile && knownFilesSet.has(current)) {
      try {
        content = await readProjectFile(current)
        if (content) referenceTexts.set(current, content)
      } catch (_) {}
    }

    if (!content || typeof content !== 'string') continue

    let match
    importRegex.lastIndex = 0
    while ((match = importRegex.exec(content)) !== null) {
      const spec = match[1]
      const resolved = resolveImportPath(current, spec, knownFilesSet)
      if (resolved && !reachableFiles.has(resolved)) {
        reachableFiles.add(resolved)
        queue.push(resolved)
      }
    }
  }

  return reachableFiles
}

/**
 * Escanea archivos en búsqueda de botones mudos (sin onClick, sin submit, sin trigger)
 */
export function scanDeadButtons(filePath, content) {
  if (!content || typeof content !== 'string') return []
  const ext = path.extname(filePath).toLowerCase()
  if (!COMPONENT_EXTENSIONS.has(ext)) return []

  const deadButtons = []
  const buttonRegex = /<button\b([^>]*?)>(.*?)<\/button>/gis

  let match
  while ((match = buttonRegex.exec(content)) !== null) {
    const attrs = match[1] || ''
    const children = match[2] || ''
    const matchIndex = match.index

    // 1. Verificar si tiene onClick o equivalente interactivo
    const hasClick = /\bon(?:Click|Press|MouseDown|PointerDown)\s*=/i.test(attrs)
    if (hasClick) continue

    // 2. Verificar si es botón de submit o reset
    const hasSubmitOrReset = /type\s*=\s*['"](?:submit|reset)['"]/i.test(attrs)
    if (hasSubmitOrReset) continue

    // 3. Verificar si tiene formAction
    const hasFormAction = /\bformAction\s*=/i.test(attrs)
    if (hasFormAction) continue

    // 4. Verificar si es disparador de modal Radix/shadcn (asChild en Trigger previo)
    const contextBefore = content.slice(Math.max(0, matchIndex - 300), matchIndex)
    const isTriggerChild = /<(?:Dialog|Popover|DropdownMenu|Sheet|AlertDialog|Tooltip|Menu)Trigger\b[^>]*asChild[^>]*>\s*$/i.test(contextBefore)
    if (isTriggerChild) continue

    // 5. Verificar si está envuelto inmediatamente en un <Link o <a
    const isLinkChild = /<(?:Link|a)\b[^>]*>\s*$/i.test(contextBefore)
    if (isLinkChild) continue

    // Limpiar texto visible del botón
    const rawLabel = children.replace(/<[^>]+>/g, '').trim()
    const cleanLabel = (rawLabel.replace(/\s+/g, ' ') || 'Botón sin texto').slice(0, 35)

    deadButtons.push({
      file: filePath,
      label: cleanLabel,
      snippet: match[0].slice(0, 80)
    })
  }

  return deadButtons
}

/**
 * Valida la integridad UI global:
 * 1. Inspección Dinámica Universal del Entrypoint (App.jsx)
 * 2. Grafo Global de Alcance (Reachability Graph)
 * 3. Componentes Huérfanos e Inalcanzables
 * 4. Botones Mudos (Dead Buttons)
 *
 * @param {object} params
 * @param {Map<string, string>|object} params.stagedContent - Contenido de archivos modificados/creados
 * @param {Array<{ type: string, path: string }>} [params.proposedChanges] - Cambios de código propuestos
 * @param {Array<{ sql: string, summary?: string }>} [params.proposedDbChanges] - Migraciones SQL propuestas
 * @param {string[]} [params.projectFilesList] - Lista de archivos existentes
 * @param {string} [params.userMessage] - Mensaje o requerimiento del usuario
 * @returns {Promise<{ valid: boolean, errors: string[], warnings: string[], seoAdvisories: string[], orphanComponents: string[], deadButtons: Array }>}
 */
export async function validateUiIntegrity({
  stagedContent,
  proposedChanges = [],
  proposedDbChanges = [],
  projectFilesList = [],
  readProjectFile = null,
  userMessage = '',
  isProjectResetOrder = false,
  agentTouchedThisTurn = null, // opcional: Set/array de paths que el agente tocó a lo largo de TODO el turno (cross-intento)
}) {
  const errors = []
  const orphanComponents = []
  const allDeadButtons = []

  // Durante un reinicio de proyecto, filtrar cualquier archivo obsoleto del proyecto anterior
  const effectiveProjectFiles = isProjectResetOrder
    ? (projectFilesList || []).filter(p => !isObsoleteProjectFile(p))
    : (projectFilesList || [])

  const projectSet = new Set(effectiveProjectFiles.map(normalizePath))

  const stagedMap = stagedContent instanceof Map
    ? stagedContent
    : new Map(Object.entries(stagedContent || {}))

  const knownFilesSet = new Set([...projectSet, ...[...stagedMap.keys()].map(normalizePath)])

  // Sanitización obligatoria de vite.config.* contra @tailwindcss/vite no instalado
  for (const [p, content] of stagedMap.entries()) {
    if (/(?:^|\/)vite\.config\.(?:js|ts|mjs)$/i.test(p) && typeof content === 'string' && content.includes('@tailwindcss/vite')) {
      const cleaned = sanitizeViteConfig(content);
      stagedMap.set(p, cleaned);
      if (stagedContent instanceof Map) stagedContent.set(p, cleaned);
      const pc = (proposedChanges || []).find(x => x.path === p);
      if (pc) pc.newContent = cleaned;
    }
  }


  const referenceTexts = new Map()
  for (const [p, content] of stagedMap.entries()) {
    referenceTexts.set(normalizePath(p), content)
  }

  const commonEntryPoints = ['src/App.jsx', 'src/App.tsx', 'src/main.jsx', 'src/main.tsx', 'App.jsx', 'App.tsx']
  if (readProjectFile) {
    for (const ep of commonEntryPoints) {
      const normEp = normalizePath(ep)
      if (!referenceTexts.has(normEp) && projectSet.has(normEp)) {
        try {
          const epContent = await readProjectFile(normEp)
          if (epContent) referenceTexts.set(normEp, epContent)
        } catch (_) {}
      }
    }
  }

  // 1. Inspección Dinámica Universal del Entrypoint (App.jsx)
  const entryInspection = await inspectEntrypointScaffold({
    stagedContent: stagedMap,
    projectFilesList: effectiveProjectFiles,
    readProjectFile
  })

  // 2. Identificar componentes creados o modificados en src/components/, src/pages/, src/views/
  const createdComponentPaths = []
  // Set normalizado de los paths que el agente tocó a lo largo de TODO el turno (cross-intento).
  // Si el caller nos lo pasa, lo usamos para que en reintentos >= 2 — cuando los archivos ya
  // quedaron aplicados y por lo tanto ya están en projectSet — sigamos considerando esos
  // componentes como "creados en este turno" y mantengamos activo el bloqueo del entrypoint.
  const crossTurnTouched = new Set(
    Array.isArray(agentTouchedThisTurn)
      ? agentTouchedThisTurn.map(normalizePath)
      : agentTouchedThisTurn instanceof Set
        ? [...agentTouchedThisTurn].map(normalizePath)
        : []
  )
  for (const [p, content] of stagedMap.entries()) {
    const norm = normalizePath(p)
    const ext = path.extname(norm).toLowerCase()
    if (!COMPONENT_EXTENSIONS.has(ext)) continue

    const isComponentDir = norm.startsWith('src/components/') || norm.startsWith('src/pages/') || norm.startsWith('src/views/') || norm.startsWith('src/data/')
    const isUiPrimitive = norm.startsWith('src/components/ui/')
    if (!isComponentDir || isUiPrimitive) continue

    const proposedEntry = proposedChanges.find((c) => normalizePath(c.path) === norm)
    // Solo auditar componentes o catálogos creados en el turno actual (createdInCurrentTurn).
    // NUNCA auditar componentes previos existentes como huérfanos.
    // El OR con crossTurnTouched es la pieza clave del fix: si el agente tocó este path en
    // cualquier intento previo de este turno, sigue contando como "creado en este turno"
    // aunque ya esté en projectSet (porque el applyCodeChanges de intentos anteriores lo
    // dejó aplicado). Sin esto, garantía 1 se "apagaba" en reintentos y dejaba pasar turnos
    // que no actualizaban App.jsx — caso real visto en la conversación d719af1c... donde
    // quedaron 7 componentes huérfanos.
    const isCreatedInCurrentTurn = proposedEntry && (
      proposedEntry.type === 'create' ||
      proposedEntry.isNew ||
      (!projectSet.has(norm) && !isProjectResetOrder) ||
      crossTurnTouched.has(norm)
    )

    if (isCreatedInCurrentTurn) {
      createdComponentPaths.push({ path: norm, content })
    } else if (isProjectResetOrder && proposedEntry && (proposedEntry.type === 'create' || proposedEntry.isNew)) {
      createdComponentPaths.push({ path: norm, content })
    }
  }

  const hasStagedComponents = [...stagedMap.keys()].some((p) => {
    const norm = normalizePath(p)
    return (norm.startsWith('src/components/') || norm.startsWith('src/pages/') || norm.startsWith('src/views/') || norm.startsWith('src/data/')) && !norm.startsWith('src/components/ui/')
  })
  const hasDbChanges = Array.isArray(proposedDbChanges) && proposedDbChanges.length > 0

  // 🚨 GARANTÍA 1: Bloqueo si el entrypoint sigue siendo un scaffold vacío pero se crearon tablas o componentes
  if (entryInspection.isScaffold && (createdComponentPaths.length > 0 || hasStagedComponents || hasDbChanges)) {
    errors.push(
      '🚨 ERROR ESTRUCTURAL: Has creado tablas o componentes, pero el entrypoint principal (src/App.jsx) sigue mostrando la plantilla vacía inicial. Es OBLIGATORIO actualizar src/App.jsx en este mismo turno usando propose_change para importar y montar la interfaz completa antes de finalizar.'
    )
  }

  // 🚨 GARANTÍA 1.5: Bloqueo si se creó o modificó src/data/servicesData.* o src/components/Navbar.* pero App.jsx no los integra
  const touchedServicesData = [...stagedMap.keys(), ...crossTurnTouched].find(p => /src\/data\/servicesData\.(js|ts|jsx|json)/i.test(normalizePath(p)))
  const touchedNavbar = [...stagedMap.keys(), ...crossTurnTouched].find(p => /src\/components\/Navbar\.(jsx|tsx|js)/i.test(normalizePath(p)))
  if (touchedServicesData || touchedNavbar) {
    const currentAppContent = stagedMap.get('src/App.jsx') || stagedMap.get('src/App.tsx') || referenceTexts.get('src/App.jsx') || ''
    const hasServicesImport = /servicesData|from\s+['"][^'"]*servicesData['"]/i.test(currentAppContent)
    const hasNavbarImport = /Navbar|from\s+['"][^'"]*Navbar['"]/i.test(currentAppContent)
    if (touchedServicesData && !hasServicesImport) {
      errors.push(
        '🚨 ERROR DE INTEGRACIÓN: Has creado src/data/servicesData.js, pero NO está importado ni utilizado en src/App.jsx. Es OBLIGATORIO actualizar src/App.jsx para consumir los datos de servicios y montar las vistas o tarjetas correspondientes.'
      )
    }
    if (touchedNavbar && !hasNavbarImport) {
      errors.push(
        '🚨 ERROR DE INTEGRACIÓN: Has creado src/components/Navbar.jsx, pero NO está montado en src/App.jsx. Es OBLIGATORIO actualizar src/App.jsx para renderizar el Navbar.'
      )
    }
  }

  // 🚨 GARANTÍA 2: Verificación Global del Árbol de Alcance (Reachability Graph)
  const reachableFiles = await buildReachabilityGraph({
    entryPoints: commonEntryPoints,
    referenceTexts,
    knownFilesSet,
    readProjectFile
  })

  for (const { path: compPath, content: compContent } of createdComponentPaths) {
    // Excluir página de 404 de scaffold si viene de la plantilla inicial
    if (compPath === 'src/pages/NotFound.jsx') continue

    const isReachable = reachableFiles.has(compPath)

    if (!isReachable) {
      // Fallback heurístico: verificar si se importa y usa en algún archivo del árbol de referencia
      const compName = extractComponentName(compPath, compContent)
      const baseNameNoExt = path.basename(compPath, path.extname(compPath))
      let hasHeuristicRef = false

      for (const [refPath, refContent] of referenceTexts.entries()) {
        if (refPath === compPath) continue
        const importRegex = new RegExp(`\\bimport\\s+.*\\b${compName}\\b.*\\bfrom\\b`, 'i')
        const importPathRegex = new RegExp(`from\\s+['"][^'"]*${baseNameNoExt}['"]`, 'i')
        const jsxTagRegex = new RegExp(`<${compName}\\b`, 'i')
        const routerRefRegex = new RegExp(`(?:element|component|Component)\\s*:\\s*(?:<${compName}|${compName})`, 'i')
        if ((importRegex.test(refContent) || importPathRegex.test(refContent)) && (jsxTagRegex.test(refContent) || routerRefRegex.test(refContent))) {
          hasHeuristicRef = true
          break
        }
      }

      if (!hasHeuristicRef) {
        orphanComponents.push(compPath)
        errors.push(
          `⚠️ COMPONENTE HUÉRFANO DETECTADO (INALCANZABLE): '${compPath}' fue creado pero no es alcanzable desde el árbol de componentes ni montado en App.jsx. Es OBLIGATORIO importarlo y renderizarlo en App.jsx o en una de sus vistas secundarias para que el usuario pueda interactuar con él.`
        )
      }
    }
  }

  // 3. Detección de Botones Mudos (Dead Buttons) en todos los archivos modificados
  for (const [p, content] of stagedMap.entries()) {
    const deadInFile = scanDeadButtons(p, content)
    for (const db of deadInFile) {
      allDeadButtons.push(db)
      errors.push(
        `⚠️ BOTÓN MUDO DETECTADO en '${db.file}': El botón con texto "${db.label}" no tiene 'onClick' ni 'type="submit"'. Conéctale un manejador funcional o abre el modal correspondiente.`
      )
    }
  }

  // 4. Verificación de Visibilidad Luminosa en Hero (evitar fotos casi invisibles como opacity-25 con fondo negro)
  for (const [p, content] of stagedMap.entries()) {
    if (/Hero\.(jsx|tsx)/i.test(p) || (p.startsWith('src/components/') && /hero/i.test(content))) {
      if (/\bopacity-(?:10|15|20|25|30|35|40)\b/.test(content) && /from-zinc-950|bg-black|from-black/i.test(content)) {
        errors.push(
          `⚠️ VISIBILIDAD DE HERO DEFICIENTE en '${p}': La imagen de fondo del Hero tiene opacidad excesivamente baja (opacity-10 a opacity-40) combinada con un overlay oscuro, lo que oscurece el banner haciéndolo ver casi negro. Corrige la imagen a 'opacity-65' a 'opacity-90' (o un gradiente más suave 'from-zinc-950/80 via-zinc-950/60 to-zinc-950/35') para que la fotografía resalte con nitidez.`
        )
      }
    }
  }

  // 4. Auto-Auditoría de SEO y Diseño (sin bloquear nunca el guardado)
  let indexHtml = stagedMap.get('index.html')
  if (!indexHtml && typeof readProjectFile === 'function') {
    try {
      indexHtml = await readProjectFile('index.html')
    } catch (_) {}
  }
  const mainAppContent = stagedMap.get('src/App.jsx') || stagedMap.get('src/App.tsx') || referenceTexts.get('src/App.jsx') || ''

  const seoDesignAudit = auditWebSeoAndDesign({
    indexHtmlContent: indexHtml || '',
    appContent: mainAppContent,
    userMessage
  })

  const seoAdvisories = seoDesignAudit.advisories

  return {
    valid: errors.length === 0,
    errors,
    warnings: seoAdvisories,
    seoAdvisories,
    orphanComponents,
    deadButtons: allDeadButtons
  }
}

/**
 * Audita la calidad de SEO y diseño semántico en index.html y App.jsx
 * @param {object} params
 * @param {string} params.indexHtmlContent - Contenido de index.html
 * @param {string} params.appContent - Contenido de src/App.jsx
 * @param {string} params.userMessage - Mensaje original del usuario
 * @returns {{ isWebProject: boolean, needsIndexHtmlOptimization: boolean, missingSemantics: boolean, advisories: string[] }}
 */
export function auditWebSeoAndDesign({ indexHtmlContent = '', appContent = '', userMessage = '' } = {}) {
  const isWebProject = isWebOrLandingRequest(userMessage) || isSeoTarget(userMessage) || /<header|<section|<footer|bento/i.test(appContent)
  const advisories = []
  let needsIndexHtmlOptimization = false
  let missingSemantics = false

  if (indexHtmlContent) {
    const seoAudit = auditIndexHtmlSeo(indexHtmlContent)
    if (!seoAudit.valid) {
      needsIndexHtmlOptimization = true
      advisories.push(
        `💡 OPTIMIZACIÓN SEO PENDIENTE EN index.html: ${seoAudit.issues.join(', ')}. Recuerda actualizar index.html con un <title> optimizado del negocio, <meta name="description">, Open Graph (og:title, og:description, og:image) y datos estructurados Schema.org JSON-LD (<script type="application/ld+json">).`
      )
    }
  }

  if (appContent) {
    const hasSemanticTags = /<(?:header|nav|main|section|article|footer)\b/i.test(appContent)
    const hasH1 = /<h1\b/i.test(appContent)

    if (!hasSemanticTags || !hasH1) {
      missingSemantics = true
      const missing = []
      if (!hasSemanticTags) missing.push('etiquetas semánticas (<header>, <nav>, <main>, <section>, <footer>)')
      if (!hasH1) missing.push('un único encabezado <h1> con la intención de búsqueda principal')
      advisories.push(
        `💡 MEJORA SEMÁNTICA HTML5: En src/App.jsx falta incorporar ${missing.join(' y ')}. Evita "div-soup" para maximizar la indexabilidad y posicionamiento en Google 2026.`
      )
    }
  }

  return {
    isWebProject,
    needsIndexHtmlOptimization,
    missingSemantics,
    advisories
  }
}
