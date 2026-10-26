/**
 * Colloquial Skill & UI Component Matcher
 * Maps informal Spanish expressions to technical UI components (shadcn/ui) and architectural skills.
 * Inspired by Lovable's implicit trigger catalog (rne).
 */

export const SKILL_TRIGGERS = [
  {
    id: 'redesign',
    name: 'Rediseño y Estética Moderna',
    patterns: [
      /\b(m[aá]s\s+(bonito|moderno|elegante|pro|profesional|est[eé]tico|limpio|atractivo|cuidado))\b/i,
      /\b(cambia(r)?\s+(el\s+)?(look|diseño|aspecto|estilo|apariencia))\b/i,
      /\b(dale\s+un\s+(lavado\s+de\s+cara|toque\s+moderno|rediseño))\b/i,
      /\b(se\s+ve\s+(muy\s+)?(feo|anticuado|viejo|b[aá]sico|aburrido|plano))\b/i,
      /\b(hazlo\s+(m[aá]s\s+)?(profesional|premium|moderno|llamativo))\b/i
    ],
    directive: `[DIRECTIVA DE REDISEÑO ESTÉTICO]
El usuario solicita una mejora visual. No apliques colores arbitrarios en hex/rgb crudo. Utiliza tokens semánticos (bg-background, text-foreground, border-border, bg-card, bg-primary). Asegura espaciado holgado (gap-4/gap-6, p-6), bordes redondeados consistentes (rounded-xl/rounded-2xl), sombras suaves (shadow-sm/shadow-md) y micro-interacciones sutiles con hover/transition.`
  },
  {
    id: 'responsive_mobile',
    name: 'Optimización Móvil / Responsive',
    patterns: [
      /\b(no\s+se\s+ve\s+bien\s+en\s+(el\s+)?(celular|m[oó]vil|tel[eé]fono))\b/i,
      /\b(en\s+(el\s+)?(m[oó]vil|celular|tel[eé]fono)\s+se\s+rompe)\b/i,
      /\b(para\s+(el\s+)?(tel[eé]fono|celular|m[oó]vil|smartphone))\b/i,
      /\b(hazlo\s+responsive|adaptable\s+a\s+m[oó]vil|en\s+pantalla\s+chica)\b/i,
      /\b(se\s+desborda\s+en\s+(celular|m[oó]vil))\b/i
    ],
    directive: `[DIRECTIVA DE RESPONSIVE DESIGN & MOBILE-FIRST]
Optimiza inmediatamente para pantallas pequeñas (360px-430px). Usa 'flex-col md:flex-row', 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3', padding horizontal adaptable (px-4 sm:px-6), botones y elementos interactivos con target táctil mínimo de 44px, navegación con menú hamburguesa o sheet lateral en móvil, y evita anchos fijos que causen overflow horizontal.`
  },
  {
    id: 'seo_visibility',
    name: 'SEO & Visibilidad en Motores de Búsqueda',
    patterns: [
      /\b(para\s+que\s+aparezca\s+en\s+google|posicionamiento|posicionar\s+en\s+buscadores)\b/i,
      /\b(meta\s+tags?|palabras\s+clave|etiquetas\s+seo|mejorar\s+(el\s+)?seo)\b/i,
      /\b(google\s+lo\s+encuentre|optimizar\s+para\s+google)\b/i
    ],
    directive: `[DIRECTIVA DE SEO Y ESTRUCTURA SEMÁNTICA]
Implementa etiquetas semánticas HTML5 precisas (<main>, <section>, <article>, <header>, <h1> único por vista, jerarquía <h2>/<h3>). Verifica que existan metatags informativos, OpenGraph (og:title, og:description, og:image), atributos 'alt' descriptivos en todas las imágenes y un title dinámico o representativo.`
  },
  {
    id: 'a11y_readability',
    name: 'Accesibilidad y Legibilidad',
    patterns: [
      /\b(las\s+letras\s+no\s+se\s+leen|no\s+se\s+puede\s+leer|muy\s+chiquito|texto\s+pequeño)\b/i,
      /\b(contraste|accesibilidad|a11y|para\s+personas\s+mayores|se\s+pierde\s+con\s+el\s+fondo)\b/i
    ],
    directive: `[DIRECTIVA DE ACCESIBILIDAD (A11Y) Y LEGIBILIDAD]
Garantiza ratios de contraste WCAG AA mínimo (4.5:1 para texto normal, 3:1 para grande). Aumenta tamaños de fuente si es necesario (text-sm mínimo para secundarios, text-base para lectura principal). Agrega aria-label a botones con sólo íconos y asegura estados de :focus-visible nítidos.`
  }
];

