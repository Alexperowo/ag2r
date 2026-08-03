import assert from 'node:assert/strict';
import test from 'node:test';

process.env.PORT = '0';
process.env.CDP_PORT = '65000';
process.env.HTTP_ONLY = 'true';
process.env.AUTH_ENABLED = 'true';
process.env.APP_PASSWORD = 'integration-test-password';
process.env.SESSION_SECRET = 'integration-test-secret-with-at-least-32-characters';

const { start } = await import('../server.js');

test('server starts, protects the app, and accepts a valid login', async t => {
  const instance = await start();
  t.after(async () => instance.shutdown());

  const port = instance.server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const rootResponse = await fetch(`${baseUrl}/`, {
    headers: { Accept: 'text/html' },
    redirect: 'manual',
  });
  assert.equal(rootResponse.status, 302);
  assert.equal(rootResponse.headers.get('location'), '/login.html');

  const wrongLogin = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'wrong' }),
  });
  assert.equal(wrongLogin.status, 401);

  const malformedLogin = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{broken',
  });
  assert.equal(malformedLogin.status, 400);

  const validLogin = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'integration-test-password' }),
  });
  assert.equal(validLogin.status, 200);
  assert.match(validLogin.headers.get('set-cookie') || '', /ag2r_token=/);
  assert.equal(validLogin.headers.get('x-frame-options'), 'DENY');

  const healthResponse = await fetch(`${baseUrl}/health`);
  assert.equal(healthResponse.status, 200);
  assert.equal((await healthResponse.json()).cdpConnected, false);
});
