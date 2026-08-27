// @vitest-environment node
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../client';
import { readFileSync } from 'node:fs';

// Derived from the journal so adding a migration never breaks these tests again.
const MIGRATION_COUNT = (
  JSON.parse(
    readFileSync(join(__dirname, '../../../../drizzle/meta/_journal.json'), 'utf8'),
  ) as { entries: unknown[] }
).entries.length;

/**
 * The pre-migration installs (≤ 2026-08-09) created tables via raw DDL with no
 * drizzle journal. openDb must adopt such a database: stamp the baseline as
 * applied, run later migrations (sessions table), and keep the data.
 */
const LEGACY_DDL = [
  `CREATE TABLE users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL, role TEXT NOT NULL, status TEXT NOT NULL,
    access_all_cities INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
  `CREATE TABLE cities (
    id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, position INTEGER NOT NULL,
    submitted INTEGER NOT NULL DEFAULT 0, approved INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL)`,
  `CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    city_id TEXT NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
    name TEXT NOT NULL UNIQUE, position INTEGER NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE phases (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL, sheet TEXT NOT NULL,
    submitted INTEGER NOT NULL DEFAULT 0, approved INTEGER NOT NULL DEFAULT 0)`,
  `CREATE UNIQUE INDEX phases_project_idx ON phases(project_id, idx)`,
  `CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    city_id TEXT REFERENCES cities(id) ON DELETE CASCADE,
    phase_id TEXT REFERENCES phases(id) ON DELETE CASCADE,
    position INTEGER NOT NULL, step TEXT NOT NULL, blok TEXT NOT NULL,
    deliverable TEXT NOT NULL,
    r TEXT NOT NULL DEFAULT '', a TEXT NOT NULL DEFAULT '',
    s TEXT NOT NULL DEFAULT '', c TEXT NOT NULL DEFAULT '',
    i_col TEXT NOT NULL DEFAULT '', opm TEXT NOT NULL DEFAULT '',
    link_hint TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'OPEN',
    is_custom INTEGER NOT NULL DEFAULT 0,
    CHECK ((city_id IS NULL) != (phase_id IS NULL)))`,
  `CREATE INDEX tasks_city ON tasks(city_id)`,
  `CREATE INDEX tasks_phase ON tasks(phase_id)`,
  `CREATE TABLE attachments (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    name TEXT NOT NULL, url TEXT NOT NULL, kind TEXT NOT NULL,
    added_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    added_by_label TEXT NOT NULL, added_at TEXT NOT NULL)`,
  `CREATE TABLE user_city_access (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    city_id TEXT NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, city_id))`,
  `CREATE TABLE user_project_access (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, project_id))`,
  `CREATE TABLE password_reset_codes (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    code TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE emails (
    id TEXT PRIMARY KEY, event TEXT NOT NULL, from_email TEXT NOT NULL,
    subject TEXT NOT NULL, body TEXT NOT NULL,
    delivered_via TEXT NOT NULL DEFAULT 'outbox', created_at TEXT NOT NULL)`,
  `CREATE TABLE email_recipients (
    email_id TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
    recipient TEXT NOT NULL, PRIMARY KEY (email_id, recipient))`,
  `CREATE TABLE phase_templates (
    id TEXT PRIMARY KEY, idx INTEGER NOT NULL UNIQUE, sheet TEXT NOT NULL,
    is_city_phase INTEGER NOT NULL)`,
  `CREATE TABLE task_templates (
    id TEXT PRIMARY KEY,
    phase_template_id TEXT NOT NULL REFERENCES phase_templates(id) ON DELETE CASCADE,
    position INTEGER NOT NULL, source_row INTEGER NOT NULL,
    step TEXT NOT NULL, blok TEXT NOT NULL, deliverable TEXT NOT NULL,
    link_hint TEXT NOT NULL DEFAULT '',
    r TEXT NOT NULL DEFAULT '', a TEXT NOT NULL DEFAULT '',
    s TEXT NOT NULL DEFAULT '', c TEXT NOT NULL DEFAULT '',
    i_col TEXT NOT NULL DEFAULT '', opm TEXT NOT NULL DEFAULT '')`,
  `CREATE INDEX task_templates_phase ON task_templates(phase_template_id)`,
];

function makeLegacyDb(): string {
  const file = join(mkdtempSync(join(tmpdir(), '1828-mig-')), 'legacy.sqlite');
  const sqlite = new Database(file);
  for (const stmt of LEGACY_DDL) sqlite.exec(stmt);
  sqlite
    .prepare(`INSERT INTO users VALUES ('u1', 'x@1828.nl', 'hash', 'X', 'OWNER', 'ACTIVE', 1, 't')`)
    .run();
  sqlite.prepare(`INSERT INTO cities VALUES ('c1', 'Leiden', 0, 0, 1, 't')`).run();
  sqlite.prepare(`INSERT INTO projects VALUES ('p1', 'c1', 'Pieterskwartier', 0, 't')`).run();
  sqlite.prepare(`INSERT INTO phases VALUES ('ph1', 'p1', 0, 'Acquisitiefase', 0, 0)`).run();
  sqlite
    .prepare(
      `INSERT INTO tasks (id, city_id, phase_id, position, step, blok, deliverable) VALUES ('t1', 'c1', NULL, 0, '1.1', 'Blok', 'Deliverable')`,
    )
    .run();
  sqlite
    .prepare(
      `INSERT INTO tasks (id, city_id, phase_id, position, step, blok, deliverable) VALUES ('t2', NULL, 'ph1', 0, '1.4', 'Blok', 'Fase-deliverable')`,
    )
    .run();
  // The 0001 tasks rebuild once fired this cascade and wiped every attachment —
  // these rows are the regression guard for that.
  sqlite
    .prepare(
      `INSERT INTO attachments VALUES ('a1', 't1', 'Doc', 'https://x', 'WEB_LINK', 'u1', 'X', 't')`,
    )
    .run();
  sqlite
    .prepare(
      `INSERT INTO attachments VALUES ('a2', 't2', 'Doc2', 'https://y', 'WEB_LINK', 'u1', 'X', 't')`,
    )
    .run();
  sqlite.close();
  return file;
}

describe('drizzle migrations', () => {
  it('adopts a legacy raw-DDL database: baseline stamped, sessions added, data intact', () => {
    const file = makeLegacyDb();
    const db = openDb(file);

    const sqlite = new Database(file, { readonly: true });
    const tables = sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toContain('sessions');
    expect(tables).toContain('__drizzle_migrations');
    const applied = sqlite.prepare(`SELECT COUNT(*) n FROM __drizzle_migrations`).get() as {
      n: number;
    };
    expect(applied.n).toBe(MIGRATION_COUNT); // baseline stamp + later migrations
    const task = sqlite.prepare(`SELECT deliverable FROM tasks WHERE id='t1'`).get() as {
      deliverable: string;
    };
    expect(task.deliverable).toBe('Deliverable'); // survived the tasks rebuild
    // The rebuild must NOT fire the attachments cascade (city + phase tasks).
    const attachments = sqlite.prepare(`SELECT id FROM attachments ORDER BY id`).all() as {
      id: string;
    }[];
    expect(attachments.map((a) => a.id)).toEqual(['a1', 'a2']);
    sqlite.close();
    expect(db).toBeTruthy();
  });

  it('recovers from a crashed stamp: empty journal + real tables is treated as legacy', () => {
    const file = makeLegacyDb();
    const sqlite = new Database(file);
    // Simulate a crash between CREATE TABLE and the baseline INSERT.
    sqlite
      .prepare(
        `CREATE TABLE "__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`,
      )
      .run();
    sqlite.close();

    openDb(file); // must stamp + migrate, not replay the baseline
    const check = new Database(file, { readonly: true });
    const applied = check.prepare(`SELECT COUNT(*) n FROM __drizzle_migrations`).get() as {
      n: number;
    };
    expect(applied.n).toBe(MIGRATION_COUNT);
    expect(
      check.prepare(`SELECT COUNT(*) n FROM attachments`).get() as { n: number },
    ).toEqual({ n: 2 });
    check.close();
  });

  it('is idempotent: reopening an adopted database applies nothing new', () => {
    const file = makeLegacyDb();
    openDb(file);
    openDb(file); // second open must not throw or re-apply
    const sqlite = new Database(file, { readonly: true });
    const applied = sqlite.prepare(`SELECT COUNT(*) n FROM __drizzle_migrations`).get() as {
      n: number;
    };
    expect(applied.n).toBe(MIGRATION_COUNT);
    sqlite.close();
  });

  it('fresh databases enforce the tasks XOR check from the schema', () => {
    const file = join(mkdtempSync(join(tmpdir(), '1828-mig-')), 'fresh.sqlite');
    openDb(file);
    const sqlite = new Database(file);
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO tasks (id, city_id, phase_id, position, step, blok, deliverable) VALUES ('bad', NULL, NULL, 0, '', '', 'x')`,
        )
        .run(),
    ).toThrow(/tasks_list_xor|CHECK/);
    sqlite.close();
  });
});
