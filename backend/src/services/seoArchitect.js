// backend/src/services/seoArchitect.js
// ARQUITECTO SEO TÉCNICO GOOGLE 2026 & AI OVERVIEWS (FLOWPRO)
// Gobierna el HTML5 semántico, Core Web Vitals (LCP/CLS/INP), Schema.org JSON-LD y metadatos sociales.

const SEO_TRIGGERS = [
  /\b(?:seo|posicionamiento|google|search|metadata|metadatos|schema\.org|json-ld|open\s*graph|sitemap|core\s*web\s*vitals|ranking)\b/i,
  /\b(?:landing\s*page|sitio\s*web|p[aá]gina\s*web|web\s*corporativa|web\s*de|web\s*para|p[aá]gina\s*de|portal\s*de|ecommerce|tienda\s*online)\b/i,
  /\b(?:optimiza(?:r)?\s+(?:el\s+)?seo|mejora(?:r)?\s+(?:el\s+)?seo|haz(?:me)?\s+(?:buen\s+)?seo)\b/i
]

/**
 * Determina si la instrucción se beneficia de directivas de optimización SEO técnica
 * @param {string} userMessage 
 * @returns {boolean}
 */
export function isSeoTarget(userMessage) {
  if (!userMessage || typeof userMessage !== 'string') return false
  const normalized = userMessage.trim().toLowerCase()
  return SEO_TRIGGERS.some((p) => p.test(normalized))
}

/**
 * Genera un bloque de datos estructurados Schema.org en formato JSON-LD string
 * @param {object} params
 * @returns {string}
 */
export function generateJsonLdTemplate({
  type = 'Organization',
  name = 'Empresa',
  description = '',
  url = 'https://ejemplo.com',
  faqs = []
} = {}) {
  const schemas = []

  // Schema principal de entidad
  if (type === 'LocalBusiness' || type === 'Organization') {
    schemas.push({
      '@context': 'https://schema.org',
      '@type': type,
      name,
      description,
      url,
      sameAs: []
    })
  } else if (type === 'SoftwareApplication') {
    schemas.push({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'All',
      description
    })
  } else {
    schemas.push({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name,
      description,
      url
    })
  }

  // Schema FAQPage si existen preguntas frecuentes
  if (faqs && faqs.length > 0) {
    schemas.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqs.map((f) => ({
        '@type': 'Question',
        name: f.question || f.q,
        acceptedAnswer: {
          '@type': 'Answer',
          text: f.answer || f.a
        }
      }))
    })
  }

  return JSON.stringify(schemas.length === 1 ? schemas[0] : { '@graph': schemas }, null, 2)
}

/**
 * Retorna las directivas completas de Arquitectura SEO Técnico Google 2026 para el LLM.
 * @param {object} [options]
 * @param {boolean} [options.isDiagnostic=false] - Si es un turno de auditoría/diagnóstico
 * @returns {string}
 */
export function getTechnicalSeoDirectives({ isDiagnostic = false } = {}) {
  const introHeader = isDiagnostic
    ? `MARCO DE AUDITORÍA SEO TÉCNICO GOOGLE 2026 & AI OVERVIEWS:
Evalúa la página web y presencia digital del cliente frente a los estándares de posicionamiento orgánico en Google, Rich Snippets y respuestas generativas de IA (Google SGE / Gemini Overviews):`
    : `DIRECTIVAS DE ARQUITECTURA SEO TÉCNICO GOOGLE 2026 & AI OVERVIEWS:
Toda aplicación o página web creada por FlowPro debe estar optimizada al 100% para posicionamiento orgánico en Google, Rich Snippets y respuestas generativas de IA (Google SGE / Gemini Overviews):`

  return `
<technical_google_seo_2026_directives>
${introHeader}

1. HTML5 SEMÁNTICO Y JERARQUÍA ESTRICTA (CRAWLABILITY & E-E-A-T):
   - Prohibido el "div-soup". Estructura la página con elementos semánticos estándar:
     * \`<header>\` para el navbar superior.
     * \`<nav aria-label="Navegación principal">\` para la barra de navegación.
     * \`<main>\` envolviendo el contenido troncal del documento.
     * \`<section id="..." aria-labelledby="...">\` para cada bloque temático.
     * \`<article>\` para tarjetas de contenido independiente, testimonios o posts.
     * \`<footer>\` para el pie de página corporativo.
   - EXACTAMENTE UN ÚNICO \`<h1>\` por vista principal: Debe contener la intención de búsqueda primaria y propuesta de valor clave.
   - Jerarquía lógica descendente sin saltos: \`<h1>\` -> \`<h2>\` (títulos de cada sección) -> \`<h3>\` (títulos de tarjetas o subtareas).

2. DATOS ESTRUCTURADOS SCHEMA.ORG (JSON-LD EN INDEX.HTML):
   - Inyecta o actualiza en \`index.html\` un bloque \`<script type="application/ld+json">\` con la entidad adecuada al negocio (\`LocalBusiness\`, \`Organization\`, \`SoftwareApplication\` o \`Service\`).
   - Si la página contiene sección de Preguntas Frecuentes (FAQ), sincroniza el JSON-LD con \`@type: "FAQPage"\` conteniendo las preguntas y respuestas exactas para ganar Rich Snippets en Google.

3. OPTIMIZACIÓN EXTREMA DE CORE WEB VITALS (LCP, CLS, INP):
   - LCP (Largest Contentful Paint): La imagen principal del Hero section DEBE llevar \`fetchpriority="high"\` y \`decoding="async"\`. PROHIBIDO colocar \`loading="lazy"\` en la primera pantalla.
   - CLS (Cumulative Layout Shift = 0): Toda etiqueta \`<img>\` o contenedor multimedia DEBE reservar su espacio mediante dimensiones explícitas o clases de ratio de aspecto de Tailwind (\`aspect-video\`, \`aspect-square\`, \`aspect-[4/3]\`, \`aspect-[16/9]\`).
   - Accesibilidad y Contexto Semántico: Todo \`<img>\` debe incluir un atributo \`alt="..."\` descriptivo, rico en palabras clave naturales y contexto de negocio (nunca \`alt=""\` vacío ni genérico como \`alt="imagen"\`).
   - INP (Interaction to Next Paint): Garantiza micro-interacciones a 60fps aceleradas por GPU (\`transform\`, \`opacity\`).

4. PACK COMPLETO DE METADATOS Y OPEN GRAPH EN INDEX.HTML:
   - \`<html lang="es">\` (o el idioma del proyecto).
   - \`<title>\` optimizado: 50 a 60 caracteres con palabra clave principal + nombre de marca (ej. "Control de Gastos Inteligente para Empresas | FlowPro").
   - \`<meta name="description" content="...">\`: 140 a 160 caracteres persuasivos con llamada a la acción clara.
   - \`<meta name="robots" content="index, follow, max-image-preview:large">\`.
   - Open Graph completo: \`og:title\`, \`og:description\`, \`og:type\`, \`og:url\`, \`og:image\`, \`og:locale\`.
   - Twitter Cards: \`twitter:card\` (\`summary_large_image\`), \`twitter:title\`, \`twitter:description\`.
</technical_google_seo_2026_directives>
`.trim()
}

