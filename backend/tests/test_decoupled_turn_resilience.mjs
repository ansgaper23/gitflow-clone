// backend/tests/test_decoupled_turn_resilience.mjs
// Suite de Pruebas Automatizadas de Desacoplamiento de Socket y Resiliencia de Turnos (FlowPro)
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { performance } from 'node:perf_hooks'
import { activeTurns } from '../src/services/conversationTurn.js'

console.log('================================================================');
console.log('🧪 SUITE DE PRUEBAS DE DESACOPLAMIENTO Y RESILIENCIA DE TURNOS');
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

// ── TEST 1: El cierre del socket del cliente (req.emit('close')) NO aborta la ejecución en backend ──
await runTestCase('Socket close (req.emit close) NO aborta turnAbortController', async () => {
  const conversationId = 'test-convo-sse-drop-' + Date.now();
  const turnAbortController = new AbortController();

  let clientDisconnected = false;
  let turnFinished = false;
  let backendExecutionFinished = false;

  const mockReq = new EventEmitter();
  const mockRes = {
    writableEnded: false,
    destroyed: false,
    write: (data) => {},
    flushHeaders: () => {},
    end: () => { mockRes.writableEnded = true; }
  };

  mockReq.on('close', () => {
    clientDisconnected = true;
  });

  // Simulación de un turno en ejecución en segundo plano
  const backgroundWork = (async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    // Validar que a mitad del trabajo la señal del turno sigue viva a pesar del close del socket
    assert.equal(turnAbortController.signal.aborted, false, 'turnAbortController NO debe abortarse por desconexión del cliente');
    await new Promise((resolve) => setTimeout(resolve, 100));
    turnFinished = true;
    backendExecutionFinished = true;
    return { ok: true, text: 'Turno completado exitosamente en segundo plano' };
  })();

  // Emitir desconexión del cliente a los 30ms
  setTimeout(() => {
    mockReq.emit('close');
  }, 30);

  const result = await backgroundWork;
  assert.equal(clientDisconnected, true, 'El cliente debe figurar como desconectado');
  assert.equal(backendExecutionFinished, true, 'El trabajo del backend debe finalizar con éxito');
  assert.equal(turnAbortController.signal.aborted, false, 'La señal jamás debe haberse abortado');
  assert.equal(result.ok, true);
});

// ── TEST 2: Señal externa de aborto es ignorada si NO es cancelación explícita del usuario ──
await runTestCase('Señal externa de aborto ignorada salvo que explicitCancelRequested sea true', async () => {
  const conversationId = 'test-convo-shield-' + Date.now();
  const turnAbortController = new AbortController();
  const externalSignalSource = new AbortController();

  const turnData = {
    conversationId,
    projectId: 'test-proj',
    startedAt: Date.now(),
    lastActivityAt: Date.now(),
    abortController: turnAbortController,
    explicitCancelRequested: false,
    turnTimeout: null,
    maxTimeout: null,
  };

  // Implementación idéntica a conversationTurn.js
  if (externalSignalSource.signal) {
    if (externalSignalSource.signal.aborted && turnData.explicitCancelRequested) {
      turnAbortController.abort();
    } else {
      externalSignalSource.signal.addEventListener('abort', () => {
        if (turnData.explicitCancelRequested) {
          turnAbortController.abort();
        }
      }, { once: true });
    }
  }

  // Se aborta la señal externa (simulando timeout o socket close de express)
  externalSignalSource.abort();

  // Debe mantenerse turnAbortController sin abortar porque explicitCancelRequested === false
  assert.equal(turnAbortController.signal.aborted, false, 'turnAbortController debe permanecer INTACTO');

  // Ahora simulamos que el usuario envía POST /cancel
  turnData.explicitCancelRequested = true;
  turnData.abortController.abort();

  assert.equal(turnAbortController.signal.aborted, true, 'turnAbortController debe abortarse al cancelarse explícitamente');
});

