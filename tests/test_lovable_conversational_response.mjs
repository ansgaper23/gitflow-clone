import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLovableStructuredResponse } from '../backend/src/services/agent.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('🧪 Iniciando test suite: Lovable Conversational Response Standard & Brick Elimination\n');

// -------------------------------------------------------------
// Test 1: Verificar que el viejo ladrillo plano fue erradicado de agent.js
// -------------------------------------------------------------
console.log('TEST 1: Verificando erradicación del ladrillo plano en agent.js...');
const agentCode = fs.readFileSync(path.join(rootDir, 'backend/src/services/agent.js'), 'utf-8');

assert.equal(
  agentCode.includes('`Apliqué los cambios solicitados: ${allSummaries.join'),
  false,
  'FALLO: agent.js todavía contiene la concatenación de allSummaries con join'
);

assert.equal(
  agentCode.includes('`Apliqué el cambio solicitado: ${allSummaries[0]'),
  false,
  'FALLO: agent.js todavía contiene Apliqué el cambio solicitado'
);

// Verificar que la vieja directriz de changelog telegráfico no existe en agent.js
assert.equal(
  agentCode.includes('al estilo de un changelog, no una explicación'),
  false,
  'FALLO: agent.js todavía contiene la regla anti-explicación de changelog telegráfico'
);

console.log('✅ TEST 1 PASADO: Ladrillo plano y viejas directrices de changelog completamente eliminadas.');

// -------------------------------------------------------------
// Test 2: Verificar la presencia del contrato Lovable en el System Prompt
// -------------------------------------------------------------
console.log('\nTEST 2: Verificando el contrato ESTÁNDAR LOVABLE en agent.js...');
assert.ok(
  agentCode.includes('ESTILO DE RESPUESTA AL USUARIO (ESTÁNDAR LOVABLE — AMIGABLE, CLARO Y ESTRUCTURADO)'),
  'FALLO: agent.js no incluye el título del contrato ESTÁNDAR LOVABLE'
);
assert.ok(
  agentCode.includes('Apertura directa y amigable (1-2 líneas):'),
  'FALLO: agent.js no incluye la directiva de apertura directa y amigable'
);
assert.ok(
  agentCode.includes('Viñetas por Pantalla o Funcionalidad (con títulos en negrita):'),
  'FALLO: agent.js no incluye la directiva de viñetas con títulos en negrita'
);
assert.ok(
  agentCode.includes('Verificación / Caso de prueba (1 línea):'),
  'FALLO: agent.js no incluye la directiva de verificación'
);
assert.ok(
  agentCode.includes('Ten en cuenta estos detalles / alcance'),
  'FALLO: agent.js no incluye la directiva de notas de alcance/hardware/APIs'
);
console.log('✅ TEST 2 PASADO: Contrato ESTÁNDAR LOVABLE presente en el System Prompt de agent.js.');

// -------------------------------------------------------------
// Test 3: Verificar buildLovableStructuredResponse con múltiples tipos de summaries
// -------------------------------------------------------------
console.log('\nTEST 3: Verificando generación estructurada con buildLovableStructuredResponse...');

const summariesExample = [
  'Dependencias para entrenamiento en package.json',
  'Script completo de entrenamiento DNN en scripts/train.py',
  'Script de extracción de pesos y biasses en scripts/export_weights.py',
  'Motor de inferencia y simulación de fallas en src/utils/neuralEngine.js',
  'Visualizador de arquitectura DNN con flujo sináptico en src/components/NeuralVisualizer.jsx',
];

const formattedResponse = buildLovableStructuredResponse(summariesExample, {
  requiresApproval: false,
  proposedChanges: [
    { path: 'package.json' },
    { path: 'scripts/train.py' },
    { path: 'scripts/export_weights.py' },
    { path: 'src/utils/neuralEngine.js' },
    { path: 'src/components/NeuralVisualizer.jsx' },
  ],
});

