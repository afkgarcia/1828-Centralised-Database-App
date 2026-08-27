import express, { type Express } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PhaseTemplate } from '@shared/types';
import type { Db } from '../desktop/main/db/client';
import { apiRouter } from './routes';

/**
 * The web app: /api/* is the REST surface (routes.ts), everything else serves
 * the built renderer (web/dist-renderer) as an SPA. Exported as a factory so
 * tests can mount it on an ephemeral port with an in-memory DB.
 */
export function createApp(db: Db, templates: PhaseTemplate[], rendererDir?: string): Express {
  const app = express();
  app.disable('x-powered-by');
  // Deployed behind a local Caddy: honor X-Forwarded-For from loopback only,
  // so req.ip (rate-limit key) is the real client, not 127.0.0.1 for everyone.
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', apiRouter(db, templates));

  const staticDir = rendererDir ?? join(__dirname, 'dist-renderer');
  if (existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(join(staticDir, 'index.html')));
  }
  return app;
}
