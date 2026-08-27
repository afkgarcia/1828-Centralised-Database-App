import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import phasesJson from '../shared/data/phases.json';
import type { PhaseTemplate } from '@shared/types';
import { openDb } from '../desktop/main/db/client';
import { importTemplates, seedDemoData } from '../desktop/main/db/seed';
import { bootstrapOwner } from '../desktop/main/auth';
import { initNotify } from '../desktop/main/notify';
import { initFiles } from '../desktop/main/files';
import { initDrive } from '../desktop/main/drive-export';
import { createApp } from './app';

/**
 * Web entry: `npm run web:start` (after `npm run web:build` for the renderer).
 * Data lives outside any synced tree in ~/.1828-tracker-web (override with
 * DATA_DIR). SEED_DEMO=1 seeds the demo world into an empty database.
 */
const dataDir = process.env['DATA_DIR'] ?? join(homedir(), '.1828-tracker-web');
mkdirSync(dataDir, { recursive: true });
initNotify(dataDir);
initFiles(dataDir);
initDrive(dataDir);

const templates = phasesJson as PhaseTemplate[];
const db = openDb(join(dataDir, 'tracker.sqlite'));
importTemplates(db, templates);
if (process.env['SEED_DEMO'] === '1') seedDemoData(db, templates);

switch (bootstrapOwner(db)) {
  case 'created':
    console.log(`[bootstrap] owner account created for ${process.env['BOOTSTRAP_OWNER_EMAIL']}`);
    break;
  case 'no-env':
    console.warn(
      '[bootstrap] users table is empty and BOOTSTRAP_OWNER_EMAIL/BOOTSTRAP_OWNER_PASSWORD are unset — nobody can log in.',
    );
    break;
}

const port = Number(process.env['PORT'] ?? 8028);
// Only the reverse proxy should reach the app — bind loopback unless overridden.
const host = process.env['HOST'] ?? '127.0.0.1';
createApp(db, templates).listen(port, host, () => {
  console.log(`1828 Fasedocument Tracker (web) on http://${host}:${port} — data in ${dataDir}`);
});
