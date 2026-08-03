// server.js — AG2R Server
import express from 'express';
import { createServer as createHttpsServer } from 'https';
import { createServer as createHttpServer } from 'http';
import { pathToFileURL } from 'url';
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
import {
  getClientIp,
  rateLimitMiddleware,
  SlidingWindowRateLimiter,
} from './src/security.js';

const app = express();
app.disable('x-powered-by');
app.use(compression());
app.use(express.json());
app.use(cookieParser(SESSION_SECRET));

app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self)');
  next();
});

if (TUNNEL_ENABLED) {
  app.set('trust proxy', 'loopback');
}

const LOGIN_RATE_LIMIT = new SlidingWindowRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
});
const ACTION_RATE_LIMIT = new SlidingWindowRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 120,
});
const WS_RATE_LIMIT = new SlidingWindowRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 30,
});
const rateLimitOptions = { trustLoopbackProxy: TUNNEL_ENABLED };
const limitLogin = rateLimitMiddleware(LOGIN_RATE_LIMIT, rateLimitOptions);
const limitAction = rateLimitMiddleware(ACTION_RATE_LIMIT, rateLimitOptions);

app.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/login') return limitLogin(req, res, next);
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return limitAction(req, res, next);
  next();
});

// Register routes
registerRoutes(app);

// Global Error Handler
app.use((err, req, res, next) => {
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large' });
  }

  console.error('[Express] Uncaught error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

export async function start() {
  const cleanupRateLimitsTimer = setInterval(() => {
    LOGIN_RATE_LIMIT.cleanup();
    ACTION_RATE_LIMIT.cleanup();
    WS_RATE_LIMIT.cleanup();
  }, 5 * 60 * 1000);
  cleanupRateLimitsTimer.unref?.();

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
    const ip = getClientIp(req, rateLimitOptions);
    const rateLimit = WS_RATE_LIMIT.consume(ip);
    if (!rateLimit.allowed) {
      log('Security', `WebSocket connection limit exceeded for IP: ${ip}`);
      ws.close(1013, 'Too many connection attempts');
      return;
    }

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

  await new Promise((resolve, reject) => {
    const onError = error => reject(error);
    server.once('error', onError);
    server.listen(PORT, () => {
      server.off('error', onError);
      resolve();
    });
  });

  const actualPort = server.address()?.port ?? PORT;
  const protocol = HTTP_ONLY ? 'http' : 'https';
  log('Server', `AG2R running on ${protocol}://localhost:${actualPort}`);
  if (TUNNEL_ENABLED && TUNNEL_URL) {
    log('Server', `Tunnel URL: ${TUNNEL_URL}`);
  }
  try {
    await connectCDP();
  } catch (e) {
    log('CDP', `Initial connection failed: ${e.message}`);
    log('CDP', 'Will retry every 3 seconds...');
    scheduleReconnect();
  }

  startPolling();

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('Server', 'Shutting down...');
    stopPolling();
    clearInterval(cleanupRateLimitsTimer);
    if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
    if (state.cdpClient) await state.cdpClient.close().catch(() => {});
    for (const ws of state.wsClients) ws.terminate();
    state.wsClients.clear();

    await new Promise(resolve => wss.close(() => resolve()));
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  };

  const handleSignal = () => {
    const forceExitTimer = setTimeout(() => process.exit(1), 3000);
    forceExitTimer.unref?.();
    shutdown()
      .then(() => process.exit(0))
      .catch(error => {
        console.error('[Server] Shutdown failed:', error);
        process.exit(1);
      });
  };

  process.once('SIGINT', handleSignal);
  process.once('SIGTERM', handleSignal);

  return { app, server, wss, shutdown };
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  start().catch(e => {
    console.error('Fatal:', e);
    process.exit(1);
  });
}
