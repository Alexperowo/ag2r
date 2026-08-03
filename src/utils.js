import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import selfsigned from 'selfsigned';
import { APP_PASSWORD } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import crypto from 'crypto';

export function hashString(str) {
  return crypto.createHash('sha256').update(str).digest('hex').substring(0, 16);
}

export function authToken() {
  return hashString(APP_PASSWORD + ':ag2r-salt');
}

export function log(prefix, ...args) {
  console.log(`[${prefix}]`, ...args);
}

export function ensureCerts() {
  // Certs directory is in the project root, which is one level up from src/
  const certDir = path.join(__dirname, '..', 'certs');
  const keyPath = path.join(certDir, 'server.key');
  const certPath = path.join(certDir, 'server.cert');

  const ipAddresses = Object.values(os.networkInterfaces())
    .flat()
    .filter(address => address?.family === 'IPv4' && !address.internal)
    .map(address => address.address);

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    const key = fs.readFileSync(keyPath);
    const cert = fs.readFileSync(certPath);
    try {
      const parsed = new crypto.X509Certificate(cert);
      const isCurrent = Date.parse(parsed.validTo) > Date.now();
      const isGeneratedLocally = parsed.subject.includes('CN=localhost');
      const coversCurrentNetwork = ipAddresses.every(ip => parsed.subjectAltName?.includes(ip));

      if (isCurrent && (!isGeneratedLocally || coversCurrentNetwork)) return { key, cert };
      log('SSL', 'Regenerating local certificate for the current network...');
    } catch {
      log('SSL', 'Existing certificate is invalid; regenerating it...');
    }
  }

  log('SSL', 'Generating self-signed certificate...');
  fs.mkdirSync(certDir, { recursive: true });

  const pems = selfsigned.generate(
    [{ name: 'commonName', value: 'localhost' }],
    {
      days: 365,
      keySize: 2048,
      algorithm: 'sha256',
      extensions: [
        { name: 'subjectAltName', altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
          ...ipAddresses.map(ip => ({ type: 7, ip })),
        ]},
      ],
    }
  );

  fs.writeFileSync(keyPath, pems.private);
  fs.writeFileSync(certPath, pems.cert);
  log('SSL', 'Certificate saved to certs/');

  return { key: pems.private, cert: pems.cert };
}

export function parseCookies(header) {
  const cookies = {};
  if (!header || typeof header !== 'string') return cookies;

  header.split(';').forEach(pair => {
    const [name, ...rest] = pair.trim().split('=');
    if (!name) return;
    try {
      cookies[name.trim()] = decodeURIComponent(rest.join('='));
    } catch {
      // Ignore malformed cookie values instead of breaking a request/connection.
    }
  });
  return cookies;
}

export function secureEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
