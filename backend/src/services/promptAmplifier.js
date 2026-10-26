// backend/src/services/promptAmplifier.js
// AMPLIFICADOR SILENCIOSO DE INTENCIÓN DE PRODUCTO (FASE 6)
// Enriquece directivas de arquitectura en modo BUILD cuando el usuario usa lenguaje cotidiano, conciso o no técnico.
// Mantiene intactos los pedidos quirúrgicos (Click-to-Edit, cambios de estilo puntual o elementos seleccionados).

const SURGICAL_PATTERNS = [
  /\b(?:cambia(?:me)? el color|color de|fondo de|fuente de|tamaño de|tamano de|haz(?:lo)? (?:el texto|este texto|la letra|el bot[oó]n)?\s*(?:m[aá]s|menos)\s+(?:grande|chico|pequeño|oscuro|claro|rojo|azul|verde|negro|blanco|visible|ancho|alto))\b/i,
  /\b(?:centra(?:lo)?|centrado|alinea(?:lo)?|alineado|mueve el|oculta el|quita el texto|cambia el texto|corrige (?:la falta|el error|la ortograf[ií]a)|modifica el t[ií]tulo|modifica el texto)\b/i,
  /\b(?:icono del bot[oó]n|padding|margin|borde|redondeo|shadow|sombra)\b/i
]

const MODULE_OR_APP_TRIGGERS = [
  /\b(?:sistema de|m[oó]dulo de|gestor de|panel de|control de|app de|secci[oó]n de|dashboard de|plataforma de)\b/i,
  /\b(?:crea(?:me)?|hazme|construye|agrega(?:me)?|implementa|quiero|necesito|desarrolla)\s+(?:un|una|el|la)\s+(?:sistema|m[oó]dulo|panel|gestor|app|secci[oó]n|dashboard|vista|control|tabla|crud)\b/i,
  /\b(?:hazme|creame|crea|construye|agrega|implementa)\s+(?:un|una)\s+(?:inventario|crm|pos|erp|ecommerce|tienda|blog|cotizador)\b/i
]

const DOMAIN_ENTITIES = [
  /\b(?:inventario|ventas|clientes|usuarios|pedidos|ordenes|[oó]rdenes|facturas|cotizaciones|reservas|gastos|ingresos|productos|recetas|tareas|citas|empleados|proveedores|almac[eé]n|pagos|finanzas|reportes|leads|suscripciones|habitaciones|pacientes|asistencia|turnos|servicios|catalogo|cat[aá]logo)\b/i
]

/**
 * Determina si la instrucción es una edición quirúrgica de estilo o copy puntual
 */
export function isSurgicalEdit(userMessage, { elementContext = null, isQuickEdit = false } = {}) {
  if (elementContext) return true
  if (isQuickEdit) return true
  if (!userMessage || typeof userMessage !== 'string') return false

  const normalized = userMessage.trim().toLowerCase()
  return SURGICAL_PATTERNS.some((pattern) => pattern.test(normalized))
}

/**
 * Determina si la instrucción solicita la creación o ampliación de un módulo, app o flujo de negocio
 */
export function isModuleOrAppCreation(userMessage) {
  if (!userMessage || typeof userMessage !== 'string') return false

  const raw = userMessage.trim()
  const normalized = raw.toLowerCase()
  const words = raw.split(/\s+/).filter(Boolean)

  // Prompts excesivamente largos (> 80 palabras) con especificaciones técnicas detalladas no requieren amplificación genérica
  if (words.length > 80) return false

  const hasModuleTrigger = MODULE_OR_APP_TRIGGERS.some((p) => p.test(normalized))
  const hasDomainEntity = DOMAIN_ENTITIES.some((p) => p.test(normalized))

  // Caso 1: Tiene frase de módulo explícita ("sistema de ventas", "crea un módulo de clientes")
  if (hasModuleTrigger) return true

  // Caso 2: Pide entidad de negocio con verbo de acción en prompt conciso (<= 45 palabras)
  // Ej: "hazme un control de gastos", "agrega productos con fotos y precios"
  if (hasDomainEntity && words.length <= 45) {
    const hasAction = /\b(?:haz|crea|construye|agrega|anade|añade|implementa|quiero|necesito|pon)\b/i.test(normalized)
    if (hasAction) return true
  }

  return false
}

import { isWebOrLandingRequest, getSeniorArtDirectionDirectives } from './designDirector.js'
import { isSeoTarget, getTechnicalSeoDirectives } from './seoArchitect.js'
import { detectIndustry } from './imageCurator.js'

/**
 * Amplifica silenciosamente el prompt inyectando directivas de madurez de producto,
 * dirección de arte UI/UX senior y arquitectura SEO técnico Google 2026.
 * @param {string} userMessage - Mensaje original del usuario
 * @param {object} options
 * @param {string} options.turnMode - Modo actual del turno ('BUILD', 'QUERY', 'PLAN')
 * @param {object} options.elementContext - Contexto de elemento seleccionado con inspector visual
 * @param {boolean} options.isQuickEdit - Si es una mutación rápida directa
 * @param {boolean} options.hasDatabase - Si el proyecto tiene base de datos activa
 * @param {object} [options.promptIntent] - Intención analizada del prompt
 * @returns {{ isAmplified: boolean, amplifiedDirectives: string, scope: string }}
 */
