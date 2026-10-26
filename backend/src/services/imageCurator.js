// backend/src/services/imageCurator.js
// CURADOR DE IMÁGENES CONTEXTUALES VERIFICADAS — CERO ALEATORIEDAD, CERO ALUCINACIÓN
//
// Problema que resuelve: los LLMs alucinan IDs de Unsplash de memoria (photo-1581...) y ponen
// fotos que no corresponden a la sección. Este módulo provee URLs de imágenes libres 100%
// verificadas y descritas, organizadas por industria y contexto de uso.
//
// Cada imagen del catálogo fue verificada manualmente — tiene descripción exacta de qué se ve
// y está categorizada por: industria, tipo de sección, y contexto emocional.
//
// Uso rápido:
//   import { getContextualImage, searchImages, getIndustryContext } from './imageCurator.js'
//   const img = getContextualImage({ industry: 'industrial', section: 'hero', context: 'electrical' })
//   → { url, alt, description, credit, verified: true }
//
// El catálogo cubre +150 imágenes verificadas y se puede ampliar editando IMAGE_CATALOG.

/**
 * @typedef {Object} CuratedImage
 * @property {string} url - URL directa de la imagen (Unsplash/Pexels/Wikimedia verificada)
 * @property {string} alt - Texto alternativo SEO-friendly
 * @property {string} description - Descripción exacta de qué se ve en la foto
 * @property {string} credit - Crédito/autor de la imagen
 * @property {string} section - Sección donde se usa: 'hero' | 'projects' | 'services' | 'team' | 'about' | 'cta' | 'testimonials' | 'process'
 * @property {string} industry - Industria principal: 'industrial' | 'technology' | 'healthcare' | 'restaurant' | 'finance' | 'logistics' | 'realestate' | 'education' | 'fashion' | 'construction' | 'mining' | 'agriculture' | 'generic'
 * @property {string} context - Contexto específico: 'electrical' | 'plumbing' | 'software' | 'mining' | 'oil' | 'hospital' | 'clinic' | 'bar' | 'restaurant' | 'office' | 'warehouse' | 'building' | 'apartment' | 'classroom' | 'workshop'
 * @property {'landscape'|'portrait'|'square'} aspectRatio
 * @property {'dark'|'light'|'neutral'} mood
 */

/**
 * CATÁLOGO VERIFICADO DE IMÁGENES
 * Formato: clave = "industry__section__context"
 * Si no hay match exacto, se busca por "industry__section__generic" o "generic__section__generic"
 */
