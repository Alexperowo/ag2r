import CDP from 'chrome-remote-interface';
import { state } from './state.js';
import { CDP_HOST, CDP_PORT } from './config.js';
import { log } from './utils.js';
import { broadcast, broadcastStatus } from './broadcast.js';

const withTimeout = (promise, ms) => {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('CDP evaluation timeout')), ms);
  });
  return Promise.race([
    promise.finally(() => clearTimeout(timeoutId)),
    timeoutPromise
  ]);
};

export function selectTarget(targets = []) {
  const candidates = targets
    .filter(target => target?.type === 'page')
    .filter(target => {
      const url = target.url || '';
      return /^https?:/i.test(url);
    })
    .map((target, index) => {
      const title = target.title || '';
      const url = target.url || '';
      let score = 0;

      if (/^https?:/i.test(url)) score += 20;
      if (title.trim().toLowerCase() === 'antigravity') score += 100;
      if (/\/c\//i.test(url)) score += 90;
      if (/workbench\.html/i.test(url)) score += 85;
      if (/workbench/i.test(title)) score += 80;
      if (/jetski/i.test(url) || title === 'Launchpad') score += 50;
      if (/antigravity/i.test(title)) score += 40;

      return { target, score, index };
    });

  candidates.sort((a, b) => b.score - a.score || a.index - b.index);
  return candidates[0]?.target || null;
}

export async function discoverTarget() {
  const ports = [CDP_PORT, CDP_PORT + 1, CDP_PORT + 2, CDP_PORT + 3];

  for (const port of ports) {
    try {
      const targets = await CDP.List({ host: CDP_HOST, port });
      if (!targets || targets.length === 0) continue;

      const target = selectTarget(targets);
      if (target) return { port, target };
    } catch {
      // Port not available, try next
    }
  }
  return null;
}

export async function connectCDP() {
  const discovery = await discoverTarget();
  if (!discovery) {
    throw new Error(`No CDP target found on ${CDP_HOST}:${CDP_PORT}`);
  }

  log('CDP', `Connecting to "${discovery.target.title}" on port ${discovery.port}`);

  const client = await CDP({
    host: CDP_HOST,
    port: discovery.port,
    target: discovery.target,
  });

  state.cdpContexts = [];
  state.preferredContextId = null;

  client.Runtime.executionContextCreated(({ context }) => {
    state.cdpContexts.push(context);
    console.debug('[CDP] Context created:', context.id, context.origin);
  });

  client.Runtime.executionContextDestroyed(({ executionContextId }) => {
    state.cdpContexts = state.cdpContexts.filter(c => c.id !== executionContextId);
    if (state.preferredContextId === executionContextId) {
      state.preferredContextId = null;
    }
  });

  client.Runtime.executionContextsCleared(() => {
    state.cdpContexts = [];
    state.preferredContextId = null;
  });

  await client.Runtime.enable();
  await new Promise(r => setTimeout(r, 500));

  client.on('disconnect', () => {
    log('CDP', 'Disconnected');
    state.cdpClient = null;
    state.cdpContexts = [];
    state.preferredContextId = null;
    broadcastStatus();
    scheduleReconnect();
  });

  state.cdpClient = client;

  try { await client.Emulation.setFocusEmulationEnabled({ enabled: true }); } catch {}

  try {
    await client.Page.enable();
    client.Page.windowOpen(({ url }) => {
      if (url && (url.includes('accounts.google.com') || url.includes('google.com/o/oauth2'))) {
        log('Auth', `Google OAuth URL intercepted: ${url.substring(0, 100)}`);
        state.pendingAuthUrl = url;
        broadcast({ type: 'auth_url', googleUrl: url });
      }
    });
  } catch (e) {
    console.debug('[CDP] Page.windowOpen subscription failed:', e.message);
  }

  log('CDP', `Connected. ${state.cdpContexts.length} execution context(s) available.`);
  broadcastStatus();
  return client;
}

export function scheduleReconnect() {
  if (state.reconnectTimer) return;
  state.reconnectTimer = setTimeout(async () => {
    state.reconnectTimer = null;
    try {
      await connectCDP();
      log('CDP', 'Reconnected successfully');
    } catch (e) {
      console.debug('[CDP] Reconnect failed:', e.message);
      scheduleReconnect();
    }
  }, 3000);
}

export async function evaluateInBrowser(expression, opts = {}) {
  if (!state.cdpClient) throw new Error('CDP not connected');

  const sorted = [...state.cdpContexts].sort((a, b) => {
    if (a.id === state.preferredContextId) return -1;
    if (b.id === state.preferredContextId) return 1;
    const aDefault = a.auxData?.isDefault ? 1 : 0;
    const bDefault = b.auxData?.isDefault ? 1 : 0;
    return bDefault - aDefault;
  });

  for (const ctx of sorted) {
    try {
      const result = await withTimeout(state.cdpClient.Runtime.evaluate({
        expression,
        contextId: ctx.id,
        awaitPromise: true,
        returnByValue: true,
        ...opts,
      }), 2000);

      if (result.exceptionDetails) {
        console.debug('[CDP] Eval exception in context', ctx.id, result.exceptionDetails.text, JSON.stringify(result.exceptionDetails.exception || {}).substring(0, 200));
        continue;
      }

      state.preferredContextId = ctx.id;
      return result.result?.value ?? null;
    } catch (e) {
      console.debug('[CDP] Eval failed in context', ctx.id, e.message);
      if (
        e.message && (
          e.message.includes('Promise was collected') ||
          e.message.includes('Execution context was destroyed') ||
          e.message.includes('Execution context was cleared') ||
          e.message.includes('Cannot find context with specified id')
        )
      ) {
        log('CDP', `Context ${ctx.id} was destroyed/collected. Removing stale context.`);
        state.cdpContexts = state.cdpContexts.filter(c => c.id !== ctx.id);
        if (state.preferredContextId === ctx.id) state.preferredContextId = null;
        
        if (e.message.includes('Cannot find context with specified id')) {
          // Context was dead before execution started. Try next.
          continue;
        } else {
          // Context died during execution (likely because our click() succeeded and caused navigation).
          return { ok: true, method: 'destroyed_during_execution' };
        }
      }
      continue;
    }
  }

  throw new Error('No valid execution context');
}

export async function evaluateAcrossContexts(expression, opts = {}) {
  if (!state.cdpClient) throw new Error('CDP not connected');

  for (const ctx of state.cdpContexts) {
    try {
      const result = await withTimeout(state.cdpClient.Runtime.evaluate({
        expression,
        contextId: ctx.id,
        awaitPromise: true,
        returnByValue: true,
        ...opts,
      }), 2000);

      if (result.exceptionDetails) continue;

      const val = result.result?.value ?? null;
      if (val !== null) return val;
    } catch (e) {
      console.debug('[CDP] Eval across contexts failed in context', ctx.id, e.message);
      if (
        e.message && (
          e.message.includes('Promise was collected') ||
          e.message.includes('Execution context was destroyed') ||
          e.message.includes('Execution context was cleared') ||
          e.message.includes('Cannot find context with specified id')
        )
      ) {
        log('CDP', `Context ${ctx.id} was destroyed/collected across contexts. Removing stale context and trying next.`);
        state.cdpContexts = state.cdpContexts.filter(c => c.id !== ctx.id);
        if (state.preferredContextId === ctx.id) state.preferredContextId = null;
      }
      continue;
    }
  }

  return null;
}
