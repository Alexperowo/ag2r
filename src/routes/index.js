import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

import { authMiddleware, registerAuthRoutes } from './auth.js';
import { registerApiRoutes } from './routes-api.js';
import { registerClickRoute } from './route-click.js';
import { registerSendRoute } from './route-send.js';
import { registerMiscRoutes } from './routes-misc.js';
import { registerArtifactRoute } from './route-artifact.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function registerRoutes(app) {
  // Mount Auth Middleware
  app.use(authMiddleware);

  // Static files (no cache in dev)
  app.use(express.static(path.join(__dirname, '../../public'), {
    etag: false,
    lastModified: false,
    setHeaders: (res) => {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    },
  }));

  // Fallback for symbols/icons
  const EMPTY_SVG = '<svg xmlns="http://www.w3.org/2000/svg"/>';
  app.get('/symbols-icons/*', (req, res) => {
    res.type('svg').send(EMPTY_SVG);
  });

  // Register routes
  registerAuthRoutes(app);
  registerApiRoutes(app);
  registerClickRoute(app);
  registerSendRoute(app);
  registerMiscRoutes(app);
  registerArtifactRoute(app);
}
