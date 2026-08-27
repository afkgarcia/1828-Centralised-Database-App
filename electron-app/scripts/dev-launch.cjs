#!/usr/bin/env node
/**
 * Dev launcher that survives iCloud-synced checkouts on macOS.
 *
 * Executables inside a FileProvider-managed tree (e.g. an iCloud-synced
 * Desktop) get SIGKILLed by macOS. On darwin we therefore keep a clean,
 * ad-hoc-signed copy of Electron OUTSIDE the tree (~/Library/Caches/1828-electron)
 * and point ELECTRON_OVERRIDE_DIST_PATH at it. On other platforms — or healthy
 * checkouts where the override dir never gets created — this is a plain spawn.
 */
const { execFileSync, spawn } = require('node:child_process');
const { existsSync, mkdirSync, readdirSync, rmSync } = require('node:fs');
const { homedir } = require('node:os');
const { join } = require('node:path');

function ensureOverrideDist() {
  if (process.platform !== 'darwin') return null;
  const overrideDir = join(homedir(), 'Library', 'Caches', '1828-electron');
  const appBinary = join(overrideDir, 'Electron.app', 'Contents', 'MacOS', 'Electron');
  if (existsSync(appBinary)) return overrideDir;

  // Rebuild the override copy from the electron download cache.
  let zip = null;
  try {
    const version = require('electron/package.json').version;
    const wanted = `electron-v${version}-darwin-${process.arch}.zip`;
    const cacheRoot = join(homedir(), 'Library', 'Caches', 'electron');
    if (existsSync(cacheRoot)) {
      for (const entry of readdirSync(cacheRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const dir = join(cacheRoot, entry.name);
        const match = readdirSync(dir).find((f) => f === wanted);
        if (match) {
          zip = join(dir, match);
          break;
        }
      }
    }
  } catch (e) {
    console.warn('[dev-launch] cache scan failed:', e.message);
  }
  if (!zip) {
    console.warn(
      '[dev-launch] no cached Electron zip found — using the in-tree binary. ' +
        'If it gets SIGKILLed (iCloud-synced checkout), reinstall electron to repopulate the cache.',
    );
    return null;
  }

  try {
    rmSync(overrideDir, { recursive: true, force: true });
    mkdirSync(overrideDir, { recursive: true });
    execFileSync('ditto', ['-x', '-k', zip, overrideDir]);
    const app = join(overrideDir, 'Electron.app');
    execFileSync('xattr', ['-cr', app]);
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', app]);
    console.log(`[dev-launch] using signed Electron override at ${overrideDir}`);
    return overrideDir;
  } catch (e) {
    console.warn('[dev-launch] override setup failed, using in-tree Electron:', e.message);
    return null;
  }
}

const overrideDir = ensureOverrideDist();
const env = { ...process.env };

let child;
if (overrideDir) {
  env.ELECTRON_OVERRIDE_DIST_PATH = overrideDir;
  // electron-vite's managed spawn dies silently on this setup, so build once and
  // launch through the electron CLI instead — no HMR, but reliable. Healthy
  // checkouts (no override needed) keep the full electron-vite dev experience.
  execFileSync('npx', ['electron-vite', 'build'], { stdio: 'inherit', env, shell: process.platform === 'win32' });
  child = spawn('npx', ['electron', '.'], { stdio: 'inherit', env, shell: process.platform === 'win32' });
} else {
  child = spawn('npx', ['electron-vite', 'dev'], { stdio: 'inherit', env, shell: process.platform === 'win32' });
}
child.on('exit', (code) => process.exit(code ?? 0));
