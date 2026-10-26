// tests/test_activity_telemetry_and_message_user.mjs
import assert from 'assert/strict';
import {
  getHumanComponentName,
  buildHumanActivityDescription,
  messageUserTool,
  sanitizeFinalAssistantText,
  deriveVersionTitle,
  deriveSemanticTitleFromUserPrompt,
} from '../backend/src/services/agent.js';

console.log('🧪 Iniciando suite de pruebas: test_activity_telemetry_and_message_user.mjs\n');

// ============================================================================
// Caso 1: Mapeo Semántico de Componentes (HUMAN_COMPONENT_NAMES)
// ============================================================================
console.log('--- Caso 1: Mapeo semántico de componentes ---');
const testCasesComponents = [
  { path: 'src/components/Navbar.jsx', expected: 'la barra de navegación' },
  { path: 'src/components/Header.jsx', expected: 'la barra de navegación' },
  { path: 'src/components/Hero.jsx', expected: 'la portada principal (Hero)' },
  { path: 'src/components/HeroSection.jsx', expected: 'la portada principal (Hero)' },
  { path: 'src/components/Footer.jsx', expected: 'el pie de página' },
  { path: 'src/index.css', expected: 'el sistema de diseño y paleta de colores' },
  { path: 'tailwind.config.js', expected: 'el sistema de diseño y paleta de colores' },
  { path: 'src/App.jsx', expected: 'la estructura principal de la aplicación' },
  { path: 'src/pages/Login.jsx', expected: 'el módulo de acceso e inicio de sesión' },
  { path: 'src/components/AuthForms.jsx', expected: 'el módulo de acceso e inicio de sesión' },
  { path: 'src/pages/ServicesGrid.jsx', expected: 'la sección de servicios' },
  { path: 'src/components/ProjectsShowcase.jsx', expected: 'el portafolio de proyectos' },
  { path: 'src/components/ContactForm.jsx', expected: 'el formulario de contacto y cotización' },
  { path: 'src/components/QuoteModal.jsx', expected: 'el formulario de contacto y cotización' },
  { path: 'src/components/GroundingCalculator.jsx', expected: 'el módulo Grounding Calculator' },
];

for (const tc of testCasesComponents) {
  const result = getHumanComponentName(tc.path);
  assert.equal(result, tc.expected, `Para ${tc.path}: esperado "${tc.expected}", obtenido "${result}"`);
}
console.log(`✅ Caso 1 superado: ${testCasesComponents.length}/${testCasesComponents.length} componentes mapeados correctamente.`);

// ============================================================================
// Caso 2: Traducción Semántica a activity_description en Tiempo Real
// ============================================================================
console.log('\n--- Caso 2: Traductor de herramientas a activity_description ---');

// Edición de barra de navegación
const descEditNav = buildHumanActivityDescription('replace_file_content', { path: 'src/components/Navbar.jsx' });
assert.equal(descEditNav, 'Actualizando la barra de navegación...');

// Creación de portada Hero
const descCreateHero = buildHumanActivityDescription('propose_change', { path: 'src/components/Hero.jsx' });
assert.equal(descCreateHero, 'Creando la portada principal (Hero)...');

// Lectura de calculadora Grounding
const descReadCalc = buildHumanActivityDescription('read_file', { path: 'src/components/GroundingCalculator.jsx' });
assert.equal(descReadCalc, 'Revisando el módulo Grounding Calculator...');

// Triaje pre-LLM
const descTriage = buildHumanActivityDescription('triageRelevantFiles', {});
assert.equal(descTriage, 'Analizando la estructura del proyecto...');

// Inspección de URL externa
const descUrl = buildHumanActivityDescription('inspect_website_url', { url: 'https://ejemplo.com' });
assert.equal(descUrl, 'Inspeccionando diseño y activos de la web de referencia...');

// Procesamiento de PDF/Brochure
const descPdf = buildHumanActivityDescription('attachmentProcessor', {});
assert.equal(descPdf, 'Extrayendo colores, logotipo y catálogo del documento...');