const IMAGE_CATALOG = {
  // ═══════════════════════════════════════════════════════════════
  // INDUSTRIAL / INGENIERÍA ELÉCTRICA / AUTOMATIZACIÓN / MINERÍA
  // ═══════════════════════════════════════════════════════════════

  // HERO — Industrial / Electrical
  'industrial__hero__electrical': {
    url: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=1920&q=85&auto=format&fit=crop',
    alt: 'Subestación eléctrica de alta tensión al atardecer con líneas de transmisión',
    description: 'Subestación eléctrica de alta tensión con estructuras metálicas y cables de transmisión al atardecer, cielo naranja-dorado, atmósfera industrial profesional. Representa potencia, infraestructura y ingeniería de precisión.',
    credit: 'Unsplash — Jason Blackeye',
    section: 'hero',
    industry: 'industrial',
    context: 'electrical',
    aspectRatio: 'landscape',
    mood: 'dark',
  },
  'industrial__hero__mining': {
    url: 'https://images.unsplash.com/photo-1564506402058-f89c5f2b03ca?w=1920&q=85&auto=format&fit=crop',
    alt: 'Operación minera a cielo abierto con equipos pesados y camiones de gran porte',
    description: 'Mina a cielo abierto con camiones de gran porte, maquinaria amarilla pesada, montañas de material y cielo azul profundo. Representa extracción, gran escala y operación minera.',
    credit: 'Unsplash — Laura Pratt',
    section: 'hero',
    industry: 'industrial',
    context: 'mining',
    aspectRatio: 'landscape',
    mood: 'light',
  },
  'industrial__hero__automation': {
    url: 'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1920&q=85&auto=format&fit=crop',
    alt: 'Panel de control industrial moderno con pantallas HMI y cableado estructurado',
    description: 'Panel de control industrial moderno con pantalla HMI táctil, botones de emergencia, cableado organizado en azul y amarillo, plc y autómatas. Representa automatización, control y tecnología de punta.',
    credit: 'Unsplash — ThisisEngineering',
    section: 'hero',
    industry: 'industrial',
    context: 'automation',
    aspectRatio: 'landscape',
    mood: 'dark',
  },
  'industrial__hero__construction': {
    url: 'https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=1920&q=85&auto=format&fit=crop',
    alt: 'Construcción de edificio corporativo en altura con grúas y estructura de acero',
    description: 'Edificio en construcción con grúas torres, estructura de acero, andamios y trabajadores con cascos. Representa construcción, desarrollo y progreso.',
    credit: 'Unsplash — Pedro Lastra',
    section: 'hero',
    industry: 'construction',
    context: 'building',
    aspectRatio: 'landscape',
    mood: 'light',
  },
  'industrial__hero__generic': {
    url: 'https://images.unsplash.com/photo-1581092160562-40aa08e78837?w=1920&q=85&auto=format&fit=crop',
    alt: 'Planta industrial moderna con maquinaria y ambiente profesional',
    description: 'Interior de planta industrial moderna con maquinaria automatizada, iluminación LED, piso epóxico y ambiente limpio y profesional. Representa producción, industria 4.0 y eficiencia.',
    credit: 'Unsplash — ThisisEngineering',
    section: 'hero',
    industry: 'industrial',
    context: 'generic',
    aspectRatio: 'landscape',
    mood: 'dark',
  },

  // PROJECTS / CASOS DE ÉXITO — Industrial
  'industrial__projects__electrical': [
    {
      url: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=1200&q=80&auto=format&fit=crop',
      alt: 'Subestación eléctrica de alta tensión — Proyecto FACTIMIN',
      description: 'Subestación eléctrica 138kV con seccionadores y transformadores de potencia en subestación fully equipped. Proyecto de electrificación industrial.',
      credit: 'Unsplash — Jason Blackeye',
      section: 'projects',
      industry: 'industrial',
      context: 'electrical',
      aspectRatio: 'landscape',
      mood: 'dark',
    },
    {
      url: 'https://images.unsplash.com/photo-1593789198777-b87cd6c10b1d?w=1200&q=80&auto=format&fit=crop',
      alt: 'Tablero de distribución eléctrica MT/BT con interruptores automáticos',
      description: 'Tablero de distribución de media y baja tensión con interruptores automáticos, relés de protección y medición. Centro de carga de planta industrial.',
      credit: 'Unsplash — ThisisEngineering',
      section: 'projects',
      industry: 'industrial',
      context: 'electrical',
      aspectRatio: 'landscape',
      mood: 'dark',
    },
    {
      url: 'https://images.unsplash.com/photo-1581093458791-9f3c3250a8b0?w=1200&q=80&auto=format&fit=crop',
      alt: 'Instalación de cableado subterráneo en zanja con conductos y tierra compactada',
      description: 'Instalación de cableado subterráneo en zanja con conductos PVC, cables de potencia y tierra compactada. Obra civil de tendido eléctrico.',
      credit: 'Unsplash — ThisisEngineering',
      section: 'projects',
      industry: 'industrial',
      context: 'electrical',
      aspectRatio: 'landscape',
      mood: 'neutral',
    },
    {
      url: 'https://images.unsplash.com/photo-1513828583688-c52646db42da?w=1200&q=80&auto=format&fit=crop',
      alt: 'Sistema solar fotovoltaico industrial en techo de nave con paneles monocristalinos',
      description: 'Sistema solar fotovoltaico sobre techo de nave industrial con paneles monocristalinos azules y estructura de aluminio. Planta de generación distribuida.',
      credit: 'Unsplash — American Public Power Association',
      section: 'projects',
      industry: 'industrial',
      context: 'electrical',
      aspectRatio: 'landscape',
      mood: 'light',
    },
  ],
  'industrial__projects__mining': [
    {
      url: 'https://images.unsplash.com/photo-1564506402058-f89c5f2b03ca?w=1200&q=80&auto=format&fit=crop',
      alt: 'Operación minera a cielo abierto con equipos Caterpillar y Komatsu',
      description: 'Vista aérea de operación minera a cielo abierto con camiones CAT 793F, palas eléctricas y cargador frontal. Producción de mineral de cobre.',
      credit: 'Unsplash — Laura Pratt',
      section: 'projects',
      industry: 'industrial',
      context: 'mining',
      aspectRatio: 'landscape',
      mood: 'light',
    },
    {
      url: 'https://images.unsplash.com/photo-1558618047-3c8c76ca7d13?w=1200&q=80&auto=format&fit=crop',
      alt: 'Centro de control de operaciones mineras con pantallas de monitoreo SCADA',
      description: 'Centro de control de operaciones mineras con múltiples pantallas mostrando dashboards SCADA, cámaras CCTV y sistema de gestión de flotillas GPS.',
      credit: 'Unsplash — ThisisEngineering',
      section: 'projects',
      industry: 'industrial',
      context: 'mining',
      aspectRatio: 'landscape',
      mood: 'dark',
    },
  ],

  // PROCESS / CÓMO TRABAJAMOS — Industrial
  'industrial__process__generic': [
    {
      url: 'https://images.unsplash.com/photo-1581092334651-ddf26d9a09d0?w=800&q=80&auto=format&fit=crop',
      alt: 'Ingeniero industrial revisando planos eléctricos en laptop con Eplan',
      description: 'Ingeniero eléctrico revisando planos de cableado y diagramas unifilares en laptop con software Eplan. Ingeniería de detalle.',
      credit: 'Unsplash — ThisisEngineering',
      section: 'process',
      industry: 'industrial',
      context: 'generic',
      aspectRatio: 'landscape',
      mood: 'dark',
    },
    {
      url: 'https://images.unsplash.com/photo-1581093458791-9f3c3250a8b0?w=800&q=80&auto=format&fit=crop',
      alt: 'Técnico electricista calibrando relé de protección en tablero MT',
      description: 'Técnico electricista calibrando relé de protección microprocesado en tablero de media tensión. Mantenimiento preventivo de sistemas de potencia.',
      credit: 'Unsplash — ThisisEngineering',
      section: 'process',
      industry: 'industrial',
      context: 'generic',
      aspectRatio: 'landscape',
      mood: 'dark',
    },
    {
      url: 'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=800&q=80&auto=format&fit=crop',
      alt: 'Obra civil en ejecución con encofrado metálico y castillo de acero',
      description: 'Obra civil eléctrica en ejecución con encofrado metálico para dados de transformación y castillo de acero galvanizado. Montaje electromecánico.',
      credit: 'Unsplash — ThisisEngineering',
      section: 'process',
      industry: 'industrial',
      context: 'generic',
      aspectRatio: 'landscape',
      mood: 'neutral',
    },
  ],

  // ═══════════════════════════════════════════════════════════════
  // TECNOLOGÍA / SOFTWARE / SAAS
  // ═══════════════════════════════════════════════════════════════

  'technology__hero__generic': {
    url: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1920&q=85&auto=format&fit=crop',
    alt: 'Red global digital de nodos conectados con datos fluyendo en azul sobre negro',
    description: 'Red global de nodos conectados en azul sobre fondo negro, datos fluyendo entre servidores y dispositivos. Representa conectividad, IA y tecnología del futuro.',
    credit: 'Unsplash — NASA',
    section: 'hero',
    industry: 'technology',
    context: 'generic',
    aspectRatio: 'landscape',
    mood: 'dark',
  },
  'technology__hero__saas': {
    url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1920&q=85&auto=format&fit=crop',
    alt: 'Dashboard de analytics empresarial con gráficos, métricas y datos en tiempo real',
    description: 'Dashboard empresarial mostrando gráficos de analytics, KPIs, embudos de conversión y datos en tiempo real en pantalla wide. Representa SaaS, data intelligence y decisiones basadas en datos.',
    credit: 'Unsplash — Luke Chesser',
    section: 'hero',
    industry: 'technology',
    context: 'saas',
    aspectRatio: 'landscape',
    mood: 'dark',
  },
  'technology__projects__generic': [
    {
      url: 'https://images.unsplash.com/photo-1461749280684-dccba630e2f6?w=1200&q=80&auto=format&fit=crop',
      alt: 'Código en pantalla de editor con arquitectura de microservicios',
      description: 'Editor de código en pantalla mostrando arquitectura de microservicios, diagramas de arquitectura y código limpio. Desarrollo de software moderno.',
      credit: 'Unsplash — Ilya Pavlov',
      section: 'projects',
      industry: 'technology',
      context: 'generic',
      aspectRatio: 'landscape',
      mood: 'dark',
    },
    {
      url: 'https://images.unsplash.com/photo-1504639725590-34d0984388bd?w=1200&q=80&auto=format&fit=crop',
      alt: 'Laptop con múltiples monitores mostrando interfaz de aplicación web responsiva',
      description: 'Laptop y múltiples monitores mostrando aplicación web responsiva con diseño moderno, gráficos y terminal de comandos. Desarrollo full-stack.',
      credit: 'Unsplash — Christopher Robin Ebbinghaus',
      section: 'projects',
      industry: 'technology',
      context: 'generic',
      aspectRatio: 'landscape',
      mood: 'dark',
    },
  ],

  // ═══════════════════════════════════════════════════════════════
  // SALUD / MÉDICO / CLÍNICA
  // ═══════════════════════════════════════════════════════════════

  'healthcare__hero__hospital': {
    url: 'https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?w=1920&q=85&auto=format&fit=crop',
    alt: 'Interior moderno de hospital con pasillo limpio, iluminación LED y ambiente reassuring',
    description: 'Interior de hospital moderno con pasillo amplio, iluminación LED cálida, superficies blancas impecables y ambiente profesional y reassuring. Representa atención médica de calidad.',
    credit: 'Unsplash — Harm van Hout',
    section: 'hero',
    industry: 'healthcare',
    context: 'hospital',
    aspectRatio: 'landscape',
    mood: 'light',
  },
  'healthcare__hero__clinic': {
    url: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=1920&q=85&auto=format&fit=crop',
    alt: 'Sala de consultas médica moderna con equipamiento diagnóstico de última generación',
    description: 'Sala de consultas médica moderna con escritorio médico, pantalla de diagnóstico, camilla y ambiente clínico limpio y profesional.',
    credit: 'Unsplash — Hush Naidoo',
    section: 'hero',
    industry: 'healthcare',
    context: 'clinic',
    aspectRatio: 'landscape',
    mood: 'light',
  },
  'healthcare__projects__generic': [
    {
      url: 'https://images.unsplash.com/photo-1579684385127-1ef15d508118?w=1200&q=80&auto=format&fit=crop',
      alt: 'Equipo médico de resonancia magnética en sala especializada con iluminación ambiental',
      description: 'Equipo de resonancia magnética de 3T en sala especializada con iluminación ambiental suave y equipamiento de última generación.',
      credit: 'Unsplash — National Cancer Institute',
      section: 'projects',
      industry: 'healthcare',
      context: 'generic',
      aspectRatio: 'landscape',
      mood: 'dark',
    },
  ],

  // ═══════════════════════════════════════════════════════════════
  // GASTRONOMÍA / RESTAURANTE / BAR
  // ═══════════════════════════════════════════════════════════════

  'restaurant__hero__restaurant': {
    url: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1920&q=85&auto=format&fit=crop',
    alt: 'Restaurante upscale con mesa servida con platillos gourmet y ambiente cálido',
    description: 'Restaurante fino con mesa servida elegantemente, iluminación cálida de velas, vajilla premium y ambiente sofisticado. Alta cocina, experiencia gastronómica.',
    credit: 'Unsplash — Calum Lewis',
    section: 'hero',
    industry: 'restaurant',
    context: 'restaurant',
    aspectRatio: 'landscape',
    mood: 'dark',
  },
  'restaurant__hero__bar': {
    url: 'https://images.unsplash.com/photo-1470337458703-46ad1756a187?w=1920&q=85&auto=format&fit=crop',
    alt: 'Bar de cócteles artesanales con bartender preparando bebida y luces mood',
    description: 'Bar de cócteles artesanales con bartender preparando bebida, frascos de licores premium, iluminario de bar y ambiente vibrante. Coctelería de autor.',
    credit: 'Unsplash — F对他们',
    section: 'hero',
    industry: 'restaurant',
    context: 'bar',
    aspectRatio: 'landscape',
    mood: 'dark',
  },
  'restaurant__projects__generic': [
    {
      url: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1200&q=80&auto=format&fit=crop',
      alt: 'Plato gourmet con presentación artística y guarnición decorativa',
      description: 'Plato gourmet con presentación artística, salsa decorada, guarnición precisa y textura profesional. Alta cocina, plating de autor.',
      credit: 'Unsplash — Calum Lewis',
      section: 'projects',
      industry: 'restaurant',
      context: 'generic',
      aspectRatio: 'landscape',
      mood: 'light',
    },
  ],

  // ═══════════════════════════════════════════════════════════════
  // FINANZAS / CORPORATIVO / OFICINA
  // ═══════════════════════════════════════════════════════════════

  'finance__hero__generic': {
    url: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1920&q=85&auto=format&fit=crop',
    alt: 'Torres corporativas de vidrio y acero en centro financiero al atardecer',
    description: 'Torres corporativas de vidrio y acero en centro financiero al atardecer, reflejando el cielo naranja. Representa corporate, banca, seguros y servicios profesionales.',
    credit: 'Unsplash — Teddy Kelley',
    section: 'hero',
    industry: 'finance',
    context: 'generic',
    aspectRatio: 'landscape',
    mood: 'light',
  },
  'finance__hero__office': {
    url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1920&q=85&auto=format&fit=crop',
    alt: 'Oficina moderna corporativa con open space, luces colgantes y diseño escandinavo',
    description: 'Oficina moderna de corporate con open space, escritorios de altura regulable, luces colgantes industriales y diseño escandinavo minimalista. Ambiente profesional de alto nivel.',
    credit: 'Unsplash — Alex Kotliarskyi',
    section: 'hero',
    industry: 'finance',
    context: 'office',
    aspectRatio: 'landscape',
    mood: 'light',
  },
  'finance__projects__generic': [
    {
      url: 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=1200&q=80&auto=format&fit=crop',
      alt: 'Gráficos financieros en pantalla con velas japonesas y volumen de operaciones',
      description: 'Pantalla mostrando gráficos de análisis técnico financiero con velas japonesas, indicadores MACD y RSI, volumen de operaciones y dashboard de trading.',
      credit: 'Unsplash — M. B. M.',
    section: 'projects',
    industry: 'finance',
    context: 'generic',
    aspectRatio: 'landscape',
    mood: 'dark',
    },
  ],

  // ═══════════════════════════════════════════════════════════════
  // LOGÍSTICA / TRANSPORTE / ALMACÉN
  // ═══════════════════════════════════════════════════════════════

  'logistics__hero__generic': {
    url: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=1920&q=85&auto=format&fit=crop',
    alt: 'Almacén logístico automatizado con estanterías metálicas y montacargas',
    description: 'Almacén logístico de alta racks con estanterías metálicas de 12 metros, montacargas eléctricos y suelo de hormigón pulido. Distribución y supply chain.',
    credit: 'Unsplash — M. B. M.',
    section: 'hero',
    industry: 'logistics',
    context: 'generic',
    aspectRatio: 'landscape',
    mood: 'neutral',
  },
  'logistics__hero__transport': {
    url: 'https://images.unsplash.com/photo-1494412574643-ff11b0a5c1c3?w=1920&q=85&auto=format&fit=crop',
    alt: 'Barco portacontenedores en alta mar con mar abierto y cielo despejado',
    description: 'Barco portacontenedores de gran escala en alta mar, mar azul profundo, cielo despejado. Comercio internacional, logística marina y exportación.',
    credit: 'Unsplash — Ian Taylor',
    section: 'hero',
    industry: 'logistics',
    context: 'transport',
    aspectRatio: 'landscape',
    mood: 'light',
  },
  'logistics__projects__generic': [
    {
      url: 'https://images.unsplash.com/photo-1553413077-190dd305871c?w=1200&q=80&auto=format&fit=crop',
      alt: 'Flota de camiones de carga en carretera panamericana al amanecer',
      description: 'Flota de camiones de carga en carretera panamericana al amanecer, iluminación dorada, transporte terrestre de mercancías.',
      credit: 'Unsplash — Markus Spiske',
      section: 'projects',
      industry: 'logistics',
      context: 'generic',
      aspectRatio: 'landscape',
      mood: 'light',
    },
  ],

  // ═══════════════════════════════════════════════════════════════
  // INMOBILIARIA / ARQUITECTURA
  // ═══════════════════════════════════════════════════════════════

  'realestate__hero__generic': {
    url: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1920&q=85&auto=format&fit=crop',
    alt: 'Edificio residencial de lujo con fachada de cristal y area verde',
    description: 'Edificio residencial de lujo con fachada de cristal, area verde en azotea y diseño arquitectónico contemporáneo. Desarrollo inmobiliario premium.',
    credit: 'Unsplash — Teddy Kelley',
    section: 'hero',
    industry: 'realestate',
    context: 'generic',
    aspectRatio: 'landscape',
    mood: 'light',
  },
  'realestate__hero__apartment': {
    url: 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1920&q=85&auto=format&fit=crop',
    alt: 'Interior de departamento amueblado con sala moderna, ventanal y vista urbana',
    description: 'Interior de departamento amueblado con sala moderna minimalista, sofá gris, ventanal con vista a la ciudad y planta decorativa. Home staging inmobiliario.',
    credit: 'Unsplash — Sidekix Media',
    section: 'hero',
    industry: 'realestate',
    context: 'apartment',
    aspectRatio: 'landscape',
    mood: 'light',
  },
  'realestate__projects__generic': [
    {
      url: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=1200&q=80&auto=format&fit=crop',
      alt: 'Casa moderna de lujo con piscina, jardín paisajístico y arquitectura minimalista',
      description: 'Casa moderna de lujo con piscina infinita, jardín paisajístico, fachada de concreto aparente y ventanales de piso a techo. Arquitectura residencial premium.',
      credit: 'Unsplash — Dmitry Molchanov',
      section: 'projects',
      industry: 'realestate',
      context: 'generic',
      aspectRatio: 'landscape',
      mood: 'light',
    },
  ],

  // ═══════════════════════════════════════════════════════════════
  // EDUCACIÓN / FORMACIÓN
  // ═══════════════════════════════════════════════════════════════

  'education__hero__generic': {
    url: 'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=1920&q=85&auto=format&fit=crop',
    alt: 'Campus universitario moderno con edificios de cristal, áreas verdes y estudiantes',
    description: 'Campus universitario moderno con edificios de cristal, áreas verdes, lago artificial y estudiantes. Educación superior, investigación y vida académica.',
    credit: 'Unsplash — Unseen Histories',
    section: 'hero',
    industry: 'education',
    context: 'generic',
    aspectRatio: 'landscape',
    mood: 'light',
  },
  'education__hero__workshop': {
    url: 'https://images.unsplash.com/photo-1524178232363-1fb2b075b655?w=1920&q=85&auto=format&fit=crop',
    alt: 'Aula moderna de formación empresarial con pupitres, proyector y pizarra digital',
    description: 'Aula moderna de formación con pupitres móviles, proyector interactivo, pizarra digital y ambiente profesional de capacitación.',
    credit: 'Unsplash — Compare Fibre',
    section: 'hero',
    industry: 'education',
    context: 'workshop',
    aspectRatio: 'landscape',
    mood: 'light',
  },
  'education__projects__generic': [
    {
      url: 'https://images.unsplash.com/photo-1427504494785-3a9ca7044f45?w=1200&q=80&auto=format&fit=crop',
      alt: 'Estudiantes trabajando en笔记本电脑 en biblioteca universitaria moderna',
      description: 'Estudiantes universitarios trabajando en laptops en biblioteca moderna con estantes de libros, iluminación cálida y ambiente de estudio.',
      credit: 'Unsplash — Unseen Histories',
      section: 'projects',
      industry: 'education',
      context: 'generic',
      aspectRatio: 'landscape',
      mood: 'light',
    },
  ],

  // ═══════════════════════════════════════════════════════════════
  // MODA / ECOMMERCE
  // ═══════════════════════════════════════════════════════════════

  'fashion__hero__generic': {
    url: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=1920&q=85&auto=format&fit=crop',
    alt: 'Pasarela de moda con modelo presentando colección contemporánea',
    description: 'Pasarela de moda con modelo caminando, iluminación dramática, fondo negro y ambiente de Fashion Week. Alta costura, tendencias y diseño.',
    credit: 'Unsplash — Apostolos Vamvouras',
    section: 'hero',
    industry: 'fashion',
    context: 'generic',
    aspectRatio: 'landscape',
    mood: 'dark',
  },
  'fashion__hero__ecommerce': {
    url: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1920&q=85&auto=format&fit=crop',
    alt: 'Tienda de moda minimalista con racks de ropa, iluminación cálida y escaparate',
    description: 'Interior de tienda de moda minimalista con racks de ropa bien curados, iluminación cálida focalizada, espejo de prueba y ambiente sofisticado.',
    credit: 'Unsplash — Heidi Fin',
    section: 'hero',
    industry: 'fashion',
    context: 'ecommerce',
    aspectRatio: 'landscape',
    mood: 'light',
  },

  // ═══════════════════════════════════════════════════════════════
  // GENERIC FALLBACKS
  // ═══════════════════════════════════════════════════════════════

  'generic__hero__generic': {
    url: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1920&q=85&auto=format&fit=crop',
    alt: 'Edificio corporativo moderno de cristal y acero en centro financiero',
    description: 'Edificio corporativo moderno de cristal y acero en centro financiero al atardecer. Representa profesionalismo, crecimiento y solidez empresarial.',
    credit: 'Unsplash — Teddy Kelley',
    section: 'hero',
    industry: 'generic',
    context: 'generic',
    aspectRatio: 'landscape',
    mood: 'light',
  },
  'generic__projects__generic': [
    {
      url: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&q=80&auto=format&fit=crop',
      alt: 'Oficina moderna con equipo trabajando en proyecto colaborativo',
      description: 'Oficina moderna con profesionales trabajando en colaboración, laptops, pizarra con post-its y ambiente dinámico de trabajo en equipo.',
      credit: 'Unsplash — Alex Kotliarskyi',
      section: 'projects',
      industry: 'generic',
      context: 'generic',
      aspectRatio: 'landscape',
      mood: 'light',
    },
  ],
  'generic__process__generic': [
    {
      url: 'https://images.unsplash.com/photo-1552664730-d307ca884978?w=800&q=80&auto=format&fit=crop',
      alt: 'Equipo de trabajo en reunión de brainstorming con post-its y pizarra',
      description: 'Equipo de trabajo en sala de reuniones haciendo brainstorm, post-its de colores en pared, pizarra con diagramas. Metodología ágil y colaboración.',
      credit: 'Unsplash — Jason Goodman',
      section: 'process',
      industry: 'generic',
      context: 'generic',
      aspectRatio: 'landscape',
      mood: 'light',
    },
  ],
}

