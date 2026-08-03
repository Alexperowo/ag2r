import dotenv from 'dotenv';
dotenv.config();

import crypto from 'crypto';

export const PORT = parseInt(process.env.PORT || '3000');
export const CDP_HOST = process.env.CDP_HOST || '127.0.0.1';
export const CDP_PORT = parseInt(process.env.CDP_PORT || '9000');

export const APP_PASSWORD = process.env.APP_PASSWORD || String(crypto.randomInt(100000, 1000000));
if (!process.env.APP_PASSWORD) {
  console.warn('\x1b[33m[SECURITY] No APP_PASSWORD configured. Temporary passcode: ' + APP_PASSWORD + '\x1b[0m');
}

export const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.log('[Security] Generated dynamic SESSION_SECRET for this session.');
}

export const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || '500');
export const AUTH_ENABLED = process.env.AUTH_ENABLED !== 'false';
export const TUNNEL_ENABLED = process.env.TUNNEL_ENABLED === 'true';
export const TUNNEL_URL = process.env.TUNNEL_URL || '';
export const MAX_UPLOAD_SIZE = 10 * 1024 * 1024; // 10MB
export const HTTP_ONLY = process.env.HTTP_ONLY === 'true';

