// frontend/src/lib/projectUtils.js

const FILLER_PREFIXES = new Set([
  'actua', 'como', 'un', 'una', 'crea', 'creame', 'haz', 'hazme', 
  'disena', 'disename', 'diseña', 'diseñame', 'quiero', 'necesito',
  'construye', 'construyeme', 'desarrolla', 'desarrollame', 'hacer', 'hacerte'
]);

const STOP_WORDS = new Set([
  'de', 'la', 'el', 'los', 'las', 'del', 'en', 'para', 'con', 'y', 'o', 'al', 'por', 'sobre'
]);

/**
 * Convierte un slug o prompt en un nombre humano profesional de 2 a 4 palabras en Title Case.
 * Ej: "actua-como-un-ingeniero-senior-de-machine-learning" -> "Machine Learning Diagnostic"
 * Ej: "neuralt-motor-fault-predictor" -> "NeuralT Motor Fault Predictor"
 */
export function formatProjectDisplayName(input) {
  if (!input) return 'Mi Proyecto';

  // Si ya tiene formato con espacios y mayúsculas naturales, validarlo
  const raw = String(input).trim();
  
  // Si contiene formato de UUID virtual
  if (/^virtual[/-]/i.test(raw)) {
    return 'Proyecto Virtual';
  }

  // Reemplazar guiones y underscores por espacios
  const normalized = raw.replace(/[_-]+/g, ' ').trim();
  const words = normalized.split(/\s+/).filter(Boolean);

  // Si son pocas palabras y ya tienen mayúsculas adecuadas, conservar
  if (words.length <= 4 && /[A-Z]/.test(raw) && !raw.includes('-')) {
    return raw;
  }

  // Filtrar prefijos comunes de prompts conversacionales ("actúa como...", "crea un...")
  let startIndex = 0;
  while (startIndex < words.length && startIndex < 4) {
    const w = words[startIndex].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (FILLER_PREFIXES.has(w)) {
      startIndex++;
    } else {
      break;
    }
  }

  const meaningfulWords = words.slice(startIndex);
  const candidates = (meaningfulWords.length > 0 ? meaningfulWords : words).slice(0, 4);

  // Convertir a Title Case respetando stop words internas
  const titleCased = candidates.map((word, idx) => {
    const lower = word.toLowerCase();
    if (idx > 0 && STOP_WORDS.has(lower)) {
      return lower;
    }
    // Si la palabra ya parece un acrónimo (ej. DNN, MCP, AI, SCADA, API, PLC), mantenerla en mayúsculas
    if (/^[A-Z0-9]{2,5}$/.test(word)) {
      return word;
    }
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  });

  const result = titleCased.join(' ').trim();
  return result || 'Mi Proyecto';
}

/**
 * Obtiene el nombre a mostrar para un objeto de proyecto.
 */
export function getProjectDisplayName(project) {
  if (!project) return 'Cargando...';
  if (project.displayName && typeof project.displayName === 'string' && project.displayName.trim()) {
    return project.displayName.trim();
  }
  if (project.display_name && typeof project.display_name === 'string' && project.display_name.trim()) {
    return project.display_name.trim();
  }
  return formatProjectDisplayName(project.name || project.title || 'Mi Proyecto');
}