export const COLLOQUIAL_UI_MAP = [
  {
    colloquial: 'ventanita / popup / modal',
    patterns: [/\b(ventanita|popup|pop-up|modal|cuadro\s+emergente|ventana\s+emergente)\b/i],
    componentName: 'Dialog',
    importSnippet: "import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';",
    directive: "Utiliza el componente canónico 'Dialog' de shadcn/ui (@/components/ui/dialog). No implementes divs flotantes caseros con position fixed ni modales rudimentarios."
  },
  {
    colloquial: 'panel lateral / menú deslizante / drawer',
    patterns: [/\b(panel\s+lateral|men[uú]\s+deslizante|drawer|panel\s+que\s+sale\s+del\s+costado|barra\s+lateral\s+desplegable)\b/i],
    componentName: 'Sheet',
    importSnippet: "import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';",
    directive: "Utiliza el componente canónico 'Sheet' de shadcn/ui (@/components/ui/sheet). Configura 'side=\"left\"' o 'side=\"right\"' según la ergonomía esperada."
  },
  {
    colloquial: 'pestañitas / solapas / tabs',
    patterns: [/\b(pestañitas?|solapas?|tabs?|pestanas?|secciones\s+con\s+pestañas)\b/i],
    componentName: 'Tabs',
    importSnippet: "import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';",
    directive: "Utiliza el componente canónico 'Tabs' de shadcn/ui (@/components/ui/tabs) para segmentar vistas sin recargar la página."
  },
  {
    colloquial: 'preguntas que se abren / acordeón / desplegable de faq',
    patterns: [/\b(preguntas\s+que\s+se\s+abren|desplegable\s+de\s+preguntas|faq\s+desplegable|acorde[oó]n|accordion|secciones\s+colapsables)\b/i],
    componentName: 'Accordion',
    importSnippet: "import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';",
    directive: "Utiliza el componente canónico 'Accordion' de shadcn/ui (@/components/ui/accordion) con 'type=\"single\" collapsible' o 'type=\"multiple\"'."
  },
  {
    colloquial: 'aviso arriba / notificación flotante / toast',
    patterns: [/\b(aviso\s+arriba|notificaci[oó]n\s+flotante|mensaje\s+emergente\s+de\s+[eé]xito|cartelito\s+de\s+aviso|alerta\s+que\s+desaparece|toast)\b/i],
    componentName: 'toast (sonner)',
    importSnippet: "import { toast } from 'sonner';",
    directive: "Dispara notificaciones efímeras usando 'toast.success(...)', 'toast.error(...)', o 'toast.info(...)' de 'sonner'."
  },
  {
    colloquial: 'tabla / grilla de datos / listado con columnas',
    patterns: [/\b(tabla|grilla\s+de\s+datos|listado\s+con\s+columnas|planilla)\b/i],
    componentName: 'Table',
    importSnippet: "import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';",
    directive: "Utiliza el componente canónico 'Table' de shadcn/ui (@/components/ui/table) con tipografía tabular y estilos uniformes."
  },
  {
    colloquial: 'tarjeta / tarjetita / recuadro',
    patterns: [/\b(tarjetitas?|recuadros?|caja\s+con\s+borde)\b/i],
    componentName: 'Card',
    importSnippet: "import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';",
    directive: "Utiliza el componente canónico 'Card' de shadcn/ui (@/components/ui/card)."
  },
  {
    colloquial: 'menú desplegable / opciones / dropdown',
    patterns: [/\b(men[uú]\s+desplegable|bot[oó]n\s+con\s+opciones|men[uú]\s+de\s+tres\s+puntitos|dropdown)\b/i],
    componentName: 'DropdownMenu',
    importSnippet: "import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';",
    directive: "Utiliza el componente canónico 'DropdownMenu' de shadcn/ui (@/components/ui/dropdown-menu)."
  }
];

/**
 * Evaluates user input against colloquial triggers and maps them to technical directives.
 * @param {string} userMessage 
 * @returns {{ matchedSkills: Array, matchedComponents: Array, directivePromptBlock: string }}
 */
export function matchColloquialSkillsAndComponents(userMessage) {
  if (!userMessage || typeof userMessage !== 'string') {
    return { matchedSkills: [], matchedComponents: [], directivePromptBlock: '' };
  }

  const matchedSkills = [];
  for (const skill of SKILL_TRIGGERS) {
    if (skill.patterns.some(pattern => pattern.test(userMessage))) {
      matchedSkills.push(skill);
    }
  }

  const matchedComponents = [];
  for (const comp of COLLOQUIAL_UI_MAP) {
    if (comp.patterns.some(pattern => pattern.test(userMessage))) {
      matchedComponents.push(comp);
    }
  }

  if (matchedSkills.length === 0 && matchedComponents.length === 0) {
    return { matchedSkills: [], matchedComponents: [], directivePromptBlock: '' };
  }

  const blocks = [];

  if (matchedSkills.length > 0) {
    blocks.push('### DIRECTIVAS DE ESPECIALIDAD DETECTADAS POR INTENCIÓN DEL USUARIO:\n' +
      matchedSkills.map(s => s.directive).join('\n\n'));
  }

  if (matchedComponents.length > 0) {
    blocks.push('### COMPONENTES DE UI CANÓNICOS REQUERIDOS (shadcn/ui):\n' +
      'El usuario utilizó lenguaje coloquial para solicitar interfaz. Utiliza obligatoriamente los siguientes componentes oficiales:\n' +
      matchedComponents.map(c => `- **${c.componentName}** (solicitado como "${c.colloquial}"):\n  ${c.directive}\n  Importación recomendada: \`${c.importSnippet}\``).join('\n'));
  }

  const directivePromptBlock = `\n\n[DIRECTIVA ESPECIALIZADA ACTIVADA POR INTENCIÓN DEL USUARIO]\n${blocks.join('\n\n')}\n`;

  return {
    matchedSkills,
    matchedComponents,
    directivePromptBlock
  };
}
