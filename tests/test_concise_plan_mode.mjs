import assert from 'node:assert/strict'
import { compactInteractiveTurnText } from '../backend/src/services/agent.js'

console.log('🧪 Starting test_concise_plan_mode.mjs...')

// 1. Test case: Bloated output with ASCII tree, task repetitions, and closing question
const bloatedPlanOutput = `### Estructura del Sistema

\`\`\`text
src/
├── components/
│   ├── AboutSection.jsx           # Trayectoria corporativa, acreditaciones y testimonios
│   ├── ExtinguisherCalculator.jsx # Cotizador interactivo de extintores
│   ├── GroundingCalculator.jsx    # Calculadora técnica de sistemas de puesta a tierra
│   ├── Navigation.jsx             # Barra de navegación con logo corporativo
│   └── ServiceCard.jsx            # Tarjetas de servicios
├── App.jsx                        # Layout general y anclas de navegación
└── index.css                      # Variables CSS y tokens de marca
\`\`\`

1. Implementar la calculadora técnica de puesta a tierra con selección de electrodos y resistividad de suelo.
2. Integrar filtros interactivos de productos y extintores por capacidad y agente extintor.
3. Actualizar la navegación principal con accesos directos a ambas herramientas técnicas.
4. Ajustar estilos globales de tipografía y colores según tokens de SERGESOL.

¿Deseas que comencemos con la ejecución o prefieres ajustar algún detalle antes de arrancar?`

const proposedPlan = {
  title: 'Calculadora de Puesta a Tierra y Filtros por Categoría para SERGESOL PERÚ',
  summary: 'Implementar herramientas interactivas de ingeniería y catálogo clasificado.',
  tasks: [
    { id: 'task_1', title: 'Calculadora de puesta a tierra' },
    { id: 'task_2', title: 'Filtros de catálogo' }
  ]
}

const cleanedPlanText = compactInteractiveTurnText(bloatedPlanOutput, proposedPlan, null)

console.log('Sanitized Plan Mode Text Result:\n', cleanedPlanText)

// Assertions for Plan Mode
assert.ok(cleanedPlanText.length <= 220, `Plan text should be <= 220 characters, got: ${cleanedPlanText.length}`)
assert.ok(!cleanedPlanText.includes('```'), 'Must not contain markdown code blocks')
assert.ok(!cleanedPlanText.includes('###'), 'Must not contain markdown headers')
assert.ok(!cleanedPlanText.includes('├──'), 'Must not contain ASCII tree branches')
assert.ok(!cleanedPlanText.includes('¿Deseas que comencemos'), 'Must not contain closing redundant questions')
assert.ok(
  cleanedPlanText.includes('He preparado el plan para **Calculadora de Puesta a Tierra y Filtros por Categoría para SERGESOL PERÚ**') ||
  cleanedPlanText.length > 20,
  'Must have clean friendly text or fallback'
)

// 2. Test case: Normal concise output with closing question
const conciseWithQuestion = `He preparado el plan para la integración del cotizador interactivo. ¿Deseas que comencemos ahora?`
const cleanedConcise = compactInteractiveTurnText(conciseWithQuestion, proposedPlan, null)
console.log('Concise Input with closing question ->', cleanedConcise)
assert.ok(!cleanedConcise.includes('¿Deseas que comencemos'), 'Should strip closing question')
assert.ok(cleanedConcise.includes('He preparado el plan'), 'Should retain intro sentence')

// 3. Test case: askedQuestion with repeated list of questions and options
const bloatedQuestionOutput = `### Configuración Inicial

Para definir la mejor solución para tu proyecto, por favor elige tus preferencias:

1. ¿Qué estilo de diseño prefieres?
   - Moderno y minimalista
   - Corporativo e industrial
2. ¿Qué paleta de colores deseas utilizar?
   - Azul corporativo
   - Verde ecológico`

const askedQuestion = {
  questions: [
    { id: 'q1', text: '¿Qué estilo de diseño prefieres?' },
    { id: 'q2', text: '¿Qué paleta de colores deseas utilizar?' }
  ]
}

const cleanedQuestionText = compactInteractiveTurnText(bloatedQuestionOutput, null, askedQuestion)
console.log('Sanitized Question Text Result:\n', cleanedQuestionText)

// Assertions for Question Mode
assert.ok(cleanedQuestionText.length <= 200, `Question intro text should be <= 200 characters, got: ${cleanedQuestionText.length}`)
assert.ok(!cleanedQuestionText.includes('###'), 'Must not contain markdown headers')
assert.ok(!cleanedQuestionText.includes('1. ¿Qué estilo'), 'Must not duplicate numbered questions')
assert.ok(!cleanedQuestionText.includes('- Moderno'), 'Must not duplicate options')
assert.ok(cleanedQuestionText.includes('Para definir la mejor solución'), 'Should keep introductory context')

console.log('✅ ALL CONCISE PLAN & QUESTION MODE TESTS PASSED!')
