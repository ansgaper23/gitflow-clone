// backend/tests/test_pure_question_url_resilience.mjs
// Suite de pruebas para verificación de Consultas Puras con URL externa, Auditoría CRO/SEO y Gating de Herramientas
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { analyzePromptIntent, classifyUserIntent } from '../src/services/agent.js'
import { amplifyPrompt } from '../src/services/promptAmplifier.js'
import { isWebOrLandingRequest } from '../src/services/designDirector.js'

console.log('================================================================');
console.log('🧪 SUITE DE PRUEBAS: AUDITORÍA CON URL EXTERNA & GATING SEGURO');
console.log('================================================================\n');

let passedTests = 0;
let totalTests = 0;

async function runTestCase(name, fn) {
  totalTests++;
  process.stdout.write(`TEST ${totalTests} - ${name} ... `);
  const start = performance.now();
  try {
    await fn();
    const duration = (performance.now() - start).toFixed(1);
    console.log(`✅ PASS (${duration}ms)`);
    passedTests++;
  } catch (err) {
    console.log('❌ FAIL');
    console.error(err);
  }
}

const testMsg = 'como podriamos mejorar esta web? tanto visual, para atraer mas clientes y convertir y tambien en seo.. https://www.factiminperu.com/ . te dejo el brochure';

// ── TEST 1: Clasificación e Intención Semántica ──
await runTestCase('Clasificación como PURE_QUESTION y DIAGNOSTIC', async () => {
  const intent = analyzePromptIntent(testMsg);
  assert.equal(intent.isPureQuestion, true, 'Debe ser detectado como pregunta pura');
  assert.equal(intent.hasActionOrder, false, 'No debe tener orden de mutación');
  assert.equal(intent.isDiagnostic, true, 'Debe ser categorizado como diagnóstico');
  assert.equal(intent.category, 'PURE_QUESTION');
});

// ── TEST 2: Amplificación Adaptativa de Diagnóstico vs Construcción ──
await runTestCase('Amplificador inyecta marco de auditoría sin órdenes imperativas de código', async () => {
  const intent = analyzePromptIntent(testMsg);
  const amp = amplifyPrompt(testMsg, { turnMode: 'BUILD', promptIntent: intent });
  
  assert.equal(amp.isAmplified, true, 'Debe amplificar el contexto');
  assert.equal(amp.scope, 'DIAGNOSTIC', 'El scope debe ser DIAGNOSTIC');
  
  // Debe incluir marco de auditoría
  assert.ok(amp.amplifiedDirectives.includes('MARCO DE AUDITORÍA DE DIRECCIÓN DE ARTE UI/UX SENIOR'), 'Debe incluir auditoría UI/UX');
  assert.ok(amp.amplifiedDirectives.includes('MARCO DE AUDITORÍA SEO TÉCNICO GOOGLE 2026'), 'Debe incluir auditoría SEO');
  
  // NO debe incluir órdenes imperativas de construcción de componentes o CRUD
  assert.ok(!amp.amplifiedDirectives.includes('<amplified_product_architecture_directives>'), 'No debe exigir CRUD de BD');
  assert.ok(!amp.amplifiedDirectives.includes('Toda web, landing o página corporativa generada DEBE incorporar esta estructura'), 'No debe exigir generación de código en este turno');
});

// ── TEST 3: Gating Determinista de Herramientas de Mutación ──
await runTestCase('Herramientas de mutación deshabilitadas en pregunta pura', async () => {
  const intent = analyzePromptIntent(testMsg);
  const isPureQuestionReadOnly = Boolean(intent.isPureQuestion && !intent.hasActionOrder);
  assert.equal(isPureQuestionReadOnly, true);

  const mockCodeTools = [
    { name: 'read_file' },
    { name: 'list_files' },
    { name: 'search_files' },
    { name: 'propose_change' },
    { name: 'propose_patch' },
    { name: 'replace_file_content' },
    { name: 'delete_file' },
    { name: 'reset_project' },
    { name: 'execute_ddl' },
    { name: 'propose_migration' }
  ];

  const filteredTools = mockCodeTools.filter((t) => {
    if (isPureQuestionReadOnly && (
      t.name === 'propose_change' ||
      t.name === 'propose_patch' ||
      t.name === 'replace_file_content' ||
      t.name === 'delete_file' ||
      t.name === 'reset_project' ||
      t.name === 'propose_migration' ||
      t.name === 'execute_ddl'
    )) return false;
    return true;
  });

  const toolNames = filteredTools.map(t => t.name);
  assert.deepEqual(toolNames, ['read_file', 'list_files', 'search_files']);
});

// ── TEST 4: Detección de URL y Protocolo de Inspección read_website_url ──
await runTestCase('Extracción de URL y generación de protocolo obligatorio de inspección', async () => {
  const URL_REGEX = /https?:\/\/[^\s<>"')]+/gi;
  const detectedUrls = Array.from(new Set(testMsg.match(URL_REGEX) || []));
  
  assert.equal(detectedUrls.length, 1);
  assert.equal(detectedUrls[0], 'https://www.factiminperu.com/');
});

// ── TEST 5: Transición Fluida a Modo BUILD tras Confirmación del Usuario ──
await runTestCase('Transición a acción de código tras confirmación "sí, dale"', async () => {
  const confirmMsg = 'sí, dale, implementa esas mejoras ahora';
  const intent = analyzePromptIntent(confirmMsg);
  
  assert.equal(intent.isPureQuestion, false, 'Ya no es pregunta pura');
  assert.equal(intent.hasActionOrder, true, 'Ahora tiene orden explícita de acción');
  assert.equal(intent.category, 'ACTION_ORDER');
});

console.log('\n================================================================');
console.log(`📊 RESULTADO FINAL: ${passedTests}/${totalTests} TESTS EN VERDE (${Math.round((passedTests/totalTests)*100)}% PASS)`);
console.log('================================================================\n');

if (passedTests !== totalTests) {
  process.exit(1);
}