console.log('--- Salida generada por buildLovableStructuredResponse ---');
console.log(formattedResponse);
console.log('---------------------------------------------------------');

assert.ok(
  formattedResponse.includes('Tu aplicación ya está lista con los siguientes cambios integrados:'),
  'FALLO: No incluye apertura amigable'
);
assert.ok(
  formattedResponse.includes('- **package.json:** Dependencias para entrenamiento') ||
  formattedResponse.includes('- **package:** Dependencias para entrenamiento'),
  'FALLO: No formateó la viñeta con negrita para package.json'
);
assert.ok(
  formattedResponse.includes('- **NeuralVisualizer:**') || formattedResponse.includes('- **src/components/NeuralVisualizer.jsx:**'),
  'FALLO: No formateó la viñeta para NeuralVisualizer'
);
assert.ok(
  formattedResponse.includes('**Verificación:** Puedes probar los nuevos controles e interactuar con la vista previa de inmediato.'),
  'FALLO: No incluye sección de verificación'
);

// Verificar con requiresApproval = true
const approvalResponse = buildLovableStructuredResponse(summariesExample.slice(0, 2), {
  requiresApproval: true,
});
assert.ok(
  approvalResponse.includes('Revisa los cambios propuestos para continuar con la siguiente etapa del proyecto.'),
  'FALLO: No incluye nota de aprobación cuando requiresApproval es true'
);

console.log('✅ TEST 3 PASADO: buildLovableStructuredResponse genera formato Markdown impecable.');

// -------------------------------------------------------------
// Test 4: Verificar bridgeClient.js
// -------------------------------------------------------------
console.log('\nTEST 4: Verificando bridgeClient.js...');
const bridgeCode = fs.readFileSync(path.join(rootDir, 'backend/src/services/providers/bridgeClient.js'), 'utf-8');
assert.ok(
  bridgeCode.includes('estándar Lovable'),
  'FALLO: bridgeClient.js no referencia el estándar Lovable'
);
assert.equal(
  bridgeCode.includes('Tu resumen final tiene que ser MUY breve (una o dos líneas, estilo changelog)'),
  false,
  'FALLO: bridgeClient.js todavía contiene la vieja directriz de resumen estilo changelog'
);
console.log('✅ TEST 4 PASADO: bridgeClient.js alineado con el estándar Lovable.');

// -------------------------------------------------------------
// Test 5: Verificar ResolutionSummary.jsx en frontend
// -------------------------------------------------------------
console.log('\nTEST 5: Verificando renderizado en ResolutionSummary.jsx / dist...');
const resolutionSummaryPath = path.join(rootDir, 'frontend/src/components/chat/ResolutionSummary.jsx');
if (fs.existsSync(resolutionSummaryPath)) {
  const resolutionSummaryCode = fs.readFileSync(resolutionSummaryPath, 'utf-8');
  assert.ok(
    resolutionSummaryCode.includes('list-disc') && resolutionSummaryCode.includes('list-outside'),
    'FALLO: ResolutionSummary no incluye estilos de viñetas visibles (list-disc)'
  );
  assert.ok(
    resolutionSummaryCode.includes('font-semibold') && resolutionSummaryCode.includes('text-zinc-100'),
    'FALLO: ResolutionSummary no estiliza elementos strong/negrita'
  );
  console.log('✅ TEST 5 PASADO: ResolutionSummary tiene componentes de Markdown con estilos list-disc y strong.');
} else {
  console.log('ℹ️ Archivo frontend/src no presente en este entorno, verificando bundle dist...');
  assert.ok(fs.existsSync(path.join(rootDir, 'frontend/dist')), 'FALLO: frontend/dist no existe');
  console.log('✅ TEST 5 PASADO: frontend/dist verificado.');
}

console.log('\n🎉 ¡TODOS LOS TESTS DE PARIDAD CONVERSACIONAL LOVABLE PASARON EXITOSAMENTE!');
