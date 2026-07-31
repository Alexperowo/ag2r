import { state } from './state.js';
import { fetchAPI } from './api.js';
import { addClickProxyHandlers } from './proxy.js';
import { openRightSidebar } from './sidebar.js';
import { loadSnapshot } from './snapshot.js';
import {
  dropdownContent,
  dropdownOverlay,
  runningTasksCount,
  runningTasksList,
  runningTasks,
  settingsContent,
  settingsOverlay,
  scheduledTasksContent,
  scheduledTasksOverlay,
  scheduledTasksDialog
} from './dom.js';

export function renderNewSessionPageInline(chatContent, data) {
  const newSessionInput = document.getElementById('ag2r-new-session-input');
  if (!newSessionInput) return;

  const tmpDiv = document.createElement('div');
  tmpDiv.innerHTML = data.html;
  const projectBtn = tmpDiv.querySelector('[aria-haspopup="dialog"] .truncate');
  const freshProject = projectBtn ? projectBtn.textContent.trim() : '';
  const projectEl = chatContent.querySelector('.ag2r-new-session-project span:not(.material-symbols-rounded)');
  if (projectEl && freshProject) projectEl.textContent = freshProject;

  const freshModel = data.modelName || '';
  const nsModelChipText = chatContent.querySelector('.ag2r-ns-model-chip .model-chip-text');
  if (nsModelChipText && freshModel) nsModelChipText.textContent = freshModel;

  const envBar = chatContent.querySelector('.ag2r-new-session-env-bar');
  if (envBar && (data.environmentName || data.branchName)) {
    const environmentName = data.environmentName || '';
    const branchName = data.branchName || '';
    const envIcon = environmentName === 'Local'
      ? '<span class="material-symbols-rounded" style="font-size:14px">desktop_windows</span>'
      : '<span class="material-symbols-rounded" style="font-size:14px">account_tree</span>';
    let newEnvHtml = '';
    if (environmentName) {
      newEnvHtml = `
        <button type="button" class="ag2r-env-chip" data-ag-click-id="env:0" data-ag-click-label="${environmentName}">
          ${envIcon}
          <span>${environmentName}</span>
          <span class="material-symbols-rounded" style="font-size:12px">expand_more</span>
        </button>
        ${branchName ? `
        <button type="button" class="ag2r-env-chip" data-ag-click-id="env:1" data-ag-click-label="${branchName}">
          <span class="material-symbols-rounded" style="font-size:14px">fork_right</span>
          <span>${branchName}</span>
          <span class="material-symbols-rounded" style="font-size:12px">expand_more</span>
        </button>` : ''}
      `;
    }
    envBar.innerHTML = newEnvHtml;
    addClickProxyHandlers(envBar);
  }
}

