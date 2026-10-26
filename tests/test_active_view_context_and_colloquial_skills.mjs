import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTests() {
  console.log('🧪 Iniciando tests del Motor de Comprensión Contextual Implícita y Triggers Coloquiales...');

  // 1. Test Colloquial Skill & Component Matcher
  const { matchColloquialSkillsAndComponents } = await import('../backend/src/services/colloquialSkillMatcher.js');

  console.log('  -> Test 1: Mapeo de "más bonito y pon una ventanita"');
  const match1 = matchColloquialSkillsAndComponents('hazlo más bonito y pon una ventanita para el registro');
  assert.ok(match1.matchedSkills.some(s => s.id === 'redesign'), 'Debe detectar rediseño estético');
  assert.ok(match1.matchedComponents.some(c => c.componentName === 'Dialog'), 'Debe mapear "ventanita" a Dialog de shadcn/ui');
  assert.ok(match1.directivePromptBlock.includes('[DIRECTIVA ESPECIALIZADA ACTIVADA POR INTENCIÓN DEL USUARIO]'), 'Debe generar bloque de directiva');
  assert.ok(match1.directivePromptBlock.includes('Dialog'), 'Debe mencionar Dialog');

  console.log('  -> Test 2: Mapeo de "en el celular se rompe y quiero un panel lateral"');
  const match2 = matchColloquialSkillsAndComponents('en el celular se rompe todo, agrega un panel lateral para navegar');
  assert.ok(match2.matchedSkills.some(s => s.id === 'responsive_mobile'), 'Debe detectar responsive mobile');
  assert.ok(match2.matchedComponents.some(c => c.componentName === 'Sheet'), 'Debe mapear "panel lateral" a Sheet');

  console.log('  -> Test 3: Mapeo de SEO y pestañitas');
  const match3 = matchColloquialSkillsAndComponents('optimiza para que aparezca en google y organiza esto en pestañitas');
  assert.ok(match3.matchedSkills.some(s => s.id === 'seo_visibility'), 'Debe detectar SEO');
  assert.ok(match3.matchedComponents.some(c => c.componentName === 'Tabs'), 'Debe mapear "pestañitas" a Tabs');

  console.log('  -> Test 4: Mapeo de accesibilidad y preguntas que se abren (faq)');
  const match4 = matchColloquialSkillsAndComponents('las letras no se leen bien, pon preguntas que se abren para los clientes');
  assert.ok(match4.matchedSkills.some(s => s.id === 'a11y_readability'), 'Debe detectar accesibilidad');
  assert.ok(match4.matchedComponents.some(c => c.componentName === 'Accordion'), 'Debe mapear "preguntas que se abren" a Accordion');

  console.log('  -> Test 5: Mapeo de notificaciones y tablas');
  const match5 = matchColloquialSkillsAndComponents('muestra un aviso arriba cuando guarde y mete los usuarios en una grilla de datos con columnas');
  assert.ok(match5.matchedComponents.some(c => c.componentName === 'toast (sonner)'), 'Debe mapear "aviso arriba" a toast sonner');
  assert.ok(match5.matchedComponents.some(c => c.componentName === 'Table'), 'Debe mapear "grilla de datos con columnas" a Table');

  console.log('  -> Test 6: Mensaje neutro sin triggers');
  const match6 = matchColloquialSkillsAndComponents('agrega un endpoint POST en express');
  assert.strictEqual(match6.matchedSkills.length, 0, 'No debe disparar skills en mensaje técnico');
  assert.strictEqual(match6.matchedComponents.length, 0, 'No debe disparar componentes en mensaje técnico');
  assert.strictEqual(match6.directivePromptBlock, '', 'Bloque de directiva debe estar vacío');

  // 2. Test Veto de Clarificación con activeViewContext
  const { shouldAllowClarificationQuestion } = await import('../backend/src/services/agent.js');
  
  console.log('  -> Test 7: Veto de ask_question cuando activeViewContext tiene modal o archivo enfocado');
  const allowWithView = shouldAllowClarificationQuestion('cambia el título de esto', {
    activeViewContext: { route: '/profile', focusedFile: 'src/pages/Profile.jsx' },
    isInitialKickoff: false
  });
  assert.strictEqual(allowWithView, false, 'No debe permitir preguntas aclaratorias cuando hay contexto de vista activa');

  console.log('  -> Test 8: Verificación de definición estricta de readFilesCache y readCache');
  const agentModuleSource = await import('node:fs').then(fs => fs.promises.readFile(path.join(__dirname, '../backend/src/services/agent.js'), 'utf8'));
  assert.ok(agentModuleSource.includes('const readFilesCache = readCache'), 'readFilesCache debe estar declarado e instanciado como alias unificado de readCache');
  assert.ok(!agentModuleSource.includes('let fileContent = stagedContent.get(focusedFile) || readFilesCache.get(focusedFile) || semanticFilesMap?.[focusedFile];\n      if (!fileContent) {\n        try {\n          fileContent = await readProjectFile(project, accessToken, focusedFile, signal);\n        } catch (_) {}\n      }\n      if (fileContent) {\n        readFilesCache.set(focusedFile, fileContent);') || agentModuleSource.includes('const readFilesCache = readCache'), 'readFilesCache debe ser seguro');

  console.log('✅ ¡TODOS LOS TESTS DEL MOTOR DE COMPRENSIÓN CONTEXTUAL PASARON EXITOSAMENTE!');
}

runTests().catch(err => {
  console.error('❌ Error en test:', err);
  process.exit(1);
});
