// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { eq } from 'drizzle-orm';
import phasesJson from '../../shared/data/phases.json';
import type { PhaseTemplate } from '@shared/types';
import { openDb, type Db } from '../../desktop/main/db/client';
import { importTemplates, seedDemoData } from '../../desktop/main/db/seed';
import { initNotify } from '../../desktop/main/notify';
import { initFiles } from '../../desktop/main/files';
import { initDrive } from '../../desktop/main/drive-export';
import * as t from '../../desktop/main/db/schema';
import { createApp } from '../app';

const templates = phasesJson as PhaseTemplate[];

let db: Db;
let server: Server;
let base: string;
let amsterdamId: string;
let pieterskwartierId: string;
let phase0TaskId: string;
let ernestId: string;

/** Minimal cookie-jar fetch: keeps the sid cookie between calls. */
function makeClient() {
  let cookie = '';
  return async (path: string, init?: RequestInit): Promise<Response> => {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...init?.headers,
      },
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0] ?? '';
    return res;
  };
}

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

beforeAll(async () => {
  db = openDb(':memory:');
  importTemplates(db, templates);
  seedDemoData(db, templates);
  initNotify(mkdtempSync(join(tmpdir(), '1828-web-test-')));
  initFiles(mkdtempSync(join(tmpdir(), '1828-web-files-')));
  initDrive(mkdtempSync(join(tmpdir(), '1828-web-drive-')));

  amsterdamId = db.select().from(t.cities).where(eq(t.cities.name, 'Amsterdam')).get()!.id;
  ernestId = db.select().from(t.users).where(eq(t.users.email, 'ernest@1828.nl')).get()!.id;
  const pk = db.select().from(t.projects).where(eq(t.projects.name, 'Pieterskwartier')).get()!;
  pieterskwartierId = pk.id;
  const phase0 = db
    .select()
    .from(t.phases)
    .where(eq(t.phases.projectId, pk.id))
    .all()
    .find((p) => p.idx === 0)!;
  phase0TaskId = db
    .select()
    .from(t.tasks)
    .where(eq(t.tasks.phaseId, phase0.id))
    .all()
    .find((row) => row.status === 'OPEN')!.id;

  const app = createApp(db, templates);
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(() => {
  server.close();
});

describe('web API — sessions and server-side access enforcement', () => {
  it('rejects unauthenticated world requests', async () => {
    const res = await fetch(`${base}/api/world`);
    expect(res.status).toBe(401);
  });

  it('login sets a session cookie and the world is scoped to the user', async () => {
    const pia = makeClient();
    const login = await pia('/api/auth/login', post({ email: 'pia@1828.nl', password: 'test' }));
    expect(((await login.json()) as { outcome: string }).outcome).toBe('OK');

    const world = (await (await pia('/api/world')).json()) as {
      cities: { name: string }[];
      projects: { name: string }[];
    };
    expect(world.cities.map((c) => c.name)).toEqual(['Leiden']);
    expect(world.projects.map((p) => p.name)).toEqual(['Pieterskwartier']);
  });

  it('blocks mutations outside the user’s access, allows them inside', async () => {
    const pia = makeClient();
    await pia('/api/auth/login', post({ email: 'pia@1828.nl', password: 'test' }));

    const denied = await pia(
      '/api/list/mark-all',
      post({ ref: { cityId: amsterdamId }, target: 'DONE', filter: 'all' }),
    );
    expect(denied.status).toBe(403);

    const allowed = await pia('/api/task/status', post({ taskId: phase0TaskId, status: 'DONE' }));
    expect(((await allowed.json()) as { ok: boolean }).ok).toBe(true);
  });

  it('ignores actorUserId on the wire — the session user is the actor', async () => {
    const pia = makeClient();
    await pia('/api/auth/login', post({ email: 'pia@1828.nl', password: 'test' }));
    const res = await pia('/api/city/create', post({ name: 'Hacktown', actorUserId: ernestId }));
    expect((await res.json()) as object).toEqual({ ok: false, error: 'NOT_OWNER' });
  });

  it('admin surface is owner-gated; owner can create cities', async () => {
    const pia = makeClient();
    await pia('/api/auth/login', post({ email: 'pia@1828.nl', password: 'test' }));
    const deniedAdmin = (await (await pia('/api/admin/users')).json()) as { ok?: boolean };
    expect(deniedAdmin.ok).toBe(false);

    const ernest = makeClient();
    await ernest('/api/auth/login', post({ email: 'ernest@1828.nl', password: 'ernest' }));
    const users = (await (await ernest('/api/admin/users')).json()) as unknown[];
    expect(Array.isArray(users)).toBe(true);

    const created = (await (
      await ernest('/api/city/create', post({ name: 'Rotterdam' }))
    ).json()) as { ok: boolean };
    expect(created.ok).toBe(true);
    const world = (await (await ernest('/api/world')).json()) as { cities: unknown[] };
    expect(world.cities).toHaveLength(4);
  });

  it('scopes the Excel export: portfolio is owner-only, project needs access', async () => {
    const pia = makeClient();
    await pia('/api/auth/login', post({ email: 'pia@1828.nl', password: 'test' }));
    expect((await pia('/api/export/excel')).status).toBe(403);

    const scoped = await pia(`/api/export/excel?projectId=${pieterskwartierId}`);
    expect(scoped.status).toBe(200);
    expect(scoped.headers.get('content-type')).toContain('spreadsheet');
  });

  it('uploads a file from the computer, serves it access-checked, cleans up on remove', async () => {
    const ernest = makeClient();
    await ernest('/api/auth/login', post({ email: 'ernest@1828.nl', password: 'ernest' }));

    const bytes = 'PDF-bytes-van-Ernest';
    const upload = await ernest(
      `/api/attachment/upload?taskId=${encodeURIComponent(phase0TaskId)}&name=${encodeURIComponent('Besluit gemeente.pdf')}`,
      { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes },
    );
    const created = (await upload.json()) as { ok: boolean; id?: string };
    expect(created.ok).toBe(true);

    // The attachment appears in the world with the upload kind…
    const world = (await (await ernest('/api/world')).json()) as {
      projects: { phases: { tasks: { id: string; attachments: { id: string; kind: string; name: string }[] }[] }[] }[];
    };
    const att = world.projects
      .flatMap((p) => p.phases)
      .flatMap((ph) => ph.tasks)
      .find((task) => task.id === phase0TaskId)!
      .attachments.find((a) => a.id === created.id)!;
    expect(att.kind).toBe('FILE_UPLOAD');
    expect(att.name).toBe('Besluit gemeente.pdf');

    // …downloads with the original bytes for someone with access…
    const download = await ernest(`/api/files/${created.id}`);
    expect(download.status).toBe(200);
    expect(await download.text()).toBe(bytes);

    // …is invisible to anonymous callers…
    expect((await fetch(`${base}/api/files/${created.id}`)).status).toBe(401);

    // …and removing the attachment removes the file too.
    await ernest('/api/attachment/remove', post({ attachmentId: created.id }));
    expect((await ernest(`/api/files/${created.id}`)).status).toBe(404);
  });

  it('Drive endpoints: status for all, connect/export owner-only, unconfigured handled', async () => {
    const pia = makeClient();
    await pia('/api/auth/login', post({ email: 'pia@1828.nl', password: 'test' }));
    const piaStatus = (await (await pia('/api/drive/status')).json()) as {
      status: string;
      canConnect: boolean;
    };
    expect(piaStatus).toEqual({ status: 'unconfigured', canConnect: false });
    expect((await pia('/api/drive/connect')).status).toBe(403);
    expect(
      (await pia('/api/export/drive', post({ projectId: pieterskwartierId }))).status,
    ).toBe(403);

    const ernest = makeClient();
    await ernest('/api/auth/login', post({ email: 'ernest@1828.nl', password: 'ernest' }));
    const ownerStatus = (await (await ernest('/api/drive/status')).json()) as {
      canConnect: boolean;
    };
    expect(ownerStatus.canConnect).toBe(true);
    expect((await ernest('/api/drive/connect')).status).toBe(400); // no google-oauth.json yet
    const exportResult = (await (
      await ernest('/api/export/drive', post({ projectId: pieterskwartierId }))
    ).json()) as { ok: boolean; error?: string };
    expect(exportResult).toEqual({ ok: false, error: 'NOT_CONNECTED' });
  });

  it('session survives across calls and dies on logout', async () => {
    const ernest = makeClient();
    await ernest('/api/auth/login', post({ email: 'ernest@1828.nl', password: 'ernest' }));
    const session = (await (await ernest('/api/auth/session')).json()) as {
      user: { email: string };
    };
    expect(session.user.email).toBe('ernest@1828.nl');

    await ernest('/api/auth/logout', post({}));
    expect((await ernest('/api/world')).status).toBe(401);
  });
});
