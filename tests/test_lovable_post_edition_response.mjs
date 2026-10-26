// tests/test_lovable_post_edition_response.mjs
import assert from 'assert/strict';
import { buildLovableStructuredResponse, deriveVersionTitle } from '../backend/src/services/agent.js';

console.log('🧪 Iniciando verificación de respuesta post-edición estilo Lovable...\n');

// 1. Verificación: deriveVersionTitle
console.log('Test 1: deriveVersionTitle con cambios de código...');
const titleCode = deriveVersionTitle([{ path: 'src/components/Hero.jsx' }]);
assert.equal(titleCode, 'Módulo Hero', `Esperado "Módulo Hero", obtenido: ${titleCode}`);
console.log('✅ Título de código correcto:', titleCode);

console.log('Test 2: deriveVersionTitle con migración SQL limpia...');
const titleDbClean = deriveVersionTitle([], [{ summary: 'Registro de clientes y ventas' }]);
assert.equal(titleDbClean, 'Registro de clientes y ventas');
console.log('✅ Título de BD limpio correcto:', titleDbClean);

console.log('Test 3: deriveVersionTitle con nombre SQL crudo (sanitize)...');
const titleDbRaw = deriveVersionTitle([], [{ summary: 'create_motor_fault_logs' }]);
assert.equal(titleDbRaw, 'Motor fault logs');
console.log('✅ Nombre crudo SQL sanitizado a:', titleDbRaw);

// 2. Verificación: buildLovableStructuredResponse (Fallback limpio sin nombres de archivo)
console.log('Test 4: buildLovableStructuredResponse cuando cleanText viene vacío...');
const fallback = buildLovableStructuredResponse([
  'Actualizado src/components/Hero.jsx',
  'create table motor_logs en schema.sql'
]);
assert.ok(!fallback.includes('src/components/Hero.jsx'), 'No debe contener nombres de archivos');
assert.ok(!fallback.includes('schema.sql'), 'No debe contener nombres de archivos SQL');
assert.ok(!fallback.includes('**Cambios aplicados:**'), 'No debe contener Cambios aplicados');
assert.ok(!fallback.startsWith('Listo:'), 'PROHIBIDO abrir con Listo:');
console.log('✅ Fallback estructurado limpio:', fallback);

// 3. Verificación: Extracción y limpieza de <suggestions> y <!--suggestions:-->
console.log('Test 5: Extracción de <suggestions> y limpieza de texto...');
const rawLLMResponse1 = `Listo: el banner principal ahora muestra el título "Energía Confiable" con fondo azul oscuro y el botón de WhatsApp destacado; el resto de la web sigue intacto.

<suggestions>["Configurar el SEO técnico", "Conectar a WhatsApp", "Añadir filtro"]</suggestions>`;

const SUGGESTIONS_RE = /(?:<suggestions>\s*(\[[\s\S]*?\])\s*<\/suggestions>|<!--\s*suggestions\s*:\s*(\[[\s\S]*?\])\s*-->)/i;
const match1 = rawLLMResponse1.match(SUGGESTIONS_RE);
assert.ok(match1, 'Debe matchear la etiqueta <suggestions>');
const suggestionsArray1 = JSON.parse(match1[1] || match1[2]);
assert.equal(suggestionsArray1.length, 3);
assert.equal(suggestionsArray1[0], 'Configurar el SEO técnico');
assert.equal(suggestionsArray1[1], 'Conectar a WhatsApp');
assert.equal(suggestionsArray1[2], 'Añadir filtro');

const cleaned1 = rawLLMResponse1
  .replace(/<suggestions>[\s\S]*?<\/suggestions>/gi, '')
  .replace(/<!--\s*suggestions\s*:[\s\S]*?-->/gi, '')
  .trim();

assert.ok(!cleaned1.includes('<suggestions>'), 'El texto limpio no debe contener etiquetas');
assert.ok(!cleaned1.includes('Configurar el SEO técnico'), 'Las sugerencias no deben quedar en el texto visible');
assert.ok(cleaned1.includes('Energía Confiable'), 'El texto visible debe conservar el mensaje humano');
console.log('✅ Sugerencias extraídas como array:', suggestionsArray1);
console.log('✅ Texto final limpio:', cleaned1);

// 4. Verificación: Formato alternativo <!--suggestions:[...]-->
console.log('Test 6: Extracción con comentario HTML <!--suggestions:[...]-->...');
const rawLLMResponse2 = `Hecho: actualicé los colores a azul marino y el botón de cotización responde al clic.
<!--suggestions:["Probar en móvil", "Exportar a PDF"]-->`;
const match2 = rawLLMResponse2.match(SUGGESTIONS_RE);
assert.ok(match2, 'Debe matchear comentario HTML');
const suggestionsArray2 = JSON.parse(match2[1] || match2[2]);
assert.equal(suggestionsArray2.length, 2);
assert.equal(suggestionsArray2[0], 'Probar en móvil');
console.log('✅ Sugerencias HTML extraídas:', suggestionsArray2);

console.log('\n🎉 ¡TODOS LOS TESTS DE RESPUESTA POST-EDICIÓN PASARON EXITOSAMENTE!');
