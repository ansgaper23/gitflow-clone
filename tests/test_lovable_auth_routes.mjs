import assert from 'node:assert/strict';
import http from 'node:http';

process.env.VERCEL = '1';

async function runTests() {
  console.log('🧪 Iniciando tests para endpoints OAuth Lovable Connect/Callback...');

  const { default: app } = await import('../backend/src/index.js');
  const { config } = await import('../backend/src/config.js');

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // Forzar githubClientId para verificar construcción de URL y parámetros
    const originalClientId = config.githubClientId;
    config.githubClientId = 'gh_client_mock_98765';

    // Test 1: GET /api/auth/github/lovable-connect
    console.log('➡️  1. Verificando GET /api/auth/github/lovable-connect...');
    const testProjectId = 'lovable-test-uuid-456';
    const testOrigin = 'https://lovable.dev/projects/123';

    const connectRes = await fetch(`${baseUrl}/api/auth/github/lovable-connect?projectId=${testProjectId}&origin=${encodeURIComponent(testOrigin)}`, {
      redirect: 'manual'
    });

    assert.equal(connectRes.status, 302, 'Debe retornar redirect 302');
    const location = connectRes.headers.get('location');
    assert.ok(location, 'Debe incluir header Location');
    assert.ok(location.startsWith('https://github.com/login/oauth/authorize?'), 'Debe redirigir a GitHub authorize');

    const parsedUrl = new URL(location);
    assert.equal(parsedUrl.searchParams.get('client_id'), 'gh_client_mock_98765', 'client_id debe coincidir con config');
    assert.ok(parsedUrl.searchParams.get('redirect_uri').includes('/api/auth/github/lovable-callback'), 'redirect_uri debe apuntar a lovable-callback');
    assert.equal(parsedUrl.searchParams.get('scope'), 'repo delete_repo read:user user:email', 'Scopes deben incluir repo, delete_repo, read:user, user:email');

    const stateRaw = parsedUrl.searchParams.get('state');
    assert.ok(stateRaw, 'Debe incluir state codificado');
    const decodedState = JSON.parse(Buffer.from(stateRaw, 'base64url').toString('utf8'));
    assert.equal(decodedState.projectId, testProjectId, 'State debe contener projectId');
    assert.equal(decodedState.origin, testOrigin, 'State debe contener origin');
    assert.equal(decodedState.isBridge, true, 'State debe tener isBridge=true');
    assert.ok(typeof decodedState.ts === 'number', 'State debe contener timestamp');
    console.log('   ✅ Redirect a GitHub con state base64url y scopes verificado');

    config.githubClientId = originalClientId;

    // Test 2: GET /api/auth/github/lovable-callback sin code
    console.log('➡️  2. Verificando GET /api/auth/github/lovable-callback sin code...');
    const callbackMissingCode = await fetch(`${baseUrl}/api/auth/github/lovable-callback`);
    assert.equal(callbackMissingCode.status, 400, 'Debe retornar 400 si falta el código');
    const htmlMissingCode = await callbackMissingCode.text();
    assert.ok(htmlMissingCode.includes('No se recibió código de autorización'), 'Debe mostrar HTML informativo de error');
    assert.ok(htmlMissingCode.includes('window.close()'), 'Debe intentar cerrar el popup');
    console.log('   ✅ Manejo de código faltante validado correctamente');

    console.log('\n🎉 ¡Todos los tests de lovable-connect / callback pasaron con éxito!');
  } catch (err) {
    console.error('❌ Error en tests:', err);
    process.exitCode = 1;
  } finally {
    server.close();
  }
}

runTests();
