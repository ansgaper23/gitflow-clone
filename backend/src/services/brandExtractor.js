// backend/src/services/brandExtractor.js
// MOTOR DE DISEÑO DIRIGIDO POR RESTRICCIONES (CONSTRAINED DESIGN ENGINE) ESTILO LOVABLE
// Extractor Matemático de Tokens de Marca (HSL) + Clasificador Determinista de Arquetipos de Industria.

import sharp from 'sharp';

/**
 * Convierte RGB (0-255) a componentes HSL [h (0-360), s (0-100), l (0-100)]
 */
export function rgbToHsl(r, g, b) {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;

  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rNorm:
        h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0);
        break;
      case gNorm:
        h = (bNorm - rNorm) / d + 2;
        break;
      case bNorm:
        h = (rNorm - gNorm) / d + 4;
        break;
    }
    h /= 6;
  }

  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

/**
 * Convierte Hex (#RRGGBB) a componentes HSL
 */
export function hexToHsl(hex) {
  if (!hex || typeof hex !== 'string') return [222, 47, 11];
  const clean = hex.replace(/^#/, '');
  if (clean.length !== 6 && clean.length !== 3) return [222, 47, 11];

  let r, g, b;
  if (clean.length === 3) {
    r = parseInt(clean[0] + clean[0], 16);
    g = parseInt(clean[1] + clean[1], 16);
    b = parseInt(clean[2] + clean[2], 16);
  } else {
    r = parseInt(clean.slice(0, 2), 16);
    g = parseInt(clean.slice(2, 4), 16);
    b = parseInt(clean.slice(4, 6), 16);
  }
  return rgbToHsl(r, g, b);
}

/**
 * Formatea HSL al estándar shadcn/Tailwind: "221 83% 53%"
 */
export function hslToString(h, s, l) {
  return `${h} ${s}% ${l}%`;
}

/**
 * Arquetipos Industriales y sus Restricciones de Diseño
 */
export const INDUSTRY_ARCHETYPES = {
  B2B_INDUSTRIAL_ENGINEERING: {
    id: 'B2B_INDUSTRIAL_ENGINEERING',
    name: 'B2B Industrial, Ingeniería y Servicios Técnicos',
    aesthetic: 'Sobria, técnica y de autoridad operativa sin decoraciones superfluas',
    radius: '0.5rem',
    typography: {
      title: 'Plus Jakarta Sans / Space Grotesk (tracking-tight font-extrabold)',
      body: 'DM Sans / Inter (text-sm md:text-base leading-relaxed)',
      technical: 'JetBrains Mono (códigos de serie SER-01, RUC, normas técnicas)'
    },
    mandatoryComponents: [
      'Topbar institucional superior con RUC oficial, horario operativo y teléfono de emergencias 24/7',
      'Hero con badges de homologación y normas regulatorias (INDECI, NFPA, NTP 350.043-1, CNE, ISO)',
      'Bento Grid de servicios industriales con fichas técnicas detalladas y códigos de identificación (SER-01, SER-02)',
      'Matriz de cumplimiento normativo y certificaciones técnicas',
      'Doble CTA de conversión: Botón de Cotización Técnica + Enlace directo a WhatsApp oficial'
    ],
    defaultPalette: {
      primaryHex: '#0f172a',
      primaryHsl: '222 47% 11%',
      secondaryHex: '#2563eb',
      secondaryHsl: '221 83% 53%',
      accentHex: '#f59e0b',
      accentHsl: '38 92% 50%',
      backgroundHsl: '210 40% 98%',
      foregroundHsl: '222 47% 11%',
      borderHsl: '214.3 31.8% 91.4%'
    }
  },
  HEALTHCARE_MEDICAL: {
    id: 'HEALTHCARE_MEDICAL',
    name: 'Clínicas, Salud y Odontología',
    aesthetic: 'Minimalist Clean, máxima luminosidad, pulcritud y confianza clínica',
    radius: '0.75rem',
    typography: {
      title: 'Plus Jakarta Sans (font-bold text-slate-900)',
      body: 'Inter (text-slate-600)',
      technical: 'JetBrains Mono (citas médicas, horarios, códigos CMP/COP)'
    },
    mandatoryComponents: [
      'Agenda interactiva de citas con selección de especialidad y fecha rápida',
      'Directorio de médicos especialistas con foto profesional, número de colegiatura y formación',
      'Indicadores de credibilidad: +10,000 pacientes atendidos, tecnología diagnóstica avanzada',
      'Botón de urgencias médicas y WhatsApp directo con recepción clínica'
    ],
    defaultPalette: {
      primaryHex: '#0284c7',
      primaryHsl: '199 89% 48%',
      secondaryHex: '#0f766e',
      secondaryHsl: '175 77% 26%',
      accentHex: '#10b981',
      accentHsl: '160 84% 39%',
      backgroundHsl: '204 100% 99%',
      foregroundHsl: '215 28% 17%',
      borderHsl: '200 30% 92%'
    }
  },
  CORPORATE_LEGAL_FINANCE: {
    id: 'CORPORATE_LEGAL_FINANCE',
    name: 'Estudios Jurídicos, Contabilidad y Finanzas',
    aesthetic: 'Warm Editorial, tipografía de prestigio combinada con sans limpia y rigor institucional',
    radius: '0.375rem',
    typography: {
      title: 'Cinzel / Playfair Display / Plus Jakarta Sans (font-semibold)',
      body: 'Inter / Source Sans 3 (leading-relaxed)',
      technical: 'JetBrains Mono (artículos de ley, cifras de patrimonio, tasas)'
    },
    mandatoryComponents: [
      'Métricas de casos ganados, empresas asesoradas o patrimonio auditado',
      'Equipo de socios senior con reseña de trayectoria y especialización',
      'Casos de éxito documentados y análisis legal/tributario destacado',
      'Formulario de consulta confidencial y agenda con socio responsable'
    ],
    defaultPalette: {
      primaryHex: '#1e293b',
      primaryHsl: '222 47% 17%',
      secondaryHex: '#78350f',
      secondaryHsl: '25 79% 26%',
      accentHex: '#d97706',
      accentHsl: '38 92% 44%',
      backgroundHsl: '40 20% 98%',
      foregroundHsl: '24 10% 10%',
      borderHsl: '30 15% 90%'
    }
  },
  SAAS_MODERN_TECH: {
    id: 'SAAS_MODERN_TECH',
    name: 'Plataformas SaaS, IA y Productos Digitales',
    aesthetic: 'Obsidian Dark o Clean Tech, Bento Grids con mockups interactivos y micro-interacciones',
    radius: '0.75rem',
    typography: {
      title: 'Space Grotesk / Plus Jakarta Sans (tracking-tight font-extrabold)',
      body: 'Inter (text-slate-400)',
      technical: 'JetBrains Mono (snippets de código, API keys, JSON payloads)'
    },
    mandatoryComponents: [
      'Hero interactivo con píldora de versión y mockup de dashboard flotante con brillo difuso',
      'Bento Grid asimétrico (tarjeta 2 cols con vista previa + tarjetas 1 col con métricas en tiempo real)',
      'Calculadora interactiva de ROI o comparativa de planes de precios mensual/anual',
      'Logos de empresas trust bar en grayscale con efecto hover iluminado'
    ],
    defaultPalette: {
      primaryHex: '#6366f1',
      primaryHsl: '239 84% 67%',
      secondaryHex: '#8b5cf6',
      secondaryHsl: '258 90% 66%',
      accentHex: '#06b6d4',
      accentHsl: '188 86% 53%',
      backgroundHsl: '240 10% 4%',
      foregroundHsl: '0 0% 98%',
      borderHsl: '240 6% 15%'
    }
  }
};

/**
 * Clasifica determinísticamente el arquetipo de industria a partir del texto o prompt
 * @param {string} text - Prompt del usuario o contenido del brochure/web
 * @returns {object} - Arquetipo con directivas y restricciones
 */
export function classifyIndustryArchetype(text = '') {
  const norm = String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // 1. B2B Industrial, Ingeniería, Electricidad, Extintores, Minería, Metalmecánica
  const industrialPattern = /\b(?:extintor|extintores|fuego|incendio|seguridad contra incendios|pozo a tierra|electricidad|electrico|electrica|tablero electrico|alta tension|baja tension|cne|nfpa|indeci|ntp|metalmecanica|metalmecanico|mineria|mina|construccion|soldadura|taller|mecanica|sergesol|electrinova|mantenimiento industrial|distribucion electrica|subestacion|equipos de proteccion|epp|seguridad industrial|planta industrial|maquinaria)\b/i;
  if (industrialPattern.test(norm)) {
    return INDUSTRY_ARCHETYPES.B2B_INDUSTRIAL_ENGINEERING;
  }

  // 2. Healthcare / Médico / Odontológico
  const healthPattern = /\b(?:clinica|medico|medica|salud|odontologia|odontologo|dental|diente|dentista|paciente|laboratorio clinico|farmacia|hospital|enfermeria|pediatria|cirugia|terapia|oftalmologia)\b/i;
  if (healthPattern.test(norm)) {
    return INDUSTRY_ARCHETYPES.HEALTHCARE_MEDICAL;
  }

  // 3. Corporativo, Legal, Contabilidad y Finanzas
  const corporatePattern = /\b(?:abogado|abogados|estudio juridico|legal|leyes|derecho|notaria|contabilidad|contable|auditoria|tributario|tributaria|finanzas|financiero|financiera|consultoria b2b|inversion|patrimonio|fondos)\b/i;
  if (corporatePattern.test(norm)) {
    return INDUSTRY_ARCHETYPES.CORPORATE_LEGAL_FINANCE;
  }

  // 4. SaaS, Modern Tech, Dashboards, IA
  const saasPattern = /\b(?:saas|software|plataforma|ia\b|ai\b|dashboard|app web|startup|cloud|cyber|ciberseguridad|api\b|consola|dev\b|developer|crm\b|erp\b)\b/i;
  if (saasPattern.test(norm)) {
    return INDUSTRY_ARCHETYPES.SAAS_MODERN_TECH;
  }

  // Fallback por defecto según palabras clave genéricas
  return INDUSTRY_ARCHETYPES.B2B_INDUSTRIAL_ENGINEERING;
}

/**
 * Muestrea cromáticamente un buffer de imagen con sharp para obtener tokens de marca dominantes
 * @param {Buffer} imageBuffer - Buffer de la imagen (logo o portada)
 * @returns {Promise<object>} - Tokens HSL calculados
 */
export async function extractPaletteFromImageBuffer(imageBuffer) {
  if (!imageBuffer || !Buffer.isBuffer(imageBuffer)) return null;

  try {
    const { data, info } = await sharp(imageBuffer)
      .resize(64, 64, { fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    let sumR = 0, sumG = 0, sumB = 0, count = 0;
    const channels = info.channels || 4;

    for (let i = 0; i < data.length; i += channels) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = channels >= 4 ? data[i + 3] : 255;

      // Descartar píxeles transparentes o casi blancos/negros puros
      if (a < 128) continue;
      const l = (Math.max(r, g, b) + Math.min(r, g, b)) / (2 * 255);
      if (l > 0.95 || l < 0.05) continue;

      sumR += r;
      sumG += g;
      sumB += b;
      count++;
    }

    if (count === 0) return null;

    const avgR = Math.round(sumR / count);
    const avgG = Math.round(sumG / count);
    const avgB = Math.round(sumB / count);

    const [h, s, l] = rgbToHsl(avgR, avgG, avgB);
    return {
      primaryHsl: hslToString(h, Math.max(s, 50), Math.min(Math.max(l, 30), 65)),
      secondaryHsl: hslToString((h + 30) % 360, Math.max(s - 20, 30), 45),
      accentHsl: hslToString((h + 180) % 360, 90, 50),
    };
  } catch (err) {
    return null;
  }
}

/**
 * Extrae y sintetiza los tokens CSS completos en formato HSL para :root en src/index.css
 * @param {object} options
 * @param {object} [options.palette] - Paleta existente (ej. de attachmentProcessor o urlInspection)
 * @param {Buffer} [options.imageBuffer] - Buffer opcional de logo o portada
 * @param {string} [options.archetypeId] - Arquetipo de industria
 * @param {string} [options.theme] - 'light' | 'dark'
 * @returns {Promise<{ tokens: object, cssRootBlock: string }>}
 */
export async function extractBrandTokens({
  palette = null,
  imageBuffer = null,
  archetypeId = 'B2B_INDUSTRIAL_ENGINEERING',
  theme = 'light'
} = {}) {
  const archetype = INDUSTRY_ARCHETYPES[archetypeId] || INDUSTRY_ARCHETYPES.B2B_INDUSTRIAL_ENGINEERING;
  const sampled = imageBuffer ? await extractPaletteFromImageBuffer(imageBuffer) : null;

  // Prioridad: 1. Muestreo sharp -> 2. Paleta proporcionada -> 3. Defaults del arquetipo
  const primaryHsl = sampled?.primaryHsl || palette?.primaryHsl || archetype.defaultPalette.primaryHsl;
  const secondaryHsl = sampled?.secondaryHsl || palette?.secondaryHsl || archetype.defaultPalette.secondaryHsl;
  const accentHsl = sampled?.accentHsl || palette?.accentHsl || archetype.defaultPalette.accentHsl;

  const isDark = theme === 'dark' || archetypeId === 'SAAS_MODERN_TECH';

  const tokens = {
    '--background': isDark ? '240 10% 4%' : '210 40% 98%',
    '--foreground': isDark ? '0 0% 98%' : '222 47% 11%',
    '--card': isDark ? '240 10% 7%' : '0 0% 100%',
    '--card-foreground': isDark ? '0 0% 98%' : '222 47% 11%',
    '--primary': primaryHsl,
    '--primary-foreground': isDark ? '222 47% 11%' : '210 40% 98%',
    '--secondary': secondaryHsl,
    '--secondary-foreground': isDark ? '0 0% 98%' : '222 47% 11%',
    '--accent': accentHsl,
    '--accent-foreground': '222 47% 11%',
    '--muted': isDark ? '240 6% 15%' : '210 40% 96.1%',
    '--muted-foreground': isDark ? '240 5% 65%' : '215.4 16.3% 46.9%',
    '--border': isDark ? '240 6% 18%' : '214.3 31.8% 91.4%',
    '--radius': archetype.radius,
  };

  const cssLines = Object.entries(tokens).map(([k, v]) => `    ${k}: ${v};`);
  const cssRootBlock = `:root {\n${cssLines.join('\n')}\n  }`;

  return { tokens, cssRootBlock, archetype };
}

/**
 * Genera la directiva de System Prompt obligatoria de arquetipo y tokens HSL
 * @param {object} options
 * @param {string} options.userPrompt
 * @param {Array} [options.attachments]
 * @param {object} [options.urlInspection]
 * @returns {Promise<string>}
 */
export async function getBrandAndArchetypeDirectives({ userPrompt = '', attachments = [], urlInspection = null } = {}) {
  const archetype = classifyIndustryArchetype(userPrompt);

  let imageBuffer = null;
  const logoOrCover = attachments.find(a =>
    a.filename?.toLowerCase().includes('logo') ||
    a.filename?.toLowerCase().includes('portada') ||
    a.filename?.toLowerCase().includes('page-01')
  );
  if (logoOrCover?.buffer) {
    imageBuffer = logoOrCover.buffer;
  }

  const { tokens, cssRootBlock } = await extractBrandTokens({
    palette: urlInspection?.designPalette || null,
    imageBuffer,
    archetypeId: archetype.id,
    theme: 'light'
  });

  return `
═══════════════════════════════════════════════════════════════════════
🎨 MOTOR DE DISEÑO DIRIGIDO POR RESTRICCIONES (ARQUETIPO: ${archetype.id})
═══════════════════════════════════════════════════════════════════════
Sector detectado: ${archetype.name}
Estética obligatoria: ${archetype.aesthetic}
Radio de bordes oficial: ${archetype.radius}

1. VARIABLES HSL OFICIALES PARA 'src/index.css':
Debes asegurarte de que 'src/index.css' contenga en su bloque ':root' los siguientes tokens de color calculados matemáticamente para esta marca:
\`\`\`css
${cssRootBlock}
\`\`\`
REGLA ESTRICTA DE ESTILOS:
- PROHIBIDO usar colores hardcodeados arbitrarios (#3b82f6, #8b5cf6) o degradados morado/azul genéricos.
- En todos tus componentes de React, usa las variables semánticas de Tailwind: 'bg-background', 'text-foreground', 'bg-primary', 'text-primary-foreground', 'bg-card', 'border-border', 'rounded-[var(--radius)]'.

2. TIPOGRAFÍAS OBLIGATORIAS:
- Títulos: ${archetype.typography.title}
- Cuerpo y Tablas: ${archetype.typography.body}
- Códigos técnicos y series: ${archetype.typography.technical}

3. COMPONENTES ARQUITECTÓNICOS OBLIGATORIOS PARA ESTE ARQUETIPO:
${archetype.mandatoryComponents.map(c => `• ${c}`).join('\n')}
`.trim();
}