export function amplifyPrompt(userMessage, { turnMode = 'BUILD', elementContext = null, isQuickEdit = false, hasDatabase = false, promptIntent = null } = {}) {
  if (turnMode !== 'BUILD') {
    return { isAmplified: false, amplifiedDirectives: '', scope: 'NON_BUILD' }
  }

  if (isSurgicalEdit(userMessage, { elementContext, isQuickEdit })) {
    return { isAmplified: false, amplifiedDirectives: '', scope: 'SURGICAL' }
  }

  // Si es una pregunta pura sin orden de mutación (ej. auditoría, diagnóstico, consulta de capacidades):
  // NO amplificar con órdenes de construcción de módulos CRUD ni componentes de código imperativos.
  const isPureQuestion = Boolean(promptIntent?.isPureQuestion && !promptIntent?.hasActionOrder)

  const isWebLanding = isWebOrLandingRequest(userMessage)
  const isModule = !isPureQuestion && isModuleOrAppCreation(userMessage)
  const isSeo = isSeoTarget(userMessage)

  if (!isModule && !isWebLanding && !isSeo) {
    return { isAmplified: false, amplifiedDirectives: '', scope: 'STANDARD' }
  }

  const sections = []
  const cleanPrompt = (userMessage || '').trim().replace(/["\n\r]/g, ' ')

  // 1. Amplificación de Producto Empresarial (solo si NO es pregunta pura y pide módulo CRUD)
  if (isModule) {
    const dbDirectives = hasDatabase
      ? `
5. PERSISTENCIA REAL Y AUTOMÁTICA EN BASE DE DATOS:
   - Prohibido dejar arrays en memoria (\`useState([...])\`) que se reinician al recargar.
   - Emite \`propose_migration\` o \`execute_ddl\` para aprovisionar la tabla real en PostgreSQL con tipos precisos (UUID, TIMESTAMP, JSONB, TEXT) y RLS activa.
   - Inserta entre 3 y 5 registros semilla realistas en la misma migración o inicialización para que la interfaz arranque llena de vida y no vacía.`
      : ''

    sections.push(`
<amplified_product_architecture_directives>
AMPLIFICACIÓN COGNITIVA DE PRODUCTO (ESTÁNDAR FLOWPRO / LOVABLE ENTERPRISE):
El usuario ha formulado un requerimiento conciso ("${cleanPrompt}"). Como Arquitecto Principal Full-Stack, debes interpretar y materializar este requerimiento con máxima madurez de producto, profundidad y riqueza funcional al primer intento:

1. CABECERA CON KPIS Y MÉTRICAS EN VIVO:
   - Renderiza un grid superior con 3 o 4 tarjetas de métricas clave (KPIs) calculadas reactiva y dinámicamente a partir de los datos reales (ej. Total Registros, Activos vs Inactivos, Monto o Promedio Total, Variación o Alertas).
   - Incluye iconos temáticos claros de Lucide para cada indicador con acentos de color coherentes.

2. BARRA DE HERRAMIENTAS Y CONTROL:
   - Input de búsqueda instantánea que filtre por texto en tiempo real.
   - Filtros de estado o categoría (dropdown o pills: "Todos", "Activos", "Pendientes", etc.).
   - Botón de acción principal destacado ("+ Nuevo Registro", "+ Crear...", etc.) con icono de suma y llamada clara a la acción.

3. FLUJO CRUD COMPLETO Y ROBUSTO:
   - Modal o Drawer accesible y estético para Creación y Edición de registros, con validación de formularios y campos tipados.
   - Confirmación explícita para eliminar registros (evitar borrados accidentales).
   - Estados de carga claros (spinners \`Loader2\` con animación \`animate-spin\`) y deshabilitación de botones mientras se procesa la acción.
   - Feedback visual inmediato tras cada operación (notificaciones, banners o cambios de estado limpios).

4. ESTADOS VACÍOS PROFESIONALES (EMPTY STATES):
   - Cuando no existan registros o el filtro devuelva cero resultados, no dejes la pantalla en blanco ni muestres una tabla vacía.
   - Muestra una ilustración/icono suave, un título amigable y un botón de llamada a la acción ("Crear primer registro") para romper la frialdad.${dbDirectives}
</amplified_product_architecture_directives>`.trim())
  }

  // 2. Dirección de Arte UI/UX Senior (estética Bento Grid, tipografía, micro-interacciones, CRO)
  if (isWebLanding || isModule) {
    const industry = detectIndustry(userMessage)
    sections.push(getSeniorArtDirectionDirectives({ isWebOrLanding: isWebLanding, isDiagnostic: isPureQuestion, industry }))
  }

  // 3. Arquitectura SEO Técnico Google 2026 & AI Overviews (HTML5 semántico, Schema.org JSON-LD, Core Web Vitals)
  if (isWebLanding || isSeo) {
    sections.push(getTechnicalSeoDirectives({ isDiagnostic: isPureQuestion }))
  }

  const amplifiedDirectives = sections.join('\n\n')

  return {
    isAmplified: true,
    amplifiedDirectives,
    scope: isPureQuestion ? 'DIAGNOSTIC' : isWebLanding ? 'LANDING_PAGE' : isModule ? 'FULL_MODULE' : 'SEO'
  }
}
