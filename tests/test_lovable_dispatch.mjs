import assert from 'node:assert';
import http from 'node:http';

async function runTests() {
  console.log('🧪 Iniciando tests del Endpoint Receptor Lovable Dispatch (/api/agent/lovable-dispatch)...');

  const { default: app } = await import('../backend/src/index.js');
  
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Test 1: Validación de error MISSING_GITHUB_LINK
    console.log('  -> Test 1: Validación cuando github está ausente');
    const res1 = await fetch(`${baseUrl}/api/agent/lovable-dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'test-proj-1',
        prompt: 'Agrega un modal de contacto'
      })
    });
    const data1 = await res1.json();
    assert.strictEqual(res1.status, 400, 'Debe responder con 400');
    assert.strictEqual(data1.ok, false, 'ok debe ser false');
    assert.strictEqual(data1.error, 'MISSING_GITHUB_LINK', 'error debe ser MISSING_GITHUB_LINK');
    assert.ok(data1.message.includes('vincula tu proyecto a GitHub'), 'Mensaje amigable requerido');

    // Test 2: Validación de error MISSING_PROMPT
    console.log('  -> Test 2: Validación cuando prompt está ausente');
    const res2 = await fetch(`${baseUrl}/api/agent/lovable-dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: 'test-proj-2',
        github: { owner: 'user_test', repo: 'repo_test' }
      })
    });
    const data2 = await res2.json();
    assert.strictEqual(res2.status, 400, 'Debe responder con 400');
    assert.strictEqual(data2.ok, false, 'ok debe ser false');
    assert.strictEqual(data2.error, 'MISSING_PROMPT', 'error debe ser MISSING_PROMPT');

    // Test 3: CORS Headers para lovable.dev y chrome-extension
    console.log('  -> Test 3: Cabeceras CORS para https://lovable.dev y chrome-extension://*');
    const resCors1 = await fetch(`${baseUrl}/api/agent/lovable-dispatch`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://lovable.dev',
        'Access-Control-Request-Method': 'POST'
      }
    });
    assert.strictEqual(resCors1.headers.get('access-control-allow-origin'), 'https://lovable.dev', 'CORS origin debe permitir lovable.dev');

    const resCors2 = await fetch(`${baseUrl}/api/agent/lovable-dispatch`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'chrome-extension://abcdefghijklmnop',
        'Access-Control-Request-Method': 'POST'
      }
    });
    assert.ok(resCors2.headers.get('access-control-allow-origin'), 'CORS origin debe permitir chrome-extension://');

    // Test 4: Modo Asíncrono (respuesta inmediata para liberar socket)
    console.log('  -> Test 4: Respuesta inmediata en modo asíncrono');
    const resAsync = await fetch(`${baseUrl}/api/agent/lovable-dispatch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-dispatch-mode': 'async'
      },
      body: JSON.stringify({
        projectId: '8b08e331-4c92-48ec-904e-28f09d81d2f9',
        prompt: 'Agrega un botón en el Navbar',
        github: {
          owner: 'test_user',
          repo: 'test_repo',
          branch: 'main'
        },
        activeRoute: '/checkout'
      })
    });
    const dataAsync = await resAsync.json();
    assert.strictEqual(resAsync.status, 200, 'Debe responder 200 inmediato');
    assert.strictEqual(dataAsync.ok, true, 'ok debe ser true');
    assert.strictEqual(dataAsync.status, 'processing', 'status debe ser processing');
    assert.strictEqual(dataAsync.projectId, '8b08e331-4c92-48ec-904e-28f09d81d2f9', 'projectId debe coincidir');

    console.log('✅ ¡TODOS LOS TESTS DE LOVABLE DISPATCH PASARON EXITOSAMENTE!');
    if (server.closeAllConnections) server.closeAllConnections();
    server.close(() => {
      process.exit(0);
    });
  } catch (err) {
    console.error('❌ Error en test:', err);
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('❌ Error en test:', err);
  process.exit(1);
});