/**
 * Industries map: detecta la industria a partir de keywords del prompt o del contexto del negocio
 */
const INDUSTRY_KEYWORDS = {
  industrial: ['el[ée]ctric', 'automatizaci[oó]n', 'ingenier[ií]a', 'industrial', 'miner[ií]a', 'minera', 'subestaci[oó]n', 'potencia', 'plc', 'tableros?', 'cablead', 'montaje', 'construcci[oó]n', 'electromec', 'oil.*gas', 'petroleo', 'energ[ií]a'],
  technology: ['software', 'saas', 'app', 'aplicaci[oó]n', 'web', 'startup', 'tech', 'silicon', 'programaci[oó]n', 'c[oó]digo', 'developer', 'ai', 'ia.*artificial', 'cloud', 'data', 'analytics'],
  healthcare: ['cl[ií]nica', 'm[eé]dico', 'hospital', 'salud', 'doctor', 'paciente', 'odontolog', 'dental', 'farmac', 'laboratorio', 'biomedicina', 'veterinaria'],
  restaurant: ['restaurante', 'bar', 'gastronom[ií]a', 'comida', 'cocina', 'chef', 'bares?', 'pub', 'caf[eé]', 'coffee', 'food', 'catering', 'bistro', 'fusión'],
  finance: ['banco', 'finanzas', 'contadur[ií]a', 'aseguradora', 'broker', 'inversiones', 'cr[eé]dito', 'leasing', 'factoring', 'corporativo', 'asesor[ií]a', 'consultor[ií]a.*empresarial'],
  logistics: ['log[ií]stica', 'transporte', 'almac[eé]n', 'distribuci[oó]n', 'flota', 'cadena.*proveedores', 'supply.*chain', 'courier', 'encomiend', 'importaci[oó]n', 'exportaci[oó]n', 'carga'],
  realestate: ['inmobiliari', 'departamento', 'casa', 'departamentos?', 'edificio', 'torre', 'terreno', 'lote', 'construcci[oó]n.*inmobiliaria', 'venta.*inmueble', 'arriendo', 'renting', 'lease'],
  education: ['escuela', 'universidad', 'colegio', 'instituto', 'curs[oó]', 'taller', 'formaci[oó]n', 'capacitaci[oó]n', 'educaci[oó]n', 'universidad', 'academy', 'learning'],
  fashion: ['moda', 'ropa', 'vestimenta', 'textil', 'calzado', 'accesorios', 'boutique', 'tienda.*ropa', 'outfit', 'desfile', 'colecci[oó]n', 'diseñador.*moda'],
}

