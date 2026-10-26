// backend/src/services/fuzzyPatcher.js
// MOTOR DE PARCHEO RESILIENTE Y DETECTOR DE CÓDIGO TRUNCADO (FLOWPRO)

import { validateSyntax } from './syntaxValidator.js'

const TRUNCATION_MARKERS = [
  /\/\/\s*\.{3,}\s*(rest|existing|remain|c[oó]digo|keep|anterior|dem[aá]s|igual)/i,
  /\/\*\s*\.{3,}\s*(rest|existing|remain|c[oó]digo|keep|anterior|dem[aá]s|igual)[\s\S]*?\*\//i,
  /\/\/\s*\.{3,}\s*$/m,
  /\/\*\s*\.{3,}\s*\*\//m,
  /\/\/\s*TODO:\s*(rest|implement|add the rest)/i,
  /\/\/\s*(el resto del c[oó]digo sigue igual|sin cambios|queda igual)/i,
  /<!--\s*\.{3,}\s*(rest|existing|dem[aá]s|igual)[\s\S]*?-->/i,
];

/**
 * Detecta si el nuevo contenido contiene marcadores de truncado
 * o una reducción destructiva no justificada sobre un archivo preexistente.
 */
export function isTruncatedOrDestructive(filePath, originalContent, newContent, { isReset = false } = {}) {
  if (!newContent || typeof newContent !== 'string') {
    return { isDestructive: true, reason: 'El contenido propuesto está vacío o no es una cadena válida.' };
  }

  // 1. Detección de marcadores explícitos de código truncado (siempre activa)
  for (const pattern of TRUNCATION_MARKERS) {
    if (pattern.test(newContent)) {
      return {
        isDestructive: true,
        reason: `Se detectaron comentarios de código truncado (ej. "// ... rest of code" o similares) en "${filePath}".`
      };
    }
  }

  // 2. Detección de reducción drástica no justificada (>70% de reducción en archivos con más de 30 líneas)
  // Se omite durante reinicios de proyecto (isReset = true) para permitir construir nuevas aplicaciones desde cero
  if (!isReset && originalContent && typeof originalContent === 'string') {
    const origLines = originalContent.split(/\r?\n/).filter(l => l.trim().length > 0);
    const newLines = newContent.split(/\r?\n/).filter(l => l.trim().length > 0);

    if (origLines.length >= 30 && newLines.length < origLines.length * 0.3) {
      const hadExports = /(export\s+default|export\s+(const|function|class|type|interface))/i.test(originalContent);
      const hasExports = /(export\s+default|export\s+(const|function|class|type|interface))/i.test(newContent);

      // Si el código es sintácticamente válido (AST OK vía validateSyntax) y preserva exports (o no tenía), se permite la reducción limpia
      let isAstValid = true;
      try {
        if (typeof validateSyntax === 'function') {
          const syntaxErr = validateSyntax(filePath, newContent);
          if (syntaxErr) isAstValid = false;
        }
      } catch (_) {}

      // Solo bloquear si la sintaxis está rota, se destruyeron exports esenciales, o la reducción es extrema (<10%) sin orden de reset
      if (!isAstValid || (!hasExports && hadExports) || newLines.length < origLines.length * 0.1) {
        return {
          isDestructive: true,
          reason: `El contenido propuesto para "${filePath}" reduce destructivamente el archivo (${origLines.length} -> ${newLines.length} líneas).`
        };
      }
    }
  }

  return { isDestructive: false };
}

/**
 * Calcula la distancia de Levenshtein entre dos cadenas de texto.
 */
function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const d = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,      // borrado
        d[i][j - 1] + 1,      // inserción
        d[i - 1][j - 1] + cost // sustitución
      );
    }
  }
  return d[m][n];
}

/**
 * Calcula similitud normalizada [0.0 - 1.0] entre dos cadenas.
 */
function stringSimilarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1.0;
  const dist = levenshteinDistance(a, b);
  return 1.0 - dist / maxLen;
}

/**
 * Normaliza saltos de línea y espacios en blanco al final de cada línea.
 */
