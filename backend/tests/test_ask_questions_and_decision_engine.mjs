import assert from 'node:assert/strict';
import { shouldAllowClarificationQuestion } from '../src/services/agent.js';

console.log('🧪 Iniciando pruebas de ask_questions y Decision Engine estilo Lovable...\n');

// 1. Veto por adjuntos (PDFs, imágenes, etc.)
{
  const allowed = shouldAllowClarificationQuestion('hazme un sistema para clínica dental', {
    attachments: [{ filename: 'brochure-sergesol.pdf', kind: 'pdf' }],
    history: []
  });
  assert.equal(allowed, false, 'DEBE vetar preguntas cuando hay archivos adjuntos');
  console.log('✅ 1. Veto con adjuntos (PDF/Logo): OK (Decisión 100% Autónoma)');
}

// 2. Veto por presencia de URL externa
{
  const allowed = shouldAllowClarificationQuestion('Creame una web igual a esta https://electrinovaperu.com/', {
    attachments: [],
    history: []
  });
  assert.equal(allowed, false, 'DEBE vetar preguntas cuando hay una URL externa');
  console.log('✅ 2. Veto con URL externa: OK (Decisión 100% Autónoma)');
}

// 3. Veto por historial > 0 (Turnos subsiguientes de corrección o mejora)
{
  const allowed = shouldAllowClarificationQuestion('el color de fondo es otro no el que pusiste', {
    attachments: [],
    history: [{ role: 'user', content: 'hazme una web' }, { role: 'assistant', content: 'hecho' }]
  });
  assert.equal(allowed, false, 'DEBE vetar preguntas en turnos posteriores (history > 0)');
  console.log('✅ 3. Veto en turnos subsiguientes (history > 0): OK (Decisión 100% Autónoma)');
}

// 4. Veto por SQL / DDL explícito
{
  const allowed = shouldAllowClarificationQuestion('CREATE TABLE appointments (id uuid PRIMARY KEY);', {
    attachments: [],
    history: []
  });
  assert.equal(allowed, false, 'DEBE vetar preguntas cuando hay sentencias SQL');
  console.log('✅ 4. Veto con sentencias SQL: OK');
}

// 5. Veto por mención de archivos de código
{
  const allowed = shouldAllowClarificationQuestion('modifica el diseño en src/App.jsx', {
    attachments: [],
    history: []
  });
  assert.equal(allowed, false, 'DEBE vetar preguntas si se especifican archivos como src/App.jsx');
  console.log('✅ 5. Veto con archivo de código explícito: OK');
}

// 6. PERMITIDO en Turno 1 (Kickoff de nuevo proyecto sin adjuntos ni URL)
{
  const allowed = shouldAllowClarificationQuestion('hazme un sistema para clínica dental', {
    attachments: [],
    history: [],
    isInitialKickoff: true
  });
  assert.equal(allowed, true, 'DEBE permitir preguntas en Kickoff Turno 1 sin adjuntos ni URL');
  console.log('✅ 6. Permitido en Turno 1 Kickoff genérico: OK (ask_questions habilitado)');
}

// 7. PERMITIDO en Turno 1 con solicitud de SaaS / App de reservas
{
  const allowed = shouldAllowClarificationQuestion('crea una app para delivery de comida', {
    attachments: [],
    history: [],
    isInitialKickoff: true
  });
  assert.equal(allowed, true, 'DEBE permitir preguntas en Kickoff para apps de delivery');
  console.log('✅ 7. Permitido en Turno 1 para App de Delivery: OK');
}

console.log('\n🎉 ¡TODAS LAS PRUEBAS DEL MOTOR DE DECISIÓN Y ASK_QUESTIONS PASARON EXITOSAMENTE!');