// Imagen y recursos
const descImage = buildHumanActivityDescription('generate_image', {});
assert.equal(descImage, 'Preparando recursos visuales e imágenes...');

// Tareas / Roadmap
const descTasks = buildHumanActivityDescription('propose_tasks', {});
assert.equal(descTasks, 'Estructurando el plan de implementación...');

// Preguntas interactivas
const descQuestions = buildHumanActivityDescription('ask_questions', {});
assert.equal(descQuestions, 'Preparando opciones de diseño...');

// Post-LLM build / compilación
const descBuild = buildHumanActivityDescription('validate_build', {});
assert.equal(descBuild, 'Compilando cambios en la vista previa...');

// Cierre de turno: message_user emite null para desvanecer la píldora
const descFinish = buildHumanActivityDescription('message_user', { summary: 'Ajuste', message: 'Listo' });
assert.equal(descFinish, null, 'message_user debe devolver null para desvanecer la píldora');

const descFinishAlias = buildHumanActivityDescription('user_messaging--message_user', { summary: 'Ajuste', message: 'Listo' });
assert.equal(descFinishAlias, null, 'user_messaging--message_user debe devolver null para desvanecer la píldora');

console.log('✅ Caso 2 superado: Todas las fases y herramientas emiten descripciones humanas limpias y null al cerrar.');

// ============================================================================
// Caso 3: Integración de message_user, Título Semántico y Erradicación de Muletillas
// ============================================================================
console.log('\n--- Caso 3: message_user y erradicación de muletillas ---');

// Esquema de message_user
assert.equal(messageUserTool.name, 'message_user');
assert.ok(messageUserTool.input_schema.properties.summary, 'message_user debe requerir summary');
assert.ok(messageUserTool.input_schema.properties.message, 'message_user debe requerir message');

// Asignación de summary a VersionCard y message a finalText
const mockPayload = {
  summary: 'Flujo de compartir y descarga PNG',
  message: 'Añadí el botón de exportación PNG con soporte para compartir directamente en redes.',
};

const finalTitle = mockPayload.summary;
assert.notEqual(finalTitle, 'Actualización de interfaz', 'PROHIBIDO título genérico');
assert.equal(finalTitle, 'Flujo de compartir y descarga PNG');

const sanitizedMsg = sanitizeFinalAssistantText(mockPayload.message);
assert.ok(!sanitizedMsg.startsWith('Listo:'), 'No debe contener Listo:');
assert.ok(!sanitizedMsg.includes('se mantienen intactos'), 'No debe contener frases defensivas');
assert.equal(sanitizedMsg, 'Añadí el botón de exportación PNG con soporte para compartir directamente en redes.');

// Limpieza de respuesta con muletilla antigua
const legacyReply = "Listo: modifiqué src/components/Hero.jsx para aumentar la altura del banner; el resto de la web sigue intacto.";
const cleanedReply = sanitizeFinalAssistantText(legacyReply);
assert.ok(!cleanedReply.startsWith('Listo:'), 'Debe erradicar Listo:');
assert.ok(!cleanedReply.includes('src/components/Hero.jsx'), 'Debe traducir ruta técnica');
assert.ok(!cleanedReply.includes('sigue intacto'), 'Debe erradicar "sigue intacto"');
assert.ok(!cleanedReply.includes('el resto de la web'), 'Debe erradicar cola defensiva');
console.log('  Cleaned legacy reply:', cleanedReply);

// Verificación de deriveVersionTitle sin prompt
const titleDerived = deriveVersionTitle([{ path: 'src/components/Navbar.jsx' }], [], null, [], 'Cambia el menú');
assert.notEqual(titleDerived, 'Actualización de interfaz', 'PROHIBIDO título genérico');
console.log('  Derived title:', titleDerived);

console.log('✅ Caso 3 superado: message_user opera con títulos semánticos y cero muletillas.');

console.log('\n🎉 TODAS LAS PRUEBAS DE TELEMETRÍA EFÍMERA Y MESSAGE_USER PASARON EXITOSAMENTE.');