export function renderDropdownDialog(data) {
  const suppressOverlay = Date.now() - state.overlayDismissedAt < 2000;
  if (data.dropdownHtml && !suppressOverlay) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = data.dropdownHtml;
    const allBtns = tempDiv.querySelectorAll('[data-ag-click-id]');
    if (allBtns.length > 0) {
      const HIDDEN_DROPDOWN_OPTIONS = /^rename$/i;
      let buttonsHtml = '';
      allBtns.forEach(btn => {
        const text = btn.textContent.trim();
        if (HIDDEN_DROPDOWN_OPTIONS.test(text)) return;
        const id = btn.dataset.agClickId;
        const label = btn.dataset.agClickLabel || text;
        const isDestructive = /delete|remove/i.test(text);
        const cls = isDestructive ? 'destructive' : '';
        buttonsHtml += `<button class="${cls}" data-ag-click-id="${id}" data-ag-click-label="${label}">${text}</button>`;
      });
      dropdownContent.innerHTML = buttonsHtml;
      addClickProxyHandlers(dropdownContent);
      dropdownOverlay.classList.remove('hidden');
    }
  } else if (!data.dropdownHtml) {
    dropdownOverlay.classList.add('hidden');
  }

  if (data.dialogHtml && !suppressOverlay) {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = data.dialogHtml;
    const dialogBtns = tempDiv.querySelectorAll('[data-ag-click-id]');
    if (dialogBtns.length > 0) {
      let buttonsHtml = '';
      dialogBtns.forEach(btn => {
        const text = btn.textContent.trim();
        if (!text) return;
        const id = btn.dataset.agClickId;
        const label = btn.dataset.agClickLabel || text;
        const isDestructive = text.toLowerCase().includes('delete');
        const isCancel = text.toLowerCase().includes('cancel');
        const cls = isDestructive ? 'destructive' : (isCancel ? 'cancel' : '');
        buttonsHtml += `<button class="${cls}" data-ag-click-id="${id}" data-ag-click-label="${label}">${text}</button>`;
      });

      const root = tempDiv.firstElementChild;
      const isPopover = root && root.getAttribute('role') === 'dialog';

      if (isPopover) {
        let popoverHtml = '';
        const walker = root.querySelector('[class*="overflow-y-auto"]') || root;
        for (const child of walker.children) {
          if (child.classList.contains('border-t') || child.tagName === 'HR') {
            popoverHtml += '<div class="dropdown-separator"></div>';
            continue;
          }
          const isHeader = child.classList.contains('text-muted-foreground') &&
            child.classList.contains('text-xs') && !child.querySelector('button');
          if (isHeader) {
            popoverHtml += `<div class="dropdown-header">${child.textContent.trim()}</div>`;
            continue;
          }
          const taggedEls = child.querySelectorAll('[data-ag-click-id]');
          const selfTagged = child.dataset?.agClickId ? [child] : [];
          const allTagged = taggedEls.length > 0 ? taggedEls : selfTagged;
          allTagged.forEach(tagged => {
            const text = tagged.textContent.trim();
            const id = tagged.dataset.agClickId;
            const label = tagged.dataset.agClickLabel || text;
            const isDestructive = /delete|remove/i.test(text);
            popoverHtml += `<button class="${isDestructive ? 'destructive' : ''}" data-ag-click-id="${id}" data-ag-click-label="${label}">${text}</button>`;
          });
        }
        dropdownContent.innerHTML = popoverHtml || buttonsHtml;
      } else {
        const cloneForText = tempDiv.cloneNode(true);
        cloneForText.querySelectorAll('[data-ag-click-id]').forEach(el => el.remove());
        const msgText = cloneForText.textContent.trim();
        const lines = msgText.split(/\n/).map(l => l.trim()).filter(Boolean);
        const title = lines[0] || 'Confirm';
        const message = lines.slice(1).join(' ') || '';

        dropdownContent.innerHTML = `
          <div class="dialog-title">${title}</div>
          ${message ? `<div class="dialog-message">${message}</div>` : ''}
          <div class="dialog-buttons">${buttonsHtml}</div>
        `;
      }
      addClickProxyHandlers(dropdownContent);
      dropdownOverlay.classList.remove('hidden');
    }
  }
}

export function renderRunningTasks(data) {
  if (data.runningTasksHtml) {
    if (data.runningTasksHtml !== runningTasks.dataset.lastHtml) {
      runningTasks.dataset.lastHtml = data.runningTasksHtml;
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = data.runningTasksHtml;

      const headerBtn = tempDiv.querySelector('button, [role="button"], .font-semibold, .font-medium');
      const headerText = headerBtn ? headerBtn.textContent.trim() : '';
      runningTasksCount.textContent = headerText || 'Tasks running / queued';

      runningTasksList.innerHTML = tempDiv.innerHTML;
      addClickProxyHandlers(runningTasksList);

      runningTasksList.classList.toggle('collapsed', state.runningTasksCollapsed);
      runningTasks.querySelector('.running-tasks-arrow')
        ?.classList.toggle('rotated', state.runningTasksCollapsed);
    }
    runningTasks.classList.remove('hidden');
  } else {
    runningTasks.classList.add('hidden');
    runningTasks.dataset.lastHtml = '';
  }
}

export function renderSettingsScheduledTasks(data) {
  if (data.settingsHtml) {
    if (settingsContent._lastHtml !== data.settingsHtml) {
      settingsContent._lastHtml = data.settingsHtml;
      settingsContent.innerHTML = data.settingsHtml;
      addClickProxyHandlers(settingsContent);
    }
    settingsOverlay.classList.remove('hidden');
  } else {
    settingsOverlay.classList.add('hidden');
    settingsContent._lastHtml = '';
  }

  if (data.scheduledTasksHtml) {
    if (scheduledTasksContent._lastHtml !== data.scheduledTasksHtml) {
      scheduledTasksContent._lastHtml = data.scheduledTasksHtml;
      scheduledTasksContent.innerHTML = data.scheduledTasksHtml;
      addClickProxyHandlers(scheduledTasksContent);
    }
    scheduledTasksOverlay.classList.remove('hidden');
  } else {
    scheduledTasksOverlay.classList.add('hidden');
    scheduledTasksContent._lastHtml = '';
  }

  if (data.scheduledTasksDialogHtml) {
    if (scheduledTasksDialog._lastHtml !== data.scheduledTasksDialogHtml) {
      scheduledTasksDialog._lastHtml = data.scheduledTasksDialogHtml;
      scheduledTasksDialog.innerHTML = data.scheduledTasksDialogHtml;
      addClickProxyHandlers(scheduledTasksDialog);
    }
    scheduledTasksDialog.classList.remove('hidden');
  } else {
    scheduledTasksDialog.classList.add('hidden');
    scheduledTasksDialog._lastHtml = '';
  }
}