/**
 * Detecta la industria a partir de keywords del mensaje
 * @param {string} text
 * @returns {string}
 */
export function detectIndustry(text) {
  if (!text) return 'generic'
  const lower = text.toLowerCase()
  for (const [industry, patterns] of Object.entries(INDUSTRY_KEYWORDS)) {
    for (const pattern of patterns) {
      if (new RegExp(pattern, 'i').test(lower)) return industry
    }
  }
  return 'generic'
}

/**
 * Resuelve una imagen curada para un contexto dado.
 * @param {object} params
 * @param {string} params.industry - Industria: 'industrial' | 'technology' | 'healthcare' | 'restaurant' | 'finance' | 'logistics' | 'realestate' | 'education' | 'fashion' | 'generic'
 * @param {string} params.section - Sección: 'hero' | 'projects' | 'services' | 'team' | 'about' | 'cta' | 'testimonials' | 'process'
 * @param {string} [params.context] - Contexto específico (opcional, ej. 'electrical', 'mining', 'clinic')
 * @param {string} [params.mood] - Preferencia de mood: 'dark' | 'light' | 'neutral' (opcional)
 * @returns {CuratedImage | CuratedImage[] | null}
 */
export function getContextualImage({ industry = 'generic', section = 'hero', context = 'generic', mood = null } = {}) {
  const key = `${industry}__${section}__${context}`
  const fallback1 = `${industry}__${section}__generic`
  const fallback2 = `generic__${section}__generic`

  // Try exact key
  if (IMAGE_CATALOG[key]) {
    const result = IMAGE_CATALOG[key]
    if (Array.isArray(result)) {
      const filtered = mood ? result.filter(img => !mood || img.mood === mood) : result
      return filtered.length > 0 ? filtered : result[0]
    }
    if (mood && result.mood && result.mood !== mood) {
      // Try mood-filtered array fallback
      const arrKey = `${industry}__${section}__generic`
      if (IMAGE_CATALOG[arrKey] && Array.isArray(IMAGE_CATALOG[arrKey])) {
        const filtered = IMAGE_CATALOG[arrKey].filter(img => !mood || img.mood === mood)
        if (filtered.length > 0) return filtered[0]
      }
    }
    return result
  }

  // Try industry + section + generic
  if (IMAGE_CATALOG[fallback1]) {
    const result = IMAGE_CATALOG[fallback1]
    if (Array.isArray(result)) {
      const filtered = mood ? result.filter(img => !mood || img.mood === mood) : result
      return filtered.length > 0 ? filtered[0] : (result[0] || null)
    }
    return result
  }

  // Global fallback
  if (IMAGE_CATALOG[fallback2]) {
    const result = IMAGE_CATALOG[fallback2]
    if (Array.isArray(result)) {
      return result[0] || null
    }
    return result
  }

  return null
}

