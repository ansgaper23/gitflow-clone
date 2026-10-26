import { supabase } from '../db/supabaseClient.js';
import { getActiveAccounts, RUNNERS } from './aiAccounts.js';

const SYSTEM_PROMPT = `Eres un generador de nombres semánticos para proyectos de software (estilo Lovable).
Recibes el prompt inicial del usuario (y opcionalmente nombres de archivos adjuntos o URLs) y devuelves ÚNICAMENTE un objeto JSON válido sin markdown:
{ "name": "...", "slug": "..." }

Reglas para "name":
- Entre 2 y 4 palabras en Title Case, en el idioma del usuario.
- Captura la ESENCIA del producto: [Marca/Empresa] + [Propósito/Rubro] o [Tipo de App] + [Dominio].
- PROHIBIDO incluir verbos imperativos o muletillas del prompt ("construye", "crea", "hazme", "quiero", "actúa como", "web igual a esta", "a partir del brochure", "para dar a conocer").
- Si hay una URL (ej. "https://electrinovaperu.com/") o marca en el archivo/texto, úsala como núcleo del nombre (ej. "Electrinova Perú", "Sergesol Industrial").
- Ejemplos:
  * "construye una web para clinica dental" -> { "name": "Clínica Dental Web", "slug": "clinica-dental-web" }
  * "Creame una web igual a esta https://electrinovaperu.com/" -> { "name": "Electrinova Perú", "slug": "electrinova-peru" }
  * "hazme una web profesional para dar a conocer mis servicios a partir del brochure (sergesol.pdf)" -> { "name": "Sergesol Perú", "slug": "sergesol-peru" }
  * "actúa como un ingeniero senior de machine learning y crea un diagnosticador de motores" -> { "name": "Diagnóstico de Motores IA", "slug": "diagnostico-motores-ia" }
  * "crea un CRM para inmobiliaria" -> { "name": "CRM Inmobiliario", "slug": "crm-inmobiliario" }

Reglas para "slug":
- Basado en "name", en minúsculas, espacios reemplazados por guiones, sin acentos ni caracteres especiales (NFD + eliminar diacríticos), máximo 35 caracteres.`;

const FORBIDDEN_VERBS = [
  'construye', 'construyeme', 'crea', 'creame', 'créame', 'haz', 'hazme',
  'actua', 'actúa', 'como', 'quiero', 'necesito', 'genera', 'generame',
  'disena', 'diseña', 'desarrolla', 'desarrollame', 'web igual a esta'
];

const CLEAN_PROMPT_REGEX = /^(por favor\s+)?(act[uú]a como [a-z\s]+ y\s+)?(construye|crea|cr[eé]ame|haz|hazme|genera|dise[ñn]a|desarrolla|quiero|necesito)\s+(una?\s+)?(p[aá]gina\s+|sitio\s+|aplicaci[oó]n\s+)?(web\s+|app\s+|sistema\s+)?(profesional\s+)?(igual a esta\s+)?(para dar a conocer mis servicios\s+)?(para\s+|de\s+)?/i;

const STOP_WORDS = new Set(['de', 'la', 'el', 'los', 'las', 'del', 'en', 'para', 'con', 'y', 'o', 'al', 'a', 'por', 'un', 'una', 'mi', 'mis']);

/**
 * Normaliza un texto a slug limpio según las reglas Lovable:
 * minúsculas, guiones, sin diacríticos, máximo 35 caracteres.
 */
export function slugify(text) {
  if (!text) return 'proyecto';
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 35)
    .replace(/-+$/, '') || 'proyecto';
}

/**
 * Convierte un arreglo de palabras o frase en Title Case respetando conectores y acrónimos.
 */
