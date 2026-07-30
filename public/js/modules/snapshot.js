import { state } from './state.js';
import { fetchAPI } from './api.js';
import { showAuthOverlay, hideAuthOverlay } from './auth.js';
import { renderNewSessionPage } from './new-session.js';
import { addMobileCopyButtons } from './copy.js';
import { addTTSButtons } from './tts.js';
import { addClickProxyHandlers } from './proxy.js';
import { renderSidebar, fetchRightSidebar } from './sidebar.js';
import { updateModelChip } from './input.js';
import { updateScrollFab } from './scroll.js';
import { renderPermissions } from './snapshot-permissions.js';
import { openArtifact } from './artifact.js';
import {
  renderNewSessionPageInline,
  renderDropdownDialog,
  renderRunningTasks,
  renderSettingsScheduledTasks
} from './snapshot-renderers.js';
import {
  chatContent,
  cdpStyles,
  leftSidebarCdpStyles,
  rightSidebarCdpStyles,
  chatArea,
  inputBar
} from './dom.js';

export async function loadSnapshot() {
  try {
    const res = await fetchAPI(`/snapshot?t=${Date.now()}`);

    if (res.status === 503) {
      const emptyState = document.getElementById('empty-state');
      if (emptyState && !chatContent.innerHTML.trim()) {
        emptyState.classList.remove('hidden');
      }
      return;
    }

    if (!res.ok) return;

    const data = await res.json();
    state.lastHash = data.hash;

    if (data.isAuthRequired) {
      showAuthOverlay(data.isOnboarding);
      return;
    } else {
      hideAuthOverlay();
    }

    if (data.css) {
      cdpStyles.textContent = data.css;
      leftSidebarCdpStyles.textContent = data.css;
      rightSidebarCdpStyles.textContent = data.css;
    }

    const wasAtBottom = chatArea.scrollHeight - chatArea.scrollTop - chatArea.clientHeight < 80;

    const newSessionInput = document.getElementById('ag2r-new-session-input');
    const skipChatRender = data.isNewSessionPage && newSessionInput;

    if (skipChatRender) {
      renderNewSessionPageInline(chatContent, data);
    } else if (data.activeArtifactUri) {
      // IDE is currently showing the artifact editor tab (which is mostly empty/black in DOM)
      // Do NOT overwrite the chat HTML with it. Just leave the chat as is!
      const emptyState = document.getElementById('empty-state');
      if (emptyState) emptyState.classList.add('hidden');
    } else {
      chatContent.innerHTML = data.html;
      const emptyState = document.getElementById('empty-state');
      if (emptyState) emptyState.classList.add('hidden');

      if (data.isNewSessionPage) {
        renderNewSessionPage(chatContent, data);
        const leftSidebar = document.getElementById('left-sidebar');
        if (leftSidebar) leftSidebar.classList.remove('open');
      }

      const hideBottomBar = data.isNewSessionPage;
      inputBar.classList.toggle('hidden', hideBottomBar);
      const quickActions = document.getElementById('quick-actions');
      if (quickActions) {
        if (hideBottomBar) quickActions.classList.add('hidden');
      }

      addMobileCopyButtons();
      addTTSButtons(chatContent);
      addClickProxyHandlers(chatContent);
    }

    updateModelChip(data.modelName);

    state.isRendering = true;
    const leftSidebarContent = document.getElementById('left-sidebar-content');
    renderSidebar(leftSidebarContent, data.leftSidebarHtml);
    addClickProxyHandlers(leftSidebarContent);

    if (data.sidebarSignature !== undefined) {
      const sigChanged = data.sidebarSignature !== state.lastSidebarSignature;
      state.lastSidebarSignature = data.sidebarSignature;
      const rightSidebar = document.getElementById('right-sidebar');
      if (sigChanged && rightSidebar && rightSidebar.classList.contains('open')) {
        fetchRightSidebar();
      }
    }

    renderDropdownDialog(data);
    renderPermissions(data);
    renderRunningTasks(data);
    renderSettingsScheduledTasks(data);

    if (data.activeArtifactUri) {
      if (state.activeArtifactUri !== data.activeArtifactUri) {
        state.activeArtifactUri = data.activeArtifactUri;
        
        // Only open the modal if the user actually clicked something recently.
        // This prevents the modal from popping up automatically if the IDE auto-focuses the artifact.
        if (window.userRequestedArtifact) {
          openArtifact(data.activeArtifactUri);
          window.userRequestedArtifact = false;
        }
        
        // Always force the IDE back to the overview tab so the chat remains visible and updates
        fetch('/api/close-tab', { method: 'POST' }).catch(err => console.debug('[Snapshot] close-tab error:', err));
      }
      state.activeFileUri = null;
    } else if (data.activeFileUri) {
      state.activeFileUri = data.activeFileUri;
      state.activeArtifactUri = null;
    } else {
      state.activeArtifactUri = null;
      state.activeFileUri = null;
    }

    requestAnimationFrame(() => {
      if (wasAtBottom) {
        chatArea.scrollTop = chatArea.scrollHeight;
      }
      requestAnimationFrame(() => {
        state.isRendering = false;
        updateScrollFab();
      });
    });

  } catch (e) {
    console.debug('[Snapshot] Load error:', e.message);
  }
}
