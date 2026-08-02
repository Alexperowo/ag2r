// server.js — AG2R Server
import express from 'express';
import { createServer as createHttpsServer } from 'https';
import { createServer as createHttpServer } from 'http';
import { WebSocketServer } from 'ws';
import cookieParser from 'cookie-parser';
import compression from 'compression';

import {
  PORT,
  SESSION_SECRET,
  AUTH_ENABLED,
  TUNNEL_ENABLED,
  TUNNEL_URL,
  HTTP_ONLY
} from './src/config.js';
import { state } from './src/state.js';
import { log, ensureCerts, authToken, parseCookies } from './src/utils.js';
import { connectCDP, scheduleReconnect } from './src/cdp.js';
import { startPolling, stopPolling } from './src/snapshot.js';
import { broadcast, broadcastStatus } from './src/broadcast.js';
import { registerRoutes } from './src/routes/index.js';
import { track, startSession, endSession } from './src/telemetry.js';

const app = express();
app.use(compression());
app.use(express.json());
app.use(cookieParser(SESSION_SECRET));

// --- Centralized API Error Tracking ---
app.use((req, res, next) => {
  const _json = res.json.bind(res);
  res.json = function (body) {
    if (res.statusCode >= 500) {
      track('api_error', { endpoint: req.path, status: res.statusCode });
    }
    return _json(body);
  };
  next();
});

if (TUNNEL_ENABLED) {
  app.set('trust proxy', true);
}

// --- Rate Limiting Configuration ---
const RATE_LIMIT_CONFIG = {
  windowMs: 60 * 1000,        // 1 minute window
  maxRequests: 100,            // max requests per window
  cleanupIntervalMs: 5 * 60 * 1000  // cleanup every 5 minutes
};

const rateLimits = new Map();

function cleanupRateLimits() {
  const now = Date.now();
  for (const [ip, timestamps] of rateLimits.entries()) {
    const valid = timestamps.filter(t => now - t < RATE_LIMIT_CONFIG.windowMs);
    if (valid.length === 0) {
      rateLimits.delete(ip);
    } else {
      rateLimits.set(ip, valid);
    }
  }
}

setInterval(cleanupRateLimits, RATE_LIMIT_CONFIG.cleanupIntervalMs);

app.use((req, res, next) => {
  const protectedPaths = ['/login', '/click', '/send', '/eval'];
  if (req.method === 'POST' && protectedPaths.includes(req.path)) {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    
    if (!rateLimits.has(ip)) {
      rateLimits.set(ip, []);
    }
    
    const timestamps = rateLimits.get(ip).filter(t => now - t < RATE_LIMIT_CONFIG.windowMs);
    
    if (timestamps.length >= RATE_LIMIT_CONFIG.maxRequests) {
      log('Security', `Rate limit exceeded for IP: ${ip} on path ${req.path}`);
      return res.status(429).json({ error: 'Too many requests, please try again later.' });
    }
    
    timestamps.push(now);
    rateLimits.set(ip, timestamps);
  }
  next();
});

// Register routes
registerRoutes(app);

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('[Express] Uncaught error:', err);
  track('api_error', { endpoint: req.path, status: 500, error: err.message });
  res.status(500).json({ error: 'Internal Server Error' });
});

async function start() {
  let server;
  if (HTTP_ONLY) {
    server = createHttpServer(app);
    log('Server', 'Running in HTTP only mode');
  } else {
    const sslOpts = ensureCerts();
    server = createHttpsServer(sslOpts, app);
  }
  
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws, req) => {
    if (AUTH_ENABLED) {
      const cookies = parseCookies(req.headers.cookie || '');
      const signed = cookieParser.signedCookie(cookies.ag2r_token || '', SESSION_SECRET);
      if (signed !== authToken()) {
        ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }));
        setTimeout(() => ws.close(), 100);
        return;
      }
    }

    state.wsClients.add(ws);
    log('WS', `Client connected (${state.wsClients.size} total)`);

    // Send initial connection status
    ws.send(JSON.stringify({
      type: 'connection',
      cdpConnected: !!state.cdpClient,
    }));

    // Send cached snapshot if available
    if (state.cachedSnapshot) {
      ws.send(JSON.stringify({
        type: 'snapshot',
        hash: state.cachedSnapshot.hash,
        agentRunning: state.cachedSnapshot.agentRunning,
        timestamp: new Date().toISOString(),
      }));
    }

    ws.on('close', () => {
      state.wsClients.delete(ws);
      log('WS', `Client disconnected (${state.wsClients.size} total)`);
    });

    ws.on('error', (err) => {
      console.debug('[WS] Error:', err.message);
      state.wsClients.delete(ws);
      ws.terminate();
    });
  });

  server.listen(PORT, () => {
    log('Server', `AG2R running on https://localhost:${PORT}`);
    if (TUNNEL_ENABLED && TUNNEL_URL) {
      log('Server', `Tunnel URL: ${TUNNEL_URL}`);
    }
    startSession();
  });

  try {
    await connectCDP();
  } catch (e) {
    log('CDP', `Initial connection failed: ${e.message}`);
    log('CDP', 'Will retry every 3 seconds...');
    scheduleReconnect();
  }

  startPolling();

  const shutdown = () => {
    log('Server', 'Shutting down...');
    endSession();
    stopPolling();
    if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
    if (state.cdpClient) state.cdpClient.close();
    for (const ws of state.wsClients) ws.close();
    wss.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 3000);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
