import fs from 'fs';
import multer from 'multer';
import { exec } from 'child_process';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { state } from './state.js';
import { MAX_UPLOAD_SIZE } from './config.js';
import { log } from './utils.js';
import { evaluateInBrowser, evaluateAcrossContexts } from './cdp.js';
import { track, readEvents } from './telemetry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { DISCOVER_SCRIPT } from './discover-script.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_SIZE },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

export function registerMiscRoutes(app) {
  app.post('/dismiss-portal', async (req, res) => {
    try {
      await evaluateInBrowser(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))`);
      res.json({ ok: true });
    } catch (e) {
      console.debug('[DismissPortal] Error:', e.message);
      res.json({ ok: false, error: e.message });
    }
  });

  app.post('/dismiss-scheduled-tasks', async (req, res) => {
    if (!state.cdpClient) return res.status(503).json({ error: 'CDP not connected' });
    try {
      const result = await evaluateAcrossContexts(`
      (() => {
        const sidebar = document.querySelector('[class*="bg-sidebar"]');
        if (sidebar) {
          const row = sidebar.querySelector('[class*="min-h-[32px]"]');
          if (row) {
            row.click();
            return { ok: true, method: 'sidebar-row' };
          }
        }
        window.history.back();
        return { ok: true, method: 'history-back' };
      })()
      `);
      log('DismissScheduledTasks', JSON.stringify(result));
      res.json(result || { ok: true });
    } catch (e) {
      console.debug('[DismissScheduledTasks] Error:', e.message);
      res.json({ ok: false, error: e.message });
    }
  });

  app.post('/dismiss-settings', async (req, res) => {
    if (!state.cdpClient) {
      return res.status(503).json({ error: 'CDP not connected' });
    }
    try {
      const result = await evaluateInBrowser(`
        (async () => {
          const overlay = document.querySelector('.fixed.inset-0[class*="z-[2550]"]');
          if (overlay) {
            const rect = overlay.getBoundingClientRect();
            overlay.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 5, clientY: 5 }));
            return { ok: true, method: 'backdrop' };
          }
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          return { ok: true, method: 'escape' };
        })()
      `);
      log('DismissSettings', JSON.stringify(result));
      res.json(result || { ok: false });
    } catch (e) {
      console.debug('[DismissSettings] Error:', e.message);
      res.json({ ok: false, error: e.message });
    }
  });

  app.post('/api/close-tab', async (req, res) => {
    if (!state.cdpClient) return res.status(503).json({ error: 'CDP not connected' });
    try {
      await evaluateInBrowser(`
        const overviewTab = document.querySelector('[data-tab-id="overview"]');
        if (overviewTab) {
          overviewTab.click();
        }
      `);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/type-text', async (req, res) => {
    const { placeholder, text } = req.body;
    if (!placeholder || text === undefined) {
      return res.status(400).json({ error: 'placeholder and text are required' });
    }
    if (!state.cdpClient) {
      return res.status(503).json({ error: 'CDP not connected' });
    }

    const safeText = JSON.stringify(text);
    const safePlaceholder = JSON.stringify(placeholder);
    const typeScript = `
    (() => {
      const overlay = document.querySelector('.fixed.inset-0[class*="z-[2550]"]');
      const scope = overlay || document;
      const el = scope.querySelector('input[placeholder=' + ${JSON.stringify(JSON.stringify(placeholder))} + '], textarea[placeholder=' + ${JSON.stringify(JSON.stringify(placeholder))} + ']');
      if (!el) return { ok: false, reason: 'element_not_found', placeholder: ${safePlaceholder} };

      el.focus();

      const nativeSetter = el.tagName === 'TEXTAREA'
        ? Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
        : Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;

      nativeSetter.call(el, ${safeText});

      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));

      return { ok: true, tag: el.tagName, placeholder: ${safePlaceholder}, valueLength: el.value.length };
    })()
    `;

    try {
      const result = await evaluateAcrossContexts(typeScript);
      log('TypeText', `Result: ${JSON.stringify(result)}`);
      res.json(result || { ok: false, reason: 'null_result' });
    } catch (e) {
      log('TypeText', `Error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/upload', upload.single('image'), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    if (!state.cdpClient) {
      return res.status(503).json({ error: 'CDP not connected' });
    }

    const { buffer, mimetype, originalname } = req.file;
    const base64 = buffer.toString('base64');
    const fileName = originalname || 'photo.png';

    log('Upload', `Received ${fileName} (${mimetype}, ${(buffer.length / 1024).toFixed(1)}KB)`);

    try {
      // Send large files in chunks to avoid CDP WebSocket payload limits by injecting into ALL contexts
      await evaluateAcrossContexts('window.__ag2r_chunks = [];');
      const chunkSize = 500 * 1024; // 500KB chunks
      for (let i = 0; i < base64.length; i += chunkSize) {
        const chunk = base64.substring(i, i + chunkSize);
        await evaluateAcrossContexts(`window.__ag2r_chunks.push(${JSON.stringify(chunk)});`);
      }

      const result = await evaluateInBrowser(`
      (async () => {
        const base64 = window.__ag2r_chunks.join('');
        window.__ag2r_chunks = null; // free memory
        const mimetype = ${JSON.stringify(mimetype)};
        const fileName = ${JSON.stringify(fileName)};

        const binaryStr = atob(base64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }

        const file = new File([bytes], fileName, { type: mimetype });

        const editorCandidates = document.querySelectorAll(
          '[data-lexical-editor="true"], [contenteditable="true"][role="textbox"], [contenteditable="true"]'
        );
        let editor = null;
        for (const el of editorCandidates) {
          if (el.offsetParent !== null) editor = el;
        }
        if (!editor) throw new Error('no_editor'); // Throw so CDP continues to next context if in iframe

        const dt = new DataTransfer();
        dt.items.add(file);

        editor.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
        editor.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
        editor.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));

        return { ok: true, method: 'drop', fileName, size: bytes.length };
      })()
      `);

      log('Upload', `Injection result: ${JSON.stringify(result)}`);

      if (!result?.ok) {
        return res.status(500).json({ error: result?.reason || 'Injection failed' });
      }

      track('image_uploaded');
      res.json(result);
    } catch (e) {
      log('Upload', `Error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  if (process.env.DEV_MODE === 'true') {
    app.post('/eval', async (req, res) => {
      try {
        const result = await evaluateInBrowser(`${req.body.script}`);
        res.json({ result });
      } catch (e) { res.json({ error: e.message }); }
    });
  }

  app.get('/discover', async (req, res) => {
    if (!state.cdpClient) {
      return res.status(503).json({ error: 'CDP not connected' });
    }

    try {
      const result = await evaluateInBrowser(DISCOVER_SCRIPT);
      log('Discovery', JSON.stringify(result, null, 2));
      res.json(result);
    } catch (e) {
      log('Discovery', `Error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      cdpConnected: !!state.cdpClient,
      snapshotAvailable: !!state.cachedSnapshot,
      wsClients: state.wsClients.size,
    });
  });



  // --- Client Telemetry Endpoint ---
  app.post('/telemetry', (req, res) => {
    const { event, ...payload } = req.body || {};
    if (!event || typeof event !== 'string') {
      return res.status(400).json({ error: 'event is required' });
    }
    const allowed = new Set([
      'comment_added', 'comment_edited', 'comment_deleted', 'comments_sent',
      'voice_input_used', 'artifact_viewed', 'client_error',
      'model_changed', 'branch_changed', 'worktree_changed',
      'quick_action_used',
    ]);
    if (!allowed.has(event)) {
      return res.status(400).json({ error: 'unknown event' });
    }
    track(event, payload);
    res.json({ ok: true });
  });

  // --- Telemetry Dashboard ---
  app.get('/telemetry/events', async (req, res) => {
    try {
      const events = await readEvents();
      res.json(events);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/telemetry/dashboard', (req, res) => {
    const projectRoot = path.resolve(__dirname, '..');
    res.sendFile(path.join(projectRoot, '.telemetry', 'dashboard.html'));
  });

  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: `File too large (max ${MAX_UPLOAD_SIZE / 1024 / 1024}MB)` });
      }
      return res.status(400).json({ error: err.message });
    }
    if (err.message === 'Only image files are allowed') {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  });

  app.post('/speak', async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'no text' });
    const candidatePaths = [
      process.env.TTS_SCRIPT_PATH,
      path.join(__dirname, 'speak.py'),
      path.join(os.homedir(), '.gemini', 'antigravity', 'tts', 'speak.py'),
      path.join(os.homedir(), '.gemini', 'antigravity', 'brain', '56deceb7-eb8b-4e8f-9213-46aaee40ab29', 'scratch', 'speak.py'),
    ].filter(Boolean);

    let pyScript = candidatePaths.find(p => fs.existsSync(p));
    if (!pyScript) {
      log('Speak', 'No speak.py script found in candidate paths');
      return res.status(404).json({ error: 'speak.py script not found' });
    }
    try {
        const { exec } = await import('child_process');
        const util = await import('util');
        const execAsync = util.promisify(exec);
        const pyCmd = process.env.PYTHON_CMD || (process.platform === 'win32' ? 'py' : 'python3');
        const { stdout } = await execAsync(`${pyCmd} "${pyScript}" "${text.replace(/"/g, '\\"')}"`);
        const audioFile = stdout.trim().split('\\n').pop();
        if (audioFile && audioFile.length > 5) {
            res.sendFile(audioFile);
        } else {
            res.status(500).json({ error: 'No audio generated' });
        }
    } catch (e) {
        console.error('[Speak] Error', e);
        res.status(500).json({ error: e.message });
    }
  });
}
