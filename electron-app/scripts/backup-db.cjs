#!/usr/bin/env node
/**
 * Nightly SQLite backup via better-sqlite3's online backup API (safe while the
 * server is running — WAL-aware, no file-copy corruption risk).
 *
 *   DATA_DIR    source dir holding tracker.sqlite (default ~/.1828-tracker-web)
 *   BACKUP_DIR  destination (default <DATA_DIR>/backups)
 *   KEEP        how many backups to retain (default 30)
 *
 * Cron example (03:00 nightly):
 *   0 3 * * * cd /opt/1828/electron-app && /usr/bin/node scripts/backup-db.cjs
 */
const Database = require('better-sqlite3');
const { mkdirSync, readdirSync, statSync, unlinkSync, existsSync, cpSync, rmSync } = require('node:fs');
const { homedir } = require('node:os');
const { join } = require('node:path');

const dataDir = process.env.DATA_DIR ?? join(homedir(), '.1828-tracker-web');
const backupDir = process.env.BACKUP_DIR ?? join(dataDir, 'backups');
const keep = Number(process.env.KEEP ?? 30);
const src = join(dataDir, 'tracker.sqlite');

if (!existsSync(src)) {
  console.error(`[backup] no database at ${src}`);
  process.exit(1);
}
mkdirSync(backupDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dest = join(backupDir, `tracker-${stamp}.sqlite`);

const db = new Database(src, { readonly: true, fileMustExist: true });
db.backup(dest)
  .then(() => {
    db.close();
    // Uploaded task documents (attach-from-computer) live next to the DB —
    // snapshot them alongside it so a restore brings both back together.
    const filesDir = join(dataDir, 'files');
    if (existsSync(filesDir)) {
      cpSync(filesDir, join(backupDir, `files-${stamp}`), { recursive: true });
    }
    const backups = readdirSync(backupDir)
      .filter((f) => f.startsWith('tracker-') && f.endsWith('.sqlite'))
      .map((f) => ({ f, mtime: statSync(join(backupDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const old of backups.slice(keep)) {
      unlinkSync(join(backupDir, old.f));
      const filesSnap = join(backupDir, `files-${old.f.slice('tracker-'.length, -'.sqlite'.length)}`);
      if (existsSync(filesSnap)) rmSync(filesSnap, { recursive: true, force: true });
    }
    console.log(`[backup] wrote ${dest} (+files) (${backups.length <= keep ? backups.length : keep} retained)`);
  })
  .catch((e) => {
    console.error('[backup] failed:', e);
    process.exit(1);
  });
