import Database, { type Database as Sqlite } from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as schema from './schema';

export type Db = BetterSQLite3Database<typeof schema>;

/**
 * Opens (or creates) the SQLite database and brings it to the current schema
 * via drizzle-kit migrations (./drizzle). Databases created by the pre-migration
 * raw DDL (≤ 2026-08-09) have no migrations journal — those get the baseline
 * migration stamped as already-applied, then continue from 0001 normally.
 */
export function openDb(filePath: string): Db {
  const sqlite = new Database(filePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema });
  const folder = migrationsFolder();
  if (isLegacyDb(sqlite)) stampBaseline(sqlite, folder);
  // drizzle's migrator wraps the whole batch in ONE transaction, where SQLite
  // ignores PRAGMA foreign_keys — so a table-rebuild migration (0001's tasks)
  // would DROP the old table with FK enforcement still ON and fire the
  // attachments ON DELETE CASCADE. Disable FKs around the migration (outside
  // any transaction, where the pragma actually works), then verify integrity.
  sqlite.pragma('foreign_keys = OFF');
  migrate(db, { migrationsFolder: folder });
  sqlite.pragma('foreign_keys = ON');
  const violations = sqlite.pragma('foreign_key_check') as unknown[];
  if (violations.length > 0) {
    throw new Error(
      `foreign_key_check failed after migration: ${JSON.stringify(violations.slice(0, 3))}`,
    );
  }
  return db;
}

/**
 * ./drizzle across run contexts: from source (vitest, tsx web server) this file
 * lives at desktop/main/db; bundled (out/main) and packaged (app.asar/out/main)
 * it sits two levels below the folder. electron-builder ships drizzle/** in the
 * asar, which Electron's fs patch reads transparently.
 */
function migrationsFolder(): string {
  for (const rel of ['../../drizzle', '../../../drizzle']) {
    const candidate = join(__dirname, rel);
    if (existsSync(join(candidate, 'meta', '_journal.json'))) return candidate;
  }
  return join(process.cwd(), 'drizzle');
}

function hasTable(sqlite: Sqlite, name: string): boolean {
  return (
    sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(name) !== undefined
  );
}

/**
 * Pre-migration database: tables exist (raw DDL) but no drizzle journal — or an
 * EMPTY journal next to real tables, which means a previous stamp attempt died
 * between creating the journal table and inserting the baseline row.
 */
function isLegacyDb(sqlite: Sqlite): boolean {
  if (!hasTable(sqlite, 'users')) return false;
  if (!hasTable(sqlite, '__drizzle_migrations')) return true;
  const applied = sqlite.prepare(`SELECT COUNT(*) AS n FROM "__drizzle_migrations"`).get() as {
    n: number;
  };
  return applied.n === 0;
}

/**
 * Marks the baseline migration (0000) as applied without running it — its
 * tables already exist. Uses the exact bookkeeping shape drizzle's migrator
 * creates, so `migrate()` picks up seamlessly at the next entry.
 */
function stampBaseline(sqlite: Sqlite, folder: string): void {
  const journal = JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as {
    entries: { when: number; tag: string }[];
  };
  const baseline = journal.entries[0];
  if (!baseline) return;
  const hash = createHash('sha256')
    .update(readFileSync(join(folder, `${baseline.tag}.sql`), 'utf8'))
    .digest('hex');
  // Atomic: a crash between CREATE and INSERT would otherwise leave an empty
  // journal, which every later boot would misread as "nothing applied" and
  // replay the baseline into existing tables (a permanent boot failure).
  sqlite
    .transaction(() => {
      sqlite
        .prepare(
          `CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`,
        )
        .run();
      sqlite
        .prepare(`INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)`)
        .run(hash, baseline.when);
    })
    .immediate();
}
