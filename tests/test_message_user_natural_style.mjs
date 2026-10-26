// tests/test_message_user_natural_style.mjs
import assert from 'assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  messageUserTool,
  sanitizeFinalAssistantText,
  deriveSemanticTitleFromUserPrompt,
  deriveVersionTitle,
} from '../backend/src/services/agent.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🧪 Iniciando suite de pruebas: test_message_user_natural_style.mjs\n');

// ============================================================================
// Caso 1: Verificación de registro de la herramienta message_user
// ============================================================================
console.log('--- Caso 1: Registro y esquema de la herramienta message_user ---');
assert.ok(messageUserTool, 'La herramienta messageUserTool debe existir y estar exportada');
assert.equal(messageUserTool.name, 'message_user', 'El nombre de la herramienta debe ser message_user');
assert.ok(
  messageUserTool.description.includes('tarjeta de versión') ||
  messageUserTool.description.includes('VersionCard') ||
  schema.properties.summary.description.includes('VersionCard'),
  'La descripción o el esquema debe mencionar la VersionCard o tarjeta de versión'
);

const schema = messageUserTool.input_schema;
assert.equal(schema.type, 'object');
assert.ok(schema.properties.summary, 'Debe incluir la propiedad summary');
assert.ok(schema.properties.message, 'Debe incluir la propiedad message');
assert.deepEqual(schema.required, ['summary', 'message'], 'summary y message deben ser requeridos');
console.log('✅ Caso 1 superado: Herramienta message_user registrada con esquema riguroso.');

// ============================================================================
// Caso 2: Auditoría del código de agent.js contra la muletilla robótica
// ============================================================================
console.log('\n--- Caso 2: Auditoría de agent.js contra "Listo: ... se mantienen intactos" ---');
const agentCode = fs.readFileSync(path.join(__dirname, '../backend/src/services/agent.js'), 'utf8');

// Comprobar que en el prompt no se obligue a "Listo:" ni a frases de módulos intactos
assert.ok(
  !agentCode.includes('Abre directamente con confirmación natural ("Listo:"'),
  'El System Prompt no debe exigir la apertura "Listo:"'
);
assert.ok(
  !agentCode.includes('cierra con una breve cláusula de tranquilidad confirmando que el resto de la aplicación se mantuvo intacto'),
  'El System Prompt no debe exigir cláusulas de tranquilidad sobre módulos intactos'
);
assert.ok(
  agentCode.includes('PROHIBIDO empezar todos los mensajes con la muletilla "Listo:" o "Hecho:"'),
  'El System Prompt debe prohibir explícitamente "Listo:" y "Hecho:"'
);
assert.ok(
  agentCode.includes('PROHIBIDO agregar al final frases defensivas o de relleno como "; el resto de módulos se mantienen intactos"'),
  'El System Prompt debe prohibir explícitamente frases de módulos intactos'
);
console.log('✅ Caso 2 superado: Ninguna directiva de agent.js genera ni exige la muletilla robótica.');

// ============================================================================
// Caso 3: Sanitización y limpieza de respuestas con muletilla heredada
// ============================================================================
console.log('\n--- Caso 3: Limpiador de muletillas heredadas del historial ---');

// Ejemplo 1: Caso real reportado por el usuario
const legacyInput1 = "Listo: el banner de portada volvió a mostrar la foto del ingeniero en la subestación al atardecer con el título 'Energía confiable para operaciones críticas' y los botones de cotización y WhatsApp; el resto de la web (proyectos, catálogo y formulario) sigue intacto.";
const cleaned1 = sanitizeFinalAssistantText(legacyInput1);

assert.ok(!cleaned1.startsWith('Listo:'), 'El mensaje no debe empezar con "Listo:"');
assert.ok(!cleaned1.includes('sigue intacto'), 'El mensaje no debe contener "sigue intacto"');
assert.ok(!cleaned1.includes('el resto de la web'), 'No debe incluir la coletilla defensiva');
assert.ok(cleaned1.includes('Energía confiable'), 'Debe conservar la información de valor');
assert.ok(cleaned1.endsWith('.'), 'Debe terminar en punto final limpio');
console.log('  Input 1:', legacyInput1);
console.log('  Cleaned 1:', cleaned1);

