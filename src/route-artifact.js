// src/route-artifact.js — Artifact Content API for AG2R
import fs from 'fs';
import path from 'path';
import os from 'os';
import { state } from './state.js';
import { log } from './utils.js';
import { evaluateInBrowser } from './cdp.js';

export function registerArtifactRoute(app) {
  app.get('/api/artifact-content', async (req, res) => {
    const { uri, filename } = req.query;
    log('Artifact', `Request uri=${uri} filename=${filename}`);

    const targetName = uri || filename;
    if (!targetName) {
      return res.status(400).json({ error: 'uri or filename is required' });
    }

    try {
      // 1. Try reading directly from active tab DOM via CDP if available
      if (state.cdpClient) {
        const domContent = await evaluateInBrowser(`
          (() => {
            const activeTab = document.querySelector('[data-tab-id].bg-secondary');
            const editorOrArticle = document.querySelector('.prose, [class*="markdown"], [contenteditable="true"]');
            if (editorOrArticle) {
              return editorOrArticle.innerText || editorOrArticle.textContent || '';
            }
            return null;
          })()
        `);

        if (domContent && domContent.length > 20) {
          return res.json({ ok: true, content: domContent, source: 'cdp_dom' });
        }
      }

      // 2. Search local brain directory for artifact markdown files
      const brainDir = path.join(os.homedir(), '.gemini', 'antigravity', 'brain');
      if (fs.existsSync(brainDir)) {
        const convFolders = fs.readdirSync(brainDir);
        for (const conv of convFolders) {
          const fullConvPath = path.join(brainDir, conv);
          if (!fs.statSync(fullConvPath).isDirectory()) continue;

          const candidatePath = path.join(fullConvPath, path.basename(targetName));
          if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
            const content = fs.readFileSync(candidatePath, 'utf8');
            return res.json({ ok: true, content, source: 'brain_fs', path: candidatePath });
          }
        }
      }

      // 3. Fallback: try direct path if exists
      if (fs.existsSync(targetName) && fs.statSync(targetName).isFile()) {
        const content = fs.readFileSync(targetName, 'utf8');
        return res.json({ ok: true, content, source: 'direct_fs' });
      }

      res.status(404).json({ error: 'Artifact not found' });
    } catch (e) {
      log('Artifact', `Error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });
}
