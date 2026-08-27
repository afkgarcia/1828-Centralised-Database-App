/**
 * One-time import: shared/data/phases.json → template tables + RASCI report.
 * Usage: npm run db:import [-- --db path/to.sqlite]
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import phasesJson from '../shared/data/phases.json';
import type { PhaseTemplate } from '../shared/types';
import { openDb } from '../desktop/main/db/client';
import { importTemplates, seedDemoData } from '../desktop/main/db/seed';

const dbArg = process.argv.indexOf('--db');
const dbPath = resolve(
  dbArg > -1 ? process.argv[dbArg + 1]! : 'tracker-data/tracker.sqlite',
);
mkdirSync(dirname(dbPath), { recursive: true });

const templates = phasesJson as PhaseTemplate[];
const db = openDb(dbPath);
const report = importTemplates(db, templates);
seedDemoData(db, templates);

console.log(`Database: ${dbPath}`);
console.log(`Templates imported: ${report.phases} phases, ${report.tasks} tasks`);
console.log(`Link-hint placeholders carried as display text: ${report.linkHints}`);
console.log(`RASCI token histogram:`, report.rasciTokenHistogram);
if (report.rasciAnomalies.length > 0) {
  console.log(
    `⚠ RASCI tokens outside the known role set (source-data cleanup for Ernest): ${report.rasciAnomalies.join(', ')}`,
  );
}
console.log('Demo seed ensured (Ernest/Pia/Niels, 3 cities, 3 projects, Leiden approved).');