// Ejemplo 2: Mención de ruta técnica src/ y cola defensiva
const legacyInput2 = "Hecho: ajusté el diseño en src/pages/Login.jsx para añadir sombra; los demás módulos se mantienen intactos.";
const cleaned2 = sanitizeFinalAssistantText(legacyInput2);

assert.ok(!cleaned2.startsWith('Hecho:'), 'El mensaje no debe empezar con "Hecho:"');
assert.ok(!cleaned2.includes('src/pages/Login.jsx'), 'No debe exponer rutas internas src/...');
assert.ok(cleaned2.includes('el componente **Login**'), 'Debe traducir la ruta a un componente amigable');
assert.ok(!cleaned2.includes('los demás módulos se mantienen intactos'), 'Debe eliminar la cola defensiva');
console.log('  Input 2:', legacyInput2);
console.log('  Cleaned 2:', cleaned2);

// Ejemplo 3: Bloques de pensamiento y texto normal
const legacyInput3 = "<thought>Pensando en la solución...</thought>Listo: aumenté el tamaño del botón **Ingresar a Modamia**; todo sigue funcionando con normalidad.";
const cleaned3 = sanitizeFinalAssistantText(legacyInput3);

assert.ok(!cleaned3.includes('<thought>'), 'Debe eliminar bloques de pensamiento');
assert.ok(!cleaned3.startsWith('Listo:'), 'Debe eliminar el prefijo Listo:');
assert.ok(!cleaned3.includes('todo sigue funcionando con normalidad'), 'Debe eliminar la cola de normalidad');
assert.equal(cleaned3, 'Aumenté el tamaño del botón **Ingresar a Modamia**.');
console.log('  Input 3:', legacyInput3);
console.log('  Cleaned 3:', cleaned3);

console.log('✅ Caso 3 superado: Las respuestas con muletilla se transforman en mensajes concisos y naturales.');

// ============================================================================
// Caso 4: Derivación semántica de títulos para VersionCard
// ============================================================================
console.log('\n--- Caso 4: Derivación semántica de títulos para VersionCard ---');

// Título derivado de la intención del prompt del usuario
const userPrompt1 = 'Por favor agrega un flujo de compartir y descarga PNG';
const semanticTitle1 = deriveSemanticTitleFromUserPrompt(userPrompt1);
assert.ok(semanticTitle1.includes('compartir') || semanticTitle1.includes('PNG'), `Título semántico esperado: ${semanticTitle1}`);
assert.notEqual(semanticTitle1, 'Actualización de interfaz', 'PROHIBIDO título genérico');
console.log('  Prompt 1:', userPrompt1, '->', semanticTitle1);

const userPrompt2 = 'Aumenta el tamaño del botón de login';
const semanticTitle2 = deriveVersionTitle([{ path: 'src/pages/Login.jsx' }], [], null, [], userPrompt2);
assert.notEqual(semanticTitle2, 'Actualización de interfaz', 'PROHIBIDO título genérico');
console.log('  Prompt 2:', userPrompt2, '->', semanticTitle2);

// Fallback sin prompt: debe derivar del componente o cambio, nunca el genérico "Actualización de interfaz"
const fallbackTitle = deriveVersionTitle([{ path: 'src/components/Header.jsx' }], [], null, []);
assert.equal(fallbackTitle, 'Módulo Header');
assert.notEqual(fallbackTitle, 'Actualización de interfaz');
console.log('  Fallback componente:', fallbackTitle);

console.log('✅ Caso 4 superado: Títulos semánticos generados correctamente y sin títulos genéricos.');

console.log('\n🎉 TODAS LAS PRUEBAS DE ESTILO NATURAL Y message_user PASARON EXITOSAMENTE.');
