// public/js/modules/artifact.js — Mobile Artifact Viewer Modal for AG2R

export function initArtifactViewer() {
  const modal = document.getElementById('artifact-modal');
  const closeBtn = document.getElementById('artifact-modal-close');
  const backdrop = modal?.querySelector('.artifact-modal-backdrop');

  if (closeBtn) closeBtn.addEventListener('click', hideArtifactModal);
  if (backdrop) backdrop.addEventListener('click', hideArtifactModal);

  // Intercept click on any artifact link or button in the chat or sidebar
  document.body.addEventListener('click', (e) => {
    const target = e.target.closest('[data-ag-artifact], [data-tab-id*="artifact__"], a[href*="brain"], a[href$=".md"]');
    if (!target) return;

    let artifactUri = target.getAttribute('data-ag-artifact') ||
                      target.getAttribute('data-tab-id') ||
                      target.getAttribute('href');

    if (artifactUri) {
      if (artifactUri.startsWith('artifact__')) artifactUri = artifactUri.replace('artifact__', '');
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      openArtifact(artifactUri, target.textContent.trim());
    }
  }, true);
}

export async function openArtifact(uri, titleHint = 'Artifact') {
  const modal = document.getElementById('artifact-modal');
  const titleEl = document.getElementById('artifact-modal-title');
  const bodyEl = document.getElementById('artifact-modal-body');

  if (!modal || !bodyEl) return;

  if (titleEl) titleEl.textContent = titleHint || 'Artifact Viewer';
  bodyEl.innerHTML = '<div style="padding: 24px; text-align: center; color: #94a3b8;">Loading artifact content...</div>';
  modal.classList.remove('hidden');

  try {
    const res = await fetch(`/api/artifact-content?uri=${encodeURIComponent(uri)}`);
    const data = await res.json();

    if (data.ok && data.content) {
      // Basic markdown styling for code blocks, bold, lists
      bodyEl.innerHTML = formatMarkdown(data.content);
    } else {
      bodyEl.innerHTML = `<div style="padding: 24px; text-align: center; color: #f87171;">Could not load artifact (${data.error || 'Unknown error'})</div>`;
    }
  } catch (err) {
    bodyEl.innerHTML = `<div style="padding: 24px; text-align: center; color: #f87171;">Error: ${err.message}</div>`;
  }
}

export function hideArtifactModal() {
  const modal = document.getElementById('artifact-modal');
  if (modal) modal.classList.add('hidden');
}

function formatMarkdown(content) {
  if (!content) return '';
  return content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/```([\s\S]*?)```/g, '<pre style="background: #1e293b; padding: 12px; borderRadius: 8px; overflow-x: auto; color: #e2e8f0; font-family: monospace;"><code>$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code style="background: #1e293b; padding: 2px 6px; borderRadius: 4px; color: #38bdf8;">$1</code>')
    .replace(/^# (.*$)/gim, '<h1 style="font-size: 1.4rem; font-weight: 600; color: #f8fafc; margin: 12px 0;">$1</h1>')
    .replace(/^## (.*$)/gim, '<h2 style="font-size: 1.2rem; font-weight: 600; color: #38bdf8; margin: 10px 0;">$1</h2>')
    .replace(/^### (.*$)/gim, '<h3 style="font-size: 1.05rem; font-weight: 600; color: #e2e8f0; margin: 8px 0;">$1</h3>')
    .replace(/\n\n/g, '<br/><br/>');
}
