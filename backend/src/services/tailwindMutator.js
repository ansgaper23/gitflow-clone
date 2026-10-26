// backend/src/services/tailwindMutator.js
// MUTADOR INTELIGENTE DE CLASES TAILWIND (ZERO-LLM)
// Reemplaza utilidades por grupo sin duplicar clases ni romper modificadores (hover:, md:, dark:)

const TAILWIND_COLORS = new Set([
  'slate', 'gray', 'zinc', 'neutral', 'stone',
  'red', 'orange', 'amber', 'yellow', 'lime',
  'green', 'emerald', 'teal', 'cyan', 'sky',
  'blue', 'indigo', 'violet', 'purple', 'fuchsia',
  'pink', 'rose', 'white', 'black', 'transparent', 'current', 'inherit'
]);

const TEXT_SIZES_AND_ALIGN = new Set([
  'xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl', '8xl', '9xl',
  'left', 'center', 'right', 'justify', 'start', 'end'
]);

/**
 * Determina el grupo o categoría de una clase base de Tailwind
 * @param {string} clsName - Clase sin modificadores (ej: "bg-blue-600")
 * @returns {string|null} Grupo al que pertenece
 */
export function getTailwindClassGroup(clsName) {
  if (!clsName) return null;

  // 1. Background color (bg-blue-600, bg-white, bg-zinc-900/90, etc.)
  if (clsName.startsWith('bg-')) {
    const rest = clsName.slice(3).split('/')[0];
    const colorPart = rest.split('-')[0];
    if (TAILWIND_COLORS.has(colorPart) || rest.startsWith('[#') || rest.startsWith('[rgb')) {
      return 'bg-color';
    }
  }

  // 2. Text color (text-white, text-blue-600, text-zinc-400, etc.)
  if (clsName.startsWith('text-')) {
    const rest = clsName.slice(5).split('/')[0];
    const firstPart = rest.split('-')[0];
    if (!TEXT_SIZES_AND_ALIGN.has(firstPart)) {
      if (TAILWIND_COLORS.has(firstPart) || rest.startsWith('[#') || rest.startsWith('[rgb')) {
        return 'text-color';
      }
    }
  }

  // 3. Border radius (rounded, rounded-md, rounded-full, etc.)
  if (clsName === 'rounded' || clsName.startsWith('rounded-')) {
    return 'rounded';
  }

  // 4. Padding (p-*, px-*, py-*)
  if (/^p-\d+/.test(clsName) || clsName.startsWith('p-[')) return 'p';
  if (/^px-\d+/.test(clsName) || clsName.startsWith('px-[')) return 'px';
  if (/^py-\d+/.test(clsName) || clsName.startsWith('py-[')) return 'py';
  if (/^pt-\d+/.test(clsName)) return 'pt';
  if (/^pb-\d+/.test(clsName)) return 'pb';
  if (/^pl-\d+/.test(clsName)) return 'pl';
  if (/^pr-\d+/.test(clsName)) return 'pr';

  // 5. Border color y width
  if (/^border-(?:[0-9]|t|b|l|r)/.test(clsName) || clsName === 'border') return 'border-width';
  if (clsName.startsWith('border-')) {
    const rest = clsName.slice(7).split('/')[0];
    const colorPart = rest.split('-')[0];
    if (TAILWIND_COLORS.has(colorPart)) return 'border-color';
  }

  return null;
}

/**
 * Analiza una clase con sus posibles variantes (ej: "hover:bg-blue-700")
 * @param {string} token
 * @returns {{ variants: string[], baseClass: string, group: string|null }}
 */
export function parseTailwindToken(token) {
  const parts = token.split(':');
  const baseClass = parts.pop();
  const variants = parts;
  const group = getTailwindClassGroup(baseClass);
  return { variants, baseClass, group, variantPrefix: variants.length ? variants.join(':') + ':' : '' };
}

/**
 * Muta un conjunto de clases Tailwind reemplazando las utilidades conflictivas del mismo grupo.
 * NUNCA apila una clase nueva al final dejando la vieja (ej: "bg-blue-600 bg-emerald-600").
 * 
 * @param {string} currentClassName - Clases existentes (ej: "flex items-center bg-blue-600 text-white p-4")
 * @param {Record<string, string>} updates - Nuevas clases a aplicar { bg: 'bg-emerald-600', text: 'text-zinc-100', rounded: 'rounded-xl', p: 'p-6', ... }
 * @returns {string} Nueva cadena de clases limpia y normalizada
 */
export function mutateTailwindClasses(currentClassName, updates = {}) {
  const rawClasses = String(currentClassName || '').trim().split(/\s+/).filter(Boolean);
  
  // Normalizar los updates a una lista de nuevas clases a inyectar
  const newClassesToApply = [];
  for (const [key, val] of Object.entries(updates)) {
    if (!val) continue;
    const splitVals = String(val).trim().split(/\s+/).filter(Boolean);
    newClassesToApply.push(...splitVals);
  }

  if (newClassesToApply.length === 0) {
    return rawClasses.join(' ');
  }

  // Mapa de grupos a reemplazar por variante (ej: "none:bg-color" -> "bg-emerald-600")
  const groupsToReplace = new Map();
  for (const newCls of newClassesToApply) {
    const { variantPrefix, group } = parseTailwindToken(newCls);
    if (group) {
      groupsToReplace.set(`${variantPrefix}${group}`, newCls);
    }
  }

  // Filtrar las clases existentes que colisionen con los grupos que se van a actualizar
  const result = [];
  const appliedGroups = new Set();
  const PADDING_SUBGROUPS = new Set(['p', 'px', 'py', 'pt', 'pb', 'pl', 'pr']);

  for (const oldToken of rawClasses) {
    const { variantPrefix, group } = parseTailwindToken(oldToken);
    const key = `${variantPrefix}${group}`;
    const generalPaddingKey = `${variantPrefix}p`;

    if (group && groupsToReplace.has(key)) {
      // Si este grupo tiene un reemplazo y no se ha emitido todavía, insertamos el nuevo en su posición original
      if (!appliedGroups.has(key)) {
        result.push(groupsToReplace.get(key));
        appliedGroups.add(key);
      }
      // Omitir la clase vieja (no apilar)
    } else if (PADDING_SUBGROUPS.has(group) && groupsToReplace.has(generalPaddingKey)) {
      // Si se aplica un padding general (p-*), reemplazar/eliminar los paddings direccionales viejos
      if (!appliedGroups.has(generalPaddingKey)) {
        result.push(groupsToReplace.get(generalPaddingKey));
        appliedGroups.add(generalPaddingKey);
      }
    } else {
      result.push(oldToken);
    }
  }

  // Para los grupos de update que no existían previamente en las clases, agregarlos al final
  for (const [key, newCls] of groupsToReplace.entries()) {
    if (!appliedGroups.has(key)) {
      result.push(newCls);
      appliedGroups.add(key);
    }
  }

  // Si había updates sin grupo reconocido, agregarlos si no estaban presentes
  for (const newCls of newClassesToApply) {
    const { variantPrefix, group } = parseTailwindToken(newCls);
    if (!group && !result.includes(newCls)) {
      result.push(newCls);
    }
  }

  return result.join(' ');
}
