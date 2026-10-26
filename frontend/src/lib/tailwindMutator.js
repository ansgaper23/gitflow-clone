// frontend/src/lib/tailwindMutator.js
// MUTADOR DE CLASES TAILWIND PARA LA INTERFAZ DE USUARIO (ZERO-LLM)

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

export function getTailwindClassGroup(clsName) {
  if (!clsName) return null;

  if (clsName.startsWith('bg-')) {
    const rest = clsName.slice(3).split('/')[0];
    const colorPart = rest.split('-')[0];
    if (TAILWIND_COLORS.has(colorPart) || rest.startsWith('[#') || rest.startsWith('[rgb')) {
      return 'bg-color';
    }
  }

  if (clsName.startsWith('text-')) {
    const rest = clsName.slice(5).split('/')[0];
    const firstPart = rest.split('-')[0];
    if (!TEXT_SIZES_AND_ALIGN.has(firstPart)) {
      if (TAILWIND_COLORS.has(firstPart) || rest.startsWith('[#') || rest.startsWith('[rgb')) {
        return 'text-color';
      }
    }
  }

  if (clsName === 'rounded' || clsName.startsWith('rounded-')) {
    return 'rounded';
  }

  if (/^p-\d+/.test(clsName) || clsName.startsWith('p-[')) return 'p';
  if (/^px-\d+/.test(clsName) || clsName.startsWith('px-[')) return 'px';
  if (/^py-\d+/.test(clsName) || clsName.startsWith('py-[')) return 'py';

  return null;
}

export function parseTailwindToken(token) {
  const parts = token.split(':');
  const baseClass = parts.pop();
  const variants = parts;
  const group = getTailwindClassGroup(baseClass);
  return { variants, baseClass, group, variantPrefix: variants.length ? variants.join(':') + ':' : '' };
}

export function mutateTailwindClasses(currentClassName, updates = {}) {
  const rawClasses = String(currentClassName || '').trim().split(/\s+/).filter(Boolean);
  
  const newClassesToApply = [];
  for (const [key, val] of Object.entries(updates)) {
    if (!val) continue;
    const splitVals = String(val).trim().split(/\s+/).filter(Boolean);
    newClassesToApply.push(...splitVals);
  }

  if (newClassesToApply.length === 0) {
    return rawClasses.join(' ');
  }

  const groupsToReplace = new Map();
  for (const newCls of newClassesToApply) {
    const { variantPrefix, group } = parseTailwindToken(newCls);
    if (group) {
      groupsToReplace.set(`${variantPrefix}${group}`, newCls);
    }
  }

  const result = [];
  const appliedGroups = new Set();
  const PADDING_SUBGROUPS = new Set(['p', 'px', 'py', 'pt', 'pb', 'pl', 'pr']);

  for (const oldToken of rawClasses) {
    const { variantPrefix, group } = parseTailwindToken(oldToken);
    const key = `${variantPrefix}${group}`;
    const generalPaddingKey = `${variantPrefix}p`;

    if (group && groupsToReplace.has(key)) {
      if (!appliedGroups.has(key)) {
        result.push(groupsToReplace.get(key));
        appliedGroups.add(key);
      }
    } else if (PADDING_SUBGROUPS.has(group) && groupsToReplace.has(generalPaddingKey)) {
      if (!appliedGroups.has(generalPaddingKey)) {
        result.push(groupsToReplace.get(generalPaddingKey));
        appliedGroups.add(generalPaddingKey);
      }
    } else {
      result.push(oldToken);
    }
  }

  for (const [key, newCls] of groupsToReplace.entries()) {
    if (!appliedGroups.has(key)) {
      result.push(newCls);
      appliedGroups.add(key);
    }
  }

  for (const newCls of newClassesToApply) {
    const { variantPrefix, group } = parseTailwindToken(newCls);
    if (!group && !result.includes(newCls)) {
      result.push(newCls);
    }
  }

  return result.join(' ');
}
