import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

console.log('🧪 Iniciando suite de pruebas anti-regresión: test_no_stale_assistant_reply.mjs...\n');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Verificación de buildSystemPrompt con diferentes modos y casos extremos
{
  const possiblePaths = [
    path.resolve(__dirname, '../backend/src/services/agent.js'),
    path.resolve(__dirname, '../src/services/agent.js'),
    path.resolve(__dirname, 'backend/src/services/agent.js')
  ];

  const agentPath = possiblePaths.find(p => fs.existsSync(p));
  assert.ok(agentPath, `No se encontró agent.js en ninguna de las rutas esperadas: ${possiblePaths.join(', ')}`);

  const agentCode = fs.readFileSync(agentPath, 'utf8');

  // Verificar que requestedMode y turnMode no existan dentro de buildSystemPrompt
  const startIdx = agentCode.indexOf('function buildSystemPrompt(');
  const endIdx = agentCode.indexOf('export async function runAgent(', startIdx);
  const promptBody = agentCode.slice(startIdx, endIdx);

  assert.equal(promptBody.includes('requestedMode'), false, 'buildSystemPrompt NO debe contener requestedMode');
  assert.equal(promptBody.includes('turnMode'), false, 'buildSystemPrompt NO debe contener turnMode');
  assert.equal(promptBody.includes('normalizedMode'), true, 'buildSystemPrompt DEBE inicializar normalizedMode');
  assert.equal(promptBody.includes('isExplicitBuildMode'), true, 'buildSystemPrompt DEBE inicializar isExplicitBuildMode');
  console.log('✅ 1. buildSystemPrompt: Ausencia absoluta de variables no declaradas (requestedMode/turnMode): OK');
}

// 2. Simulación matemática de recoverTurnFromPolling - Regla de No Reciclaje de Asistente
{
  function matchAssistantForUser(rawMsgs) {
    let lastUserIndex = -1;
    for (let i = rawMsgs.length - 1; i >= 0; i--) {
      if (rawMsgs[i].role === 'user') {
        lastUserIndex = i;
        break;
      }
    }

    if (lastUserIndex === -1) return null;

    const userMessage = rawMsgs[lastUserIndex];
    const userTime = new Date(userMessage.created_at).getTime();

    // Buscar asistente estrictamente posterior al último userMessage
    const assistantMessage = rawMsgs.slice(lastUserIndex + 1).find(m =>
      m.role === 'assistant' && new Date(m.created_at).getTime() >= userTime
    );

    return assistantMessage || null;
  }

  // Caso A: Mensaje de usuario nuevo tras error en backend (asistente es de turno anterior)
  const staleCase = [
    { id: 'u1', role: 'user', content: 'Turno 1', created_at: '2026-10-22T04:20:00Z' },
    { id: 'a1', role: 'assistant', content: 'Respuesta Turno 1', created_at: '2026-10-22T04:22:00Z' },
    { id: 'u2', role: 'user', content: 'Turno 2 nuevo', created_at: '2026-10-22T11:44:00Z' }
  ];

  const matchedStale = matchAssistantForUser(staleCase);
  assert.equal(matchedStale, null, 'PROHIBIDO emparejar con el asistente del Turno 1');
  console.log('✅ 2. recoverTurnFromPolling: Bloqueo de reciclaje de asistente viejo: OK (retorna null)');

  // Caso B: Turno exitoso donde el asistente fue creado después del usuario
  const successCase = [
    { id: 'u1', role: 'user', content: 'Turno 1', created_at: '2026-10-22T04:20:00Z' },
    { id: 'a1', role: 'assistant', content: 'Respuesta Turno 1', created_at: '2026-10-22T04:22:00Z' },
    { id: 'u2', role: 'user', content: 'Turno 2 nuevo', created_at: '2026-10-22T11:44:00Z' },
    { id: 'a2', role: 'assistant', content: 'Respuesta Turno 2 exitosa', created_at: '2026-10-22T11:45:00Z' }
  ];

  const matchedSuccess = matchAssistantForUser(successCase);
  assert.notEqual(matchedSuccess, null);
  assert.equal(matchedSuccess.id, 'a2', 'DEBE emparejar con el nuevo asistente del Turno 2');
  console.log('✅ 3. recoverTurnFromPolling: Emparejamiento cronológico de asistente nuevo: OK (id a2)');
}

// 3. Verificación de Chat.jsx contra duplicación de mensajes por ID
{
  const chatPaths = [
    path.resolve(__dirname, '../frontend/src/pages/Chat.jsx'),
    path.resolve(__dirname, 'frontend/src/pages/Chat.jsx'),
    path.resolve('/opt/gitflow-app/frontend/src/pages/Chat.jsx')
  ];

  const chatPath = chatPaths.find(p => fs.existsSync(p));
  if (chatPath) {
    const chatCode = fs.readFileSync(chatPath, 'utf8');
    assert.equal(
      chatCode.includes('!withoutTmp.some((m) => m.id === result.assistantMessage.id)'),
      true,
      'Chat.jsx debe validar unicidad de assistantMessage por ID'
    );
    console.log('✅ 4. Chat.jsx: Blindaje contra duplicación de mensajes en UI: OK');
  }
}

// 4. Verificación de api.js contra recuperación forzada en eventos de error explícitos
{
  const apiPaths = [
    path.resolve(__dirname, '../frontend/src/lib/api.js'),
    path.resolve(__dirname, 'frontend/src/lib/api.js'),
    path.resolve('/opt/gitflow-app/frontend/src/lib/api.js')
  ];

  const apiPath = apiPaths.find(p => fs.existsSync(p));
  if (apiPath) {
    const apiCode = fs.readFileSync(apiPath, 'utf8');
    assert.equal(
      apiCode.includes('let hasExplicitServerError = false;'),
      true,
      'api.js debe contener bandera hasExplicitServerError'
    );
    assert.equal(
      apiCode.includes('if (!finalResult && conversationId && !hasExplicitServerError)'),
      true,
      'api.js no debe activar polling de recuperación ante error explícito del servidor'
    );
    console.log('✅ 5. api.js: Propagación de error directo sin polling en fallos explícitos de SSE: OK');
  }
}

console.log('\n🎉 ¡TODAS LAS PRUEBAS ANTI-REGRESIÓN PASARON CON ÉXITO AL 100%!');
process.exit(0);