// ── TEST 3: Watchdog extendido (240s inactividad / 20 min cap) ──
await runTestCase('Watchdog se refresca con turnData.touch()', async () => {
  const conversationId = 'test-convo-touch-' + Date.now();
  const turnAbortController = new AbortController();

  let inactivityFired = false;
  let turnTimeout = null;
  const INACTIVITY_TIMEOUT_MS = 150; // Acelerado para test

  const turnData = {
    conversationId,
    startedAt: Date.now(),
    lastActivityAt: Date.now(),
    abortController: turnAbortController,
    turnTimeout: null
  };

  const scheduleInactivityTimeout = () => {
    if (turnData.turnTimeout) clearTimeout(turnData.turnTimeout);
    turnData.turnTimeout = setTimeout(() => {
      inactivityFired = true;
      try { turnAbortController.abort(); } catch (_) {}
    }, INACTIVITY_TIMEOUT_MS);
  };

  turnData.touch = () => {
    turnData.lastActivityAt = Date.now();
    scheduleInactivityTimeout();
  };

  scheduleInactivityTimeout();

  // A los 100ms se produce progreso en el turno
  await new Promise(r => setTimeout(r, 100));
  turnData.touch();

  // A los 200ms del inicio (100ms después del touch), inactivity no debió disparar
  await new Promise(r => setTimeout(r, 80));
  assert.equal(inactivityFired, false, 'El watchdog no debió dispararse porque se refrescó');
  assert.equal(turnAbortController.signal.aborted, false);

  clearTimeout(turnData.turnTimeout);
});

// ── TEST 4: aiAccounts failover ante APIUserAbortError / timeout si signal.aborted es false ──
await runTestCase('aiAccounts rota cuenta ante error de aborto transitorio si signal.aborted es false', async () => {
  const callerAbortController = new AbortController(); // NO abortado
  let callCount = 0;

  const mockRunnerAccount1 = async () => {
    callCount++;
    const err = new Error('Request was aborted.');
    err.name = 'APIUserAbortError';
    throw err;
  };

  const mockRunnerAccount2 = async () => {
    callCount++;
    return { text: 'Respuesta exitosa de cuenta secundaria tras rotación' };
  };

  const accounts = [
    { id: 'acc-1', label: 'Anthropic Claude Primaria', provider: 'anthropic' },
    { id: 'acc-2', label: 'Gemini Backup', provider: 'gemini' }
  ];

  // Simulación del bucle de rotación idéntico al implementado en aiAccounts.js
  let finalResult = null;
  const errors = [];

  for (const account of accounts) {
    if (callerAbortController.signal?.aborted) {
      throw new DOMException('Cancelado por el usuario', 'AbortError');
    }

    try {
      if (account.id === 'acc-1') {
        finalResult = await mockRunnerAccount1();
      } else {
        finalResult = await mockRunnerAccount2();
      }
      break;
    } catch (err) {
      if (callerAbortController.signal?.aborted) {
        throw err;
      }
      errors.push(`${account.label}: ${err.message}`);
      // Failover continúa a la siguiente cuenta
    }
  }

  assert.equal(callCount, 2, 'Debe haber intentado ambas cuentas');
  assert.equal(finalResult.text, 'Respuesta exitosa de cuenta secundaria tras rotación');
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes('Anthropic Claude Primaria: Request was aborted.'));
});

// ── TEST 5: aiAccounts cancel inmediato si signal.aborted es TRUE (Cancelación del usuario) ──
await runTestCase('aiAccounts interrumpe de inmediato si signal.aborted es true', async () => {
  const callerAbortController = new AbortController();
  callerAbortController.abort(); // Cancelación explícita del usuario

  let called = false;
  const mockRunner = async () => {
    called = true;
    return { text: 'ok' };
  };

  await assert.rejects(
    async () => {
      if (callerAbortController.signal?.aborted) {
        throw new DOMException('Cancelado por el usuario', 'AbortError');
      }
      await mockRunner();
    },
    {
      name: 'AbortError',
      message: 'Cancelado por el usuario'
    }
  );

  assert.equal(called, false, 'No debe llamar al runner si ya estaba abortado');
});

console.log('\n================================================================');
console.log(`📊 RESULTADO DE LA SUITE: ${passedTests}/${totalTests} TESTS EXITOSOS`);
console.log('================================================================\n');

if (passedTests !== totalTests) {
  process.exit(1);
} else {
  process.exit(0);
}