function normalizeLineEndings(str) {
  return str.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Aplica un parche a baseContent reemplazando searchBlock por replaceBlock
 * usando una estrategia multi-tier resiliente:
 * Tier 1: Exacto
 * Tier 2: Normalizado (\r\n vs \n, espacios finales)
 * Tier 3: Trimmed por líneas (independiente de indentación)
 * Tier 4: Context-Anchored Fuzzy Match (Levenshtein >= 0.85)
 */
export function applyPatch(baseContent, searchBlock, replaceBlock) {
  if (!baseContent || typeof baseContent !== 'string') {
    return { success: false, reason: 'El contenido base no existe o está vacío.' };
  }
  if (!searchBlock || typeof searchBlock !== 'string') {
    return { success: false, reason: 'El bloque de búsqueda (search_block / old_string) está vacío.' };
  }
  const replacement = typeof replaceBlock === 'string' ? replaceBlock : '';

  // --------------------------------------------------------------------------
  // TIER 1: Coincidencia Exacta Literal
  // --------------------------------------------------------------------------
  const exactOccurrences = baseContent.split(searchBlock).length - 1;
  if (exactOccurrences === 1) {
    const newContent = baseContent.replace(searchBlock, replacement);
    return { success: true, newContent, matchType: 'exact' };
  }
  if (exactOccurrences > 1) {
    return {
      success: false,
      reason: `El fragmento a reemplazar aparece ${exactOccurrences} veces de forma idéntica en el archivo. Añade más líneas de contexto alrededor para que sea único.`
    };
  }

  // --------------------------------------------------------------------------
  // TIER 2: Normalización de Saltos de Línea (\r\n vs \n) y Espacios al Final
  // --------------------------------------------------------------------------
  const normBase = normalizeLineEndings(baseContent);
  const normSearch = normalizeLineEndings(searchBlock);
  const normReplacement = normalizeLineEndings(replacement);

  const normOccurrences = normBase.split(normSearch).length - 1;
  if (normOccurrences === 1) {
    const newContent = normBase.replace(normSearch, normReplacement);
    return { success: true, newContent, matchType: 'normalized_line_endings' };
  }
  if (normOccurrences > 1) {
    return {
      success: false,
      reason: `El fragmento a reemplazar aparece ${normOccurrences} veces tras normalizar saltos de línea. Añade más contexto alrededor para identificar un único lugar.`
    };
  }

  // --------------------------------------------------------------------------
  // TIER 3: Coincidencia Línea por Línea Recortada (Trimmed Line Matching)
  // Tolera diferencias de indentación (espacios vs tabs, 2 vs 4 espacios).
  // --------------------------------------------------------------------------
  const baseLines = normBase.split('\n');
  const searchLines = normSearch.split('\n');
  const trimmedSearchLines = searchLines.map(l => l.trim());

  // Ignorar líneas vacías al inicio y al final del bloque de búsqueda para el anclaje
  let searchStartIdx = 0;
  while (searchStartIdx < trimmedSearchLines.length && trimmedSearchLines[searchStartIdx] === '') {
    searchStartIdx++;
  }
  let searchEndIdx = trimmedSearchLines.length - 1;
  while (searchEndIdx >= 0 && trimmedSearchLines[searchEndIdx] === '') {
    searchEndIdx--;
  }

  const effectiveSearchLines = trimmedSearchLines.slice(searchStartIdx, searchEndIdx + 1);
  if (effectiveSearchLines.length > 0) {
    const matchPositions = [];

    for (let i = 0; i <= baseLines.length - effectiveSearchLines.length; i++) {
      let matches = true;
      for (let j = 0; j < effectiveSearchLines.length; j++) {
        if (baseLines[i + j].trim() !== effectiveSearchLines[j]) {
          matches = false;
          break;
        }
      }
      if (matches) {
        matchPositions.push(i);
      }
    }

    if (matchPositions.length === 1) {
      const matchIndex = matchPositions[0];
      // Detectar indentación de la primera línea coincidente para adaptar el bloque de reemplazo si aplica
      const targetIndent = baseLines[matchIndex].match(/^\s*/)[0];
      const repLines = normReplacement.split('\n');

      // Adaptar indentación relativa del bloque de reemplazo si searchLines tenía indentación base
      const origFirstIndent = (searchLines[searchStartIdx] || '').match(/^\s*/)[0];
      const adaptedRepLines = repLines.map(line => {
        if (line.trim().length === 0) return '';
        if (line.startsWith(origFirstIndent)) {
          return targetIndent + line.slice(origFirstIndent.length);
        }
        return line;
      });

      const before = baseLines.slice(0, matchIndex);
      const after = baseLines.slice(matchIndex + effectiveSearchLines.length);
      const newContent = [...before, ...adaptedRepLines, ...after].join('\n');
      return { success: true, newContent, matchType: 'trimmed_lines' };
    }

    if (matchPositions.length > 1) {
      return {
        success: false,
        reason: `El bloque de código coincide en ${matchPositions.length} ubicaciones distintas por indentación. Proporciona más contexto superior e inferior.`
      };
    }
  }

  // --------------------------------------------------------------------------
  // TIER 4: Fuzzy Context-Anchored Match (Levenshtein Sliding Window)
  // Para variaciones menores de sintaxis / comentarios / espacios internos
  // --------------------------------------------------------------------------
  if (effectiveSearchLines.length >= 2) {
    const searchJoined = effectiveSearchLines.join('\n');
    let bestSimilarity = 0;
    let bestIndex = -1;
    let runnerUpSimilarity = 0;

    const windowSize = effectiveSearchLines.length;
    for (let i = 0; i <= baseLines.length - windowSize; i++) {
      const candidateWindow = baseLines.slice(i, i + windowSize).map(l => l.trim()).join('\n');
      const sim = stringSimilarity(searchJoined, candidateWindow);

      if (sim > bestSimilarity) {
        runnerUpSimilarity = bestSimilarity;
        bestSimilarity = sim;
        bestIndex = i;
      } else if (sim > runnerUpSimilarity) {
        runnerUpSimilarity = sim;
      }
    }

    // Umbral de aceptación: Similitud >= 0.85 y al menos 0.15 mejor que el segundo candidato
    if (bestSimilarity >= 0.85 && (bestSimilarity - runnerUpSimilarity >= 0.12 || runnerUpSimilarity < 0.65)) {
      const before = baseLines.slice(0, bestIndex);
      const after = baseLines.slice(bestIndex + windowSize);
      const newContent = [...before, normReplacement, ...after].join('\n');
      return { success: true, newContent, matchType: 'fuzzy_levenshtein' };
    }
  }

  return {
    success: false,
    reason: `No se encontró el bloque a reemplazar en el archivo (ni de forma exacta, ni con normalización de espacios o indentación). Revisa el contenido real con "read_file" para asegurar que el bloque existe.`
  };
}
