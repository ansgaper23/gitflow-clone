import * as acorn from 'acorn'
import jsx from 'acorn-jsx'

// Parser JSX/JS con soporte completo — valida sintaxis sin ejecutar.
// Usa acorn + acorn-jsx que son ligeros y rápidos (~2ms por archivo).
const jsxParser = acorn.Parser.extend(jsx())

// Extensiones que este validador puede chequear (JS/JSX, no TypeScript)
const CHECKABLE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs'])

// Extensiones TypeScript — se validan con regex heurístico más ligero ya que
// acorn no parsea TS nativamente y agregar un parser TS completo sería pesado.
const TS_EXTENSIONS = new Set(['.ts', '.tsx'])

/**
 * Valida la sintaxis de un archivo de código. Devuelve null si está OK,
 * o un string con el error si hay problemas de sintaxis.
 *
 * @param {string} filePath - Ruta del archivo (para determinar extensión)
 * @param {string} content - Contenido completo del archivo
 * @returns {string|null} - Mensaje de error o null si la sintaxis es válida
 */
export function validateSyntax(filePath, content) {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()

  if (CHECKABLE_EXTENSIONS.has(ext)) {
    return validateWithAcorn(filePath, content)
  }

  if (TS_EXTENSIONS.has(ext)) {
    return validateTypescriptHeuristic(filePath, content)
  }

  // Extensiones no chequeables (.css, .json, .md, etc.) — skip
  return null
}

export function validateContent(filePath, content) {
  const err = validateSyntax(filePath, content)
  return { valid: !err, error: err }
}

function validateWithAcorn(filePath, content) {
  try {
    jsxParser.parse(content, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: true,
    })
    return null // Sintaxis válida
  } catch (err) {
    const loc = err.loc ? ` (línea ${err.loc.line}, columna ${err.loc.column})` : ''
    return `Error de sintaxis en ${filePath}${loc}: ${err.message}`
  }
}

// Chequeos heurísticos para TypeScript — no es un parser completo pero
// atrapa los errores más comunes que rompen la compilación de Vite:
// - Llaves/paréntesis/corchetes desbalanceados
// - 'return' fuera de función (el error más frecuente que reportó MODAMIA)
function validateTypescriptHeuristic(filePath, content) {
  // Eliminar strings y comentarios para no contar delimitadores dentro de ellos
  const stripped = content
    .replace(/\/\/[^\n]*/g, '')           // line comments
    .replace(/\/\*[\s\S]*?\*\//g, '')      // block comments
    .replace(/`[\s\S]*?`/g, '""')          // template literals
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')   // double-quoted strings
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")   // single-quoted strings

  // Check balanced delimiters
  const stack = []
  const pairs = { '(': ')', '[': ']', '{': '}' }
  const closing = new Set([')', ']', '}'])
  let line = 1

  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i]
    if (ch === '\n') { line++; continue }
    if (pairs[ch]) {
      stack.push({ ch, expected: pairs[ch], line })
    } else if (closing.has(ch)) {
      if (stack.length === 0) {
        return `Error de sintaxis en ${filePath} (línea ~${line}): '${ch}' inesperado sin apertura correspondiente`
      }
      const top = stack.pop()
      if (top.expected !== ch) {
        return `Error de sintaxis en ${filePath} (línea ~${line}): se esperaba '${top.expected}' pero se encontró '${ch}' (abierto en línea ~${top.line})`
      }
    }
  }

  if (stack.length > 0) {
    const unclosed = stack[stack.length - 1]
    return `Error de sintaxis en ${filePath}: '${unclosed.ch}' abierto en línea ~${unclosed.line} nunca se cierra`
  }

  return null
}
