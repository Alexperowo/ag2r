export {
  makeTaskClickScript,
  makeSchedClickScript,
  makeListboxClickScript,
  makeDlgClickScript
} from './click-scripts-basic.js';

export function makeClickScript(clickId, label) {
  const safeClickId = JSON.stringify(String(clickId));
  const safeLabel = JSON.stringify(label || '');
  return `
  (async () => {
    const clickId = ${safeClickId};
    const expectedLabel = ${safeLabel};

    const colonIdx = clickId.indexOf(':');
    if (colonIdx === -1) return { ok: false, reason: 'invalid_click_id' };
    const source = clickId.substring(0, colonIdx);
    const idx = parseInt(clickId.substring(colonIdx + 1), 10);

    let root = null;
    if (source === 'chat') {
      root =
        document.querySelector('.scrollbar-hide[class*="overflow-y-auto"]') ||
        document.querySelector('[data-testid="conversation-view"]') ||
        document.getElementById('conversation') ||
        document.getElementById('chat') ||
        document.getElementById('cascade');
    } else if (source === 'left') {
      const allSidebarsClick = document.querySelectorAll('[class*="bg-sidebar"]');
      let tallest = null, tallestH = 0;
      for (const el of allSidebarsClick) {
        if (el.offsetParent !== null) {
          const h = el.getBoundingClientRect().height;
          if (h > tallestH) { tallestH = h; tallest = el; }
        }
      }
      root = tallest;
    } else if (source === 'right') {
      const tabBtn = document.querySelector('[data-tab-id="overview"], [data-tab-id="review"]');
      const anchor = tabBtn || document.querySelector('[data-testid="close-aux-pane"]');
      if (anchor) {
        let el = anchor;
        for (let i = 0; i < 10 && el; i++) {
          el = el.parentElement;
          const cls = el?.className?.toString?.() || '';
          if (cls.includes('flex') && cls.includes('flex-col') && el.children.length >= 2) {
            root = el;
            break;
          }
        }
      }
    } else if (source === 'settings') {
      const settingsOverlay = document.querySelector('#root .fixed.inset-0[class*="z-[2550]"]');
      if (settingsOverlay) {
        root = settingsOverlay.querySelector('[class*="max-w-5xl"]') ||
               settingsOverlay.querySelector('[class*="rounded-2xl"]') ||
               settingsOverlay;
      }
    }

    if (!root) return { ok: false, reason: 'no_root_for_' + source };

    if (source === 'settings') {
      let sIdx = 0;
      root.querySelectorAll('button, a, [role="button"]').forEach(el => {
        el.setAttribute('data-ag-click-id', 'settings:' + sIdx);
        sIdx++;
      });
      const target = root.querySelector('[data-ag-click-id="' + clickId + '"]');
      root.querySelectorAll('[data-ag-click-id]').forEach(el => el.removeAttribute('data-ag-click-id'));
      if (!target) return { ok: false, reason: 'settings_element_not_found', clickId, total: sIdx };
      const actualLabel = (target.textContent || '').trim().substring(0, 50);
      target.click();
      return { ok: true, label: actualLabel, source: 'settings' };
    }

    const skipVis = (source === 'right' || source === 'left' || source === 'settings');
    const maxLen = (source === 'chat') ? 80 : 0;
    const visible = [];
    root.querySelectorAll('button, a, [role="button"]').forEach(el => {
      if (skipVis || el.offsetParent !== null) {
        visible.push(el);
      }
    });
    root.querySelectorAll('[class*="cursor-pointer"]').forEach(el => {
      if ((skipVis || el.offsetParent !== null) && !visible.includes(el)) {
        const hasHandler = typeof el.onclick === 'function';
        if (maxLen && (el.textContent || '').trim().length > maxLen && !hasHandler) return;
        visible.push(el);
      }
    });

    if (idx < 0 || idx >= visible.length) {
      return { ok: false, reason: 'index_out_of_range', total: visible.length };
    }

    const target = visible[idx];
    const actualLabel = (target.textContent || '').trim().substring(0, 50);

    const debugNearby = [];
    for (let d = Math.max(0, idx - 3); d <= Math.min(visible.length - 1, idx + 3); d++) {
      const el = visible[d];
      const txt = (el.textContent || '').trim().substring(0, 60);
      debugNearby.push(d + ':' + el.tagName + ' "' + txt + '"');
    }

    if (expectedLabel && actualLabel !== expectedLabel) {
      return { ok: false, reason: 'label_mismatch', expected: expectedLabel, actual: actualLabel, total: visible.length, debugNearby };
    }

    const getActiveTab = () => {
      for (const t of document.querySelectorAll('[data-tab-id]')) {
        if ((t.className || '').includes('bg-secondary')) return t.getAttribute('data-tab-id');
      }
      return null;
    };
    const tabBefore = getActiveTab();

    target.click();

    await new Promise(r => setTimeout(r, 300));
    const tabAfter = getActiveTab();
    let navigatedToFile = false;
    if (source === 'chat') {
      if (tabAfter && tabAfter !== tabBefore) {
        navigatedToFile = true;
      } else {
        const text = (target.textContent || '').trim();
        const dotIdx = text.indexOf('.');
        if (dotIdx > 0 && dotIdx < text.length - 1) {
          const beforeDot = text.substring(0, dotIdx);
          if (beforeDot.length < 30 && !beforeDot.includes(' ')) {
            navigatedToFile = true;
          }
        }
        if (!navigatedToFile && text.charAt(0) === '+' && text.includes('-')) {
          var isDiffStat = true;
          for (var ci = 0; ci < text.length; ci++) {
            var ch = text.charAt(ci);
            if (ch !== '+' && ch !== '-' && (ch < '0' || ch > '9')) { isDiffStat = false; break; }
          }
          if (isDiffStat) navigatedToFile = true;
        }
      }
    }

    return { ok: true, label: actualLabel, source, navigatedToFile, debugNearby };
  })()
  `;
}
