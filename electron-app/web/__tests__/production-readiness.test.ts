// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import phasesJson from '../../shared/data/phases.json';
import type { PhaseTemplate } from '@shared/types';
import { openDb, type Db } from '../../desktop/main/db/client';
import { importTemplates, seedDemoData } from '../../desktop/main/db/seed';
import { bootstrapOwner } from '../../desktop/main/auth';
import { initNotify } from '../../desktop/main/notify';
import { createApp } from '../app';

const templates = phasesJson as PhaseTemplate[];
initNotify(mkdtempSync(join(tmpdir(), '1828-prod-test-')));

const ENV_KEYS = ['BOOTSTRAP_OWNER_EMAIL', 'BOOTSTRAP_OWNER_PASSWORD', 'BOOTSTRAP_OWNER_NAME', 'AUTH_RATE_LIMIT'];
const servers: Server[] = [];

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  while (servers.length) servers.pop()?.close();
});

async function listen(db: Db): Promise<string> {
  const app = createApp(db, templates);
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  servers.push(server);
  const address = server.address();
  return `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
}

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

describe('owner bootstrap', () => {
  it('creates one ACTIVE owner on an empty DB from env, then never again', async () => {
    const db = openDb(':memory:');
    importTemplates(db, templates);

    expect(bootstrapOwner(db)).toBe('no-env'); // vars unset → warn path

    process.env['BOOTSTRAP_OWNER_EMAIL'] = 'ernest@vivout.nl';
    process.env['BOOTSTRAP_OWNER_PASSWORD'] = 'live-secret';
    expect(bootstrapOwner(db)).toBe('created');
    expect(bootstrapOwner(db)).toBe('not-empty'); // idempotent

    const base = await listen(db);
    const login = await fetch(`${base}/api/auth/login`, post({ email: 'ernest@vivout.nl', password: 'live-secret' }));
    const result = (await login.json()) as { outcome: string; user?: { role: string } };
    expect(result.outcome).toBe('OK');
    expect(result.user?.role).toBe('OWNER');
  });

  it('never touches a database that already has users', () => {
    const db = openDb(':memory:');
    importTemplates(db, templates);
    seedDemoData(db, templates);
    process.env['BOOTSTRAP_OWNER_EMAIL'] = 'intruder@x.nl';
    process.env['BOOTSTRAP_OWNER_PASSWORD'] = 'x';
    expect(bootstrapOwner(db)).toBe('not-empty');
  });
});

describe('persistent sessions', () => {
  it('a session survives a server "restart" (new app instance, same DB)', async () => {
    const db = openDb(':memory:');
    importTemplates(db, templates);
    seedDemoData(db, templates);

    const base1 = await listen(db);
    const login = await fetch(`${base1}/api/auth/login`, post({ email: 'ernest@1828.nl', password: 'ernest' }));
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    expect(cookie.startsWith('sid=')).toBe(true);

    const base2 = await listen(db); // fresh express instance = restarted server
    const world = await fetch(`${base2}/api/world`, { headers: { Cookie: cookie } });
    expect(world.status).toBe(200);

    // …and logout on the "restarted" server kills it for good.
    await fetch(`${base2}/api/auth/logout`, { ...post({}), headers: { 'Content-Type': 'application/json', Cookie: cookie } });
    expect((await fetch(`${base2}/api/world`, { headers: { Cookie: cookie } })).status).toBe(401);
  });
});

describe('auth hardening', () => {
  it('rate-limits repeated auth attempts per IP', async () => {
    process.env['AUTH_RATE_LIMIT'] = '3';
    const db = openDb(':memory:');
    importTemplates(db, templates);
    seedDemoData(db, templates);
    const base = await listen(db);

    const attempt = () =>
      fetch(`${base}/api/auth/login`, post({ email: 'ernest@1828.nl', password: 'wrong' }));
    await attempt();
    await attempt();
    await attempt();
    const fourth = await attempt();
    expect(fourth.status).toBe(429);
    expect(((await fourth.json()) as { error: string }).error).toBe('RATE_LIMITED');
  });

  it('gives no account-existence oracle: unknown email answers like a wrong password', async () => {
    const db = openDb(':memory:');
    importTemplates(db, templates);
    seedDemoData(db, templates);
    const base = await listen(db);

    const unknown = (await (
      await fetch(`${base}/api/auth/login`, post({ email: 'ghost@1828.nl', password: 'x' }))
    ).json()) as { outcome: string };
    const wrongPw = (await (
      await fetch(`${base}/api/auth/login`, post({ email: 'ernest@1828.nl', password: 'x' }))
    ).json()) as { outcome: string };
    expect(unknown.outcome).toBe('BAD_PASSWORD');
    expect(unknown.outcome).toBe(wrongPw.outcome);

    const resetGhost = (await (
      await fetch(`${base}/api/auth/reset-request`, post({ email: 'ghost@1828.nl' }))
    ).json()) as boolean;
    const resetReal = (await (
      await fetch(`${base}/api/auth/reset-request`, post({ email: 'ernest@1828.nl' }))
    ).json()) as boolean;
    expect(resetGhost).toBe(true);
    expect(resetReal).toBe(true);
  });
});