/**
 * Audita el contenido de un archivo index.html para identificar omisiones de SEO técnico
 * @param {string} htmlContent 
 * @returns {{ valid: boolean, score: number, issues: string[], suggestions: string[] }}
 */
export function auditIndexHtmlSeo(htmlContent) {
  if (!htmlContent || typeof htmlContent !== 'string') {
    return { valid: false, score: 0, issues: ['index.html no encontrado o vacío'], suggestions: ['Crear index.html con estructura HTML5 completa'] }
  }

  const issues = []
  const suggestions = []
  let score = 100

  // 1. Título por defecto de plantilla
  const titleMatch = /<title>(.*?)<\/title>/i.exec(htmlContent)
  if (!titleMatch) {
    issues.push('Falta etiqueta <title>')
    suggestions.push('Añadir un <title> optimizado de 50-60 caracteres con palabra clave y marca')
    score -= 25
  } else {
    const titleText = titleMatch[1].trim()
    if (/vite\s*\+\s*react/i.test(titleText) || /vite\s*app/i.test(titleText) || titleText.length < 5) {
      issues.push(`El <title> sigue siendo el predeterminado de plantilla ("${titleText}")`)
      suggestions.push('Personalizar el <title> con el nombre del negocio y su propuesta de valor')
      score -= 20
    }
  }

  // 2. Meta description
  const hasMetaDesc = /<meta\s+name=["']description["']\s+content=["'](.*?)["']/i.test(htmlContent) ||
                      /<meta\s+content=["'](.*?)["']\s+name=["']description["']/i.test(htmlContent)
  if (!hasMetaDesc) {
    issues.push('Falta etiqueta <meta name="description">')
    suggestions.push('Añadir <meta name="description"> persuasiva de 140-160 caracteres con llamada a la acción')
    score -= 20
  }

  // 3. Open Graph
  const hasOgTitle = /<meta\s+property=["']og:title["']/i.test(htmlContent)
  const hasOgDesc = /<meta\s+property=["']og:description["']/i.test(htmlContent)
  if (!hasOgTitle || !hasOgDesc) {
    issues.push('Faltan etiquetas Open Graph (og:title / og:description)')
    suggestions.push('Añadir metadatos Open Graph para previsualización enriquecida en redes y WhatsApp')
    score -= 15
  }

  // 4. Schema.org JSON-LD
  const hasJsonLd = /<script\s+type=["']application\/ld\+json["']/i.test(htmlContent)
  if (!hasJsonLd) {
    issues.push('Falta bloque de datos estructurados Schema.org JSON-LD')
    suggestions.push('Inyectar un bloque <script type="application/ld+json"> con Organization, LocalBusiness o SoftwareApplication')
    score -= 20
  }

  // 5. Atributo lang en <html>
  const hasLang = /<html[^>]+lang=["'][a-zA-Z-]+["']/i.test(htmlContent)
  if (!hasLang) {
    issues.push('Falta el atributo lang en la etiqueta <html>')
    suggestions.push('Definir <html lang="es"> para indicar el idioma principal del contenido')
    score -= 10
  }

  const valid = issues.length === 0

  return {
    valid,
    score: Math.max(0, score),
    issues,
    suggestions
  }
}
