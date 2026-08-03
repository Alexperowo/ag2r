import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';

import dotenv from 'dotenv';

const projectRoot = path.resolve(import.meta.dirname, '..');
const envPath = path.join(projectRoot, '.env');
if (!fs.existsSync(envPath)) throw new Error('.env does not exist; run the platform launcher first');

const config = dotenv.parse(fs.readFileSync(envPath));
const protocol = config.HTTP_ONLY === 'true' ? 'http:' : 'https:';
const port = Number.parseInt(config.PORT || '3000', 10);
const baseUrl = `${protocol}//127.0.0.1:${port}`;
const transport = protocol === 'https:' ? https : http;
const requireCdp = process.argv.includes('--require-cdp');

function request(pathname, { method = 'GET', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const request = transport.request(`${baseUrl}${pathname}`, {
      method,
      headers,
      rejectUnauthorized: false,
      timeout: 3000,
    }, response => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { responseBody += chunk; });
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: responseBody,
      }));
    });
    request.on('timeout', () => request.destroy(new Error('Request timed out')));
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

const jsonHeaders = { 'Content-Type': 'application/json' };
const health = await request('/health');
const root = await request('/', { headers: { Accept: 'text/html' } });
const wrongLogin = await request('/login', {
  method: 'POST',
  headers: jsonHeaders,
  body: JSON.stringify({ password: 'definitely-wrong' }),
});
const malformedLogin = await request('/login', {
  method: 'POST',
  headers: jsonHeaders,
  body: '{broken',
});
const validLogin = await request('/login', {
  method: 'POST',
  headers: jsonHeaders,
  body: JSON.stringify({ password: config.APP_PASSWORD }),
});

const setCookies = validLogin.headers['set-cookie'] || [];
const cookie = setCookies.join('; ');
const sessionCookie = (setCookies[0] || '').split(';', 1)[0];
const snapshot = sessionCookie
  ? await request('/snapshot', { headers: { Cookie: sessionCookie } })
  : { status: 0, body: '' };
const healthData = JSON.parse(health.body || '{}');
let snapshotData = {};
try { snapshotData = JSON.parse(snapshot.body || '{}'); } catch {}

const checks = {
  health: health.status === 200,
  rootRedirect: root.status === 302 && root.headers.location === '/login.html',
  wrongPasswordRejected: wrongLogin.status === 401,
  malformedJsonRejected: malformedLogin.status === 400,
  validLoginAccepted: validLogin.status === 200,
  cookieHttpOnly: /HttpOnly/i.test(cookie),
  cookieSameSiteStrict: /SameSite=Strict/i.test(cookie),
  cookieSecureWhenHttps: protocol !== 'https:' || /Secure/i.test(cookie),
  cdpConnected: !requireCdp || healthData.cdpConnected === true,
  snapshotAvailable: !requireCdp || (
    snapshot.status === 200 &&
    typeof snapshotData.html === 'string' &&
    snapshotData.html.length > 100
  ),
};

console.log(JSON.stringify({ baseUrl, requireCdp, checks }, null, 2));
if (Object.values(checks).some(value => !value)) process.exit(1);