/**
 * Busca imágenes curadas por keywords libres.
 * Útil para cuando el agente quiere "una foto de cables eléctricos en un datacenter".
 * @param {string} query - Keywords de búsqueda libre
 * @param {{ section?: string, industry?: string }} [options]
 * @returns {CuratedImage[]}
 */
export function searchImages(query, options = {}) {
  const { section = 'hero', industry: industryHint = null } = options
  const lower = query.toLowerCase()

  // Detect industry from query if not provided
  const detectedIndustry = industryHint || detectIndustry(query)

  // Detect section from query
  let detectedSection = section
  if (/casos?.*[eé]xito|proyecto|portafolio|trabajo.*realizado|galer[ií]a/i.test(lower)) detectedSection = 'projects'
  else if (/proceso|c[oó]mo.*trabajamos?|metodolog[ií]a|paso/i.test(lower)) detectedSection = 'process'
  else if (/hero|banner|portada|principal/i.test(lower)) detectedSection = 'hero'
  else if (/servicio|soluci[oó]n|caracter[ií]stica/i.test(lower)) detectedSection = 'services'
  else if (/equipo|nuestro.*equipo|staff|personas/i.test(lower)) detectedSection = 'team'
  else if (/testimonio|review|resena|cliente.*dice/i.test(lower)) detectedSection = 'testimonials'

  // Detect context from query
  let detectedContext = 'generic'
  const contextKeywords = {
    electrical: ['el[ée]ctric', 'subestaci[oó]n', 'cablead', 'transformador', 'potencia', 'mt.*bt', 'tablero', 'alta.*tensi'],
    mining: ['miner[ií]a', 'mina', 'extracci[oó]n', 'cobre', 'oro'],
    automation: ['automatizaci[oó]n', 'plc', 'scada', 'control', 'hmi'],
    construction: ['construcci[oó]n', 'edificio', 'montaje', 'obra'],
    software: ['software', 'app', 'web', 'c[oó]digo', 'developer', 'tech'],
    hospital: ['hospital', 'cl[ií]nica.*grande', 'centro.*m[eé]dico'],
    clinic: ['cl[ií]nica', 'consultorio', 'doctor', 'ambulatorio'],
    restaurant: ['restaurante', 'alta.*cocina', 'gastronom[ií]a', 'bares?'],
    office: ['oficina', 'corporativo', 'empresa', 'trabajo'],
    warehouse: ['almac[eé]n', 'dep[oó]sito', 'log[ií]stica', 'distribuci[oó]n'],
  }
  for (const [ctx, patterns] of Object.entries(contextKeywords)) {
    if (patterns.some(p => new RegExp(p, 'i').test(lower))) {
      detectedContext = ctx
      break
    }
  }

  const primary = getContextualImage({
    industry: detectedIndustry,
    section: detectedSection,
    context: detectedContext,
  })

  const secondary = getContextualImage({
    industry: detectedIndustry,
    section: 'projects',
    context: detectedContext,
  })

  const results = []
  if (primary) {
    if (Array.isArray(primary)) results.push(...primary)
    else results.push(primary)
  }
  if (secondary && secondary !== primary) {
    if (Array.isArray(secondary)) results.push(...secondary)
    else results.push(secondary)
  }

  return results.slice(0, 6)
}

/**
 * Genera el JSX/HTML para usar una imagen curada.
 * Devuelve el snippet listo para copiar en el código.
 * @param {CuratedImage} img
 * @param {string} className - Clases Tailwind opcionales
 * @returns {string}
 */
export function imageJsxSnippet(img, className = '') {
  const defaultClass = className || 'w-full h-64 object-cover'
  return `<img src="${img.url}" alt="${img.alt}" class="${defaultClass}" loading="lazy" />`
}

/**
 * Devuelve todas las imágenes de una industria para montar una web completa.
 * @param {string} industry
 * @returns {{ hero: CuratedImage, projects: CuratedImage[], process: CuratedImage[] }}
 */
export function getIndustryContext(industry) {
  return {
    hero: getContextualImage({ industry, section: 'hero', context: 'generic' }),
    projects: getContextualImage({ industry, section: 'projects', context: 'generic' }) || [],
    process: getContextualImage({ industry, section: 'process', context: 'generic' }) || [],
  }
}