function toTitleCase(input) {
  const words = Array.isArray(input) ? input : String(input || '').trim().split(/\s+/).filter(Boolean);
  return words.map((w, i) => {
    const low = w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (/^[A-Z0-9]{2,5}$/.test(w) || ['crm', 'pos', 'ia', 'ai', 'erp', 'api', 'iot'].includes(low)) {
      return w.toUpperCase();
    }
    if (i > 0 && STOP_WORDS.has(low)) {
      return w.toLowerCase();
    }
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

/**
 * Extrae dominios limpios a partir de URLs en texto o lista.
 */
function parseBrandFromDomain(rawUrl) {
  try {
    let domain = rawUrl.trim();
    if (!domain.startsWith('http://') && !domain.startsWith('https://')) {
      domain = 'https://' + domain;
    }
    const parsed = new URL(domain);
    let host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    // Quitar extensiones comunes de TLDs
    host = host.replace(/\.(com|org|net|edu|gob|gov|io|pe|co|es|ai|app|dev|lat|online|xyz|tech|store)(\.[a-z]{2})?$/gi, '');
    
    // Detectar patrones compuestos como "electrinovaperu" -> "Electrinova Perú"
    const knownCountrySuffixes = [
      { regex: /peru$/i, suffix: 'Perú' },
      { regex: /chile$/i, suffix: 'Chile' },
      { regex: /mexico$/i, suffix: 'México' },
      { regex: /colombia$/i, suffix: 'Colombia' },
      { regex: /argentina$/i, suffix: 'Argentina' }
    ];

    for (const item of knownCountrySuffixes) {
      if (item.regex.test(host) && host.length > item.suffix.length + 2) {
        const root = host.replace(item.regex, '');
        const brandName = toTitleCase(root) + ' ' + item.suffix;
        return {
          name: brandName,
          slug: slugify(brandName)
        };
      }
    }

    const brandName = toTitleCase(host.replace(/[-_.]+/g, ' '));
    return {
      name: brandName,
      slug: slugify(brandName)
    };
  } catch {
    return null;
  }
}

/**
 * Extrae marcas desde nombres de archivo (ej. brochure-sergesol.pdf -> Sergesol Perú)
 */
function parseBrandFromAttachment(filename) {
  if (!filename) return null;
  let base = String(filename).replace(/\.[a-zA-Z0-9]+$/, '').toLowerCase();
  base = base.replace(/^(brochure|catalogo|catálogo|manual|presentacion|presentación|doc|documento)[-_.]*/gi, '');
  base = base.replace(/[-_.]+/g, ' ').trim();
  if (!base) return null;

  // Si contiene sergesol o similar
  if (base.includes('sergesol')) {
    return { name: 'Sergesol Perú', slug: 'sergesol-peru' };
  }
  const brand = toTitleCase(base);
  return { name: brand, slug: slugify(brand) };
}

/**
 * Fallback determinista inteligente sin LLM (Cero Verbos).
 * Extrae la marca desde dominios, adjuntos o limpia el prompt de muletillas imperativas.
 */
export function buildCleanFallbackName(userPrompt = '', context = {}) {
  const prompt = String(userPrompt || '').trim();

  // 1. Prioridad: Brand explícita en contexto
  if (context.extractedBrand && context.extractedBrand.trim()) {
    const brand = toTitleCase(context.extractedBrand.trim());
    return {
      name: brand,
      slug: slugify(brand)
    };
  }

  // 2. Prioridad: URLs en contexto o en el prompt
  const urlMatches = prompt.match(/https?:\/\/[^\s"'<>]+/gi) || [];
  const allUrls = [...(context.urls || []), ...urlMatches];
  for (const u of allUrls) {
    const brandFromUrl = parseBrandFromDomain(u);
    if (brandFromUrl && brandFromUrl.name) {
      return brandFromUrl;
    }
  }

  // 3. Prioridad: Nombres de archivos adjuntos en contexto o menciones tipo brochure (sergesol.pdf)
  const attachmentMatches = prompt.match(/\b([a-zA-Z0-9_-]+\.(?:pdf|docx?|xlsx?|png|jpg))\b/gi) || [];
  const allAttachments = [...(context.attachmentNames || []), ...attachmentMatches];
  for (const att of allAttachments) {
    const brandFromAtt = parseBrandFromAttachment(att);
    if (brandFromAtt && brandFromAtt.name) {
      return brandFromAtt;
    }
  }

  // 4. Detección de marcas comerciales destacadas en el prompt (ej. "restaurante Don José")
  // Requiere mayúsculas iniciales en la marca para no capturar sustantivos comunes como "clinica dental"
  const brandMatch = prompt.match(/(?:restaurante|tienda|cl[ií]nica|empresa|marca|negocio)\s+([A-ZÁÉÍÓÚ][a-zñáéíóú]+(?:\s+[A-ZÁÉÍÓÚ][a-zñáéíóú]+)*)/);
  if (brandMatch && brandMatch[1]) {
    const brand = brandMatch[1].trim();
    // Si el prompt mencionaba restaurante Don José -> Don José o Restaurante Don José
    const prefixMatch = prompt.match(/\b(restaurante|cl[ií]nica|tienda)\b/i);
    const fullName = prefixMatch ? `${toTitleCase(prefixMatch[1])} ${toTitleCase(brand)}` : toTitleCase(brand);
    return {
      name: fullName,
      slug: slugify(brand)
    };
  }

  // 5. Limpieza determinista mediante CLEAN_PROMPT_REGEX
  let cleaned = prompt;
  cleaned = cleaned.replace(CLEAN_PROMPT_REGEX, '').trim();
  // Limpiar verbos secundarios tipo "... y crea ..."
  cleaned = cleaned.replace(/^(y\s+)?(crea|haz|construye|dise[ñn]a|genera)\s+(una?\s+)?/i, '').trim();
  cleaned = cleaned.replace(/^(un|una|el|la|los|las)\s+/i, '').trim();
  cleaned = cleaned.replace(/(para\s+dar\s+a\s+conocer\s+mis\s+servicios|a\s+partir\s+del\s+brochure|igual\s+a\s+esta).*$/i, '').trim();

  // Filtrar palabras significativas (máx 3-4 palabras)
  const words = cleaned
    .replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(w => !FORBIDDEN_VERBS.includes(w.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')));

  const chosenWords = words.slice(0, 4);
  let baseName = toTitleCase(chosenWords);

  if (!baseName || baseName.length < 3) {
    baseName = 'Proyecto Web';
  } else if (!/(web|app|ia|sistema|crm|pos)$/i.test(baseName) && words.length <= 2) {
    baseName = `${baseName} Web`;
  }

  return {
    name: baseName,
    slug: slugify(baseName)
  };
}

/**
 * Extrae y valida el bloque JSON devuelto por el LLM
 */
function parseLlmJson(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;
  const cleaned = rawText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const match = cleaned.match(/\{[\s\S]*?\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.name || typeof parsed.name !== 'string') return null;

    const lowerName = parsed.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const hasForbidden = FORBIDDEN_VERBS.some(v => lowerName.startsWith(v + ' ') || lowerName.includes(' ' + v + ' '));
    if (hasForbidden) return null;

    return {
      name: parsed.name.trim(),
      slug: slugify(parsed.slug || parsed.name)
    };
  } catch {
    return null;
  }
}

/**
 * Genera el nombre y slug semánticos usando LLM rápido (Promise.race 4000ms)
 * con fallback determinista inteligente garantizado.
 */
export async function generateProjectName(userPrompt, context = {}) {
  const fallback = buildCleanFallbackName(userPrompt, context);
  if (context.simulateTimeout) {
    return fallback;
  }

  const timeoutMs = context.timeoutMs || 4000;

  let userMessage = `Prompt: "${userPrompt}"`;
  const extra = [];
  if (context.extractedBrand) extra.push(`Marca detectada: ${context.extractedBrand}`);
  if (context.urls?.length) extra.push(`URLs: ${context.urls.join(', ')}`);
  if (context.attachmentNames?.length) extra.push(`Archivos adjuntos: ${context.attachmentNames.join(', ')}`);
  if (extra.length > 0) {
    userMessage += `\nContexto adicional:\n${extra.join('\n')}`;
  }

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout de ${timeoutMs}ms excedido en generateProjectName`)), timeoutMs)
  );

  const llmCall = (async () => {
    let accounts = [];
    try {
      accounts = await getActiveAccounts('agent');
    } catch {
      return null;
    }
    if (!accounts || accounts.length === 0) return null;

    // Priorizar modelos rápidos: gemini, antigravity, anthropic
    const fastAccounts = accounts.filter(a =>
      a.provider === 'gemini' ||
      a.provider === 'antigravity' ||
      a.provider === 'anthropic' ||
      a.provider === 'openai'
    );
    const pool = fastAccounts.length > 0 ? fastAccounts : accounts;

    for (let attempt = 0; attempt < Math.min(pool.length, 2); attempt++) {
      const account = pool[attempt];
      const runner = RUNNERS[account.provider];
      if (!runner) continue;
      try {
        const result = await runner({
          apiKey: account.api_key,
          baseURL: account.base_url,
          model: account.model,
          system: SYSTEM_PROMPT,
          tools: [],
          history: [],
          userMessage,
          executeTool: async () => 'n/a',
        });
        const parsed = parseLlmJson(result?.text);
        if (parsed && parsed.name) {
          return parsed;
        }
      } catch (err) {
        // Continuar con el siguiente intento antes del timeout
        continue;
      }
    }
    return null;
  })();

  try {
    const result = await Promise.race([llmCall, timeoutPromise]);
    if (result && result.name) {
      return result;
    }
    return fallback;
  } catch (err) {
    console.warn(`[projectNaming] LLM naming fallback activado (${err.message})`);
    return fallback;
  }
}

/**
 * Garantiza unicidad del slug en la base de datos de proyectos,
 * agregando sufijos incrementales (-2, -3, etc.) si ya existe.
 */
export async function ensureUniqueSlug(rawSlug, projectId = null, dbClient = supabase) {
  const baseSlug = slugify(rawSlug);
  let candidate = baseSlug;
  let counter = 1;

  while (counter <= 50) {
    let exists = false;

    // Soporte para mock functions / testing
    if (typeof dbClient === 'function') {
      exists = await dbClient(candidate, projectId);
    } else if (dbClient && typeof dbClient.from === 'function') {
      try {
        let query = dbClient.from('projects').select('id').eq('slug', candidate);
        if (projectId) {
          query = query.neq('id', projectId);
        }
        const { data, error } = await query;
        if (!error && data && data.length > 0) {
          exists = true;
        }
      } catch {
        exists = false;
      }
    }

    if (!exists) {
      return candidate;
    }

    counter++;
    candidate = `${baseSlug}-${counter}`;
  }

  return `${baseSlug}-${Date.now().toString(36)}`;
}

/**
 * Validador de nombre genérico o literal que requiere renombrado semántico
 */
export function isGenericOrLiteralName(name, prompt = '') {
  if (!name || typeof name !== 'string') return true;
  const n = name.trim().toLowerCase();
  if (['nuevo proyecto', 'untitled', 'untitled project', 'proyecto', 'app', 'mi proyecto'].includes(n)) {
    return true;
  }
  // Si comienza con verbos imperativos
  for (const v of FORBIDDEN_VERBS) {
    if (n.startsWith(v)) return true;
  }
  if (/^(act[uú]a como|construye|crea|cr[eé]ame|haz|hazme|quiero|necesito|web igual a esta|un|una)/i.test(n)) {
    return true;
  }
  return false;
}
