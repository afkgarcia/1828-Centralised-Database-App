/** Dev reset: delete the local database and re-import + re-seed. */
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import phasesJson from '../shared/data/phases.json';
import type { PhaseTemplate } from '../shared/types';
import { openDb } from '../desktop/main/db/client';
import { importTemplates, seedDemoData } from '../desktop/main/db/seed';

const dbPath = resolve('tracker-data/tracker.sqlite');
for (const suffix of ['', '-wal', '-shm']) {
  const p = `${dbPath}${suffix}`;
  if (existsSync(p)) rmSync(p);
}
mkdirSync(dirname(dbPath), { recursive: true });

const templates = phasesJson as PhaseTemplate[];
const db = openDb(dbPath);
importTemplates(db, templates);
seedDemoData(db, templates);
console.log(`Reset complete: ${dbPath}`);
