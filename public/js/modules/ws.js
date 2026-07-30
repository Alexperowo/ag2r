import { state } from './state.js';
import { loadSnapshot } from './snapshot.js';
import { updateConnectionStatus } from './misc.js';
import { updateActionButton } from './input.js';
import { speakText, extractCleanText, isTtsEnabled } from './tts.js';

let wsReconnectDelay = 1000;

function handleAgentRunningChange(newRunning) {
  if (state.agentRunning === newRunning) return;
  const wasRunning = state.agentRunning;
  state.agentRunning = newRunning;
  updateActionButton();
  const isOnNewSession = !!document.getElementById('ag2r-new-session-input');
  const quickActions = document.getElementById('quick-actions');
  quickActions?.classList.toggle('hidden', state.agentRunning || isOnNewSession);

  if (wasRunning && !state.agentRunning && isTtsEnabled()) {
    setTimeout(() => {
      const bubbles = document.querySelectorAll('#chat-content [role="article"][aria-label="Agent response"]');
      const lastBubble = bubbles[bubbles.length - 1];
      if (lastBubble) {
        const text = extractCleanText(lastBubble);
        if (text && text.length > 3) {
          const playBtn = lastBubble.querySelector('.tts-play-btn');
          speakText(text, playBtn, true);
        }
      }
    }, 1000);
  }
}

export function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}`;

  state.ws = new WebSocket(wsUrl);

  state.ws.onopen = () => {
    console.debug('[WS] Connected');
    wsReconnectDelay = 1000;
    updateConnectionStatus('connected');
  };

  state.ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'snapshot':
          // Only reload if content actually changed
          if (data.hash !== state.lastHash) {
            loadSnapshot();
          }
          if (data.agentRunning !== undefined) {
            handleAgentRunningChange(data.agentRunning);
          }
          break;

        case 'status':
          if (data.agentRunning !== undefined) {
            handleAgentRunningChange(data.agentRunning);
          }
          break;

        case 'connection':
          state.cdpConnected = data.cdpConnected;
          updateConnectionStatus(state.cdpConnected ? 'connected' : 'reconnecting');
          if (!state.cdpConnected) {
            const emptySub = document.querySelector('#empty-state .empty-subtitle');
            if (emptySub) emptySub.textContent = 'Waiting for Antigravity connection...';
          }
          break;

        case 'error':
          if (data.message === 'Unauthorized') {
            window.location.href = '/login.html';
          }
          break;

        case 'auth_url':
          if (data.googleUrl) {
            const authStatus = document.getElementById('auth-status');
            if (authStatus) {
              authStatus.textContent = 'Opening Google sign-in...';
              authStatus.className = 'auth-status info';
            }
            window.open(data.googleUrl, '_blank');
          }
          break;
      }
    } catch (e) {
      console.debug('[WS] Parse error:', e);
    }
  };

  state.ws.onclose = () => {
    console.debug('[WS] Disconnected, reconnecting in', wsReconnectDelay, 'ms');
    updateConnectionStatus('disconnected');
    state.ws = null;
    setTimeout(connectWebSocket, wsReconnectDelay);
    wsReconnectDelay = Math.min(wsReconnectDelay * 1.5, 10000);
  };

  state.ws.onerror = () => {
    // onclose will fire after this
  };
}
