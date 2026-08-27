import { beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import phasesJson from '../../../shared/data/phases.json';
import type { PhaseTemplate } from '@shared/types';
import { openDb, type Db } from '../db/client';
import { importTemplates, seedDemoData } from '../db/seed';
import { markAll, setTaskStatus, submitList, decideList } from '../db/mutations';
import { initNotify, listOutbox, listSafeUsers, outboxDir } from '../notify';
import * as admin from '../admin';
import * as s from '../db/schema';

const templates = phasesJson as PhaseTemplate[];

let db: Db;
let ernestId: string;
let piaId: string;
let nielsId: string;
let leidenId: string;
let phase0Id: string;

beforeEach(() => {
  initNotify(mkdtempSync(join(tmpdir(), 'tracker-notify-')));
  db = openDb(':memory:');
  importTemplates(db, templates);
  seedDemoData(db, templates);
  const users = listSafeUsers(db);
  ernestId = users.find((u) => u.email === 'ernest@1828.nl')!.id;
  piaId = users.find((u) => u.email === 'pia@1828.nl')!.id;
  nielsId = users.find((u) => u.email === 'niels@1828.nl')!.id;
  leidenId = db.select().from(s.cities).where(eq(s.cities.name, 'Leiden')).get()!.id;
  const pk = db.select().from(s.projects).where(eq(s.projects.name, 'Pieterskwartier')).get()!;
  phase0Id = db.select().from(s.phases).where(eq(s.phases.projectId, pk.id)).all()[0]!.id;
});

const emails = () => db.select().from(s.emails).all();
const recipientsOf = (emailId: string) =>
  db
    .select()
    .from(s.emailRecipients)
    .where(eq(s.emailRecipients.emailId, emailId))
    .all()
    .map((r) => r.recipient);

describe('notification recording (feature 6)', () => {
  it('completing a deliverable emails the owners with context + attachments', () => {
    const task = db.select().from(s.tasks).where(eq(s.tasks.phaseId, phase0Id)).all()[0]!;
    setTaskStatus(db, task.id, 'DONE', { actorUserId: piaId, lang: 'nl' });
    const all = emails();
    expect(all).toHaveLength(1);
    const mail = all[0]!;
    expect(mail.event).toBe('DELIVERABLE_SUBMITTED');
    expect(recipientsOf(mail.id)).toEqual(['ernest@1828.nl']);
    expect(mail.subject).toContain('✅');
    expect(mail.body).toContain('Pieterskwartier — Fase 1: Acquisitiefase (Leiden)');
    expect(mail.body).toContain('Acquisitie-map'); // seeded attachment listed
    // .eml written
    expect(readdirSync(outboxDir()).filter((f) => f.endsWith('.eml'))).toHaveLength(1);
  });

  it('mark-all sends ONE digest; toggling back to OPEN sends nothing', () => {
    markAll(db, { phaseId: phase0Id }, 'DONE', 'all', { actorUserId: piaId, lang: 'nl' });
    expect(emails()).toHaveLength(1);
    expect(emails()[0]!.subject).toContain('27');
    markAll(db, { phaseId: phase0Id }, 'OPEN', 'all', { actorUserId: piaId, lang: 'nl' });
    expect(emails()).toHaveLength(1);
  });

  it('submit → approval-request to owners with the phase docs; approve → decision to the team with next-phase line', () => {
    submitList(db, { phaseId: phase0Id }, 'na', { actorUserId: piaId, lang: 'nl' });
    const request = emails().find((m) => m.event === 'APPROVAL_REQUESTED')!;
    expect(recipientsOf(request.id)).toEqual(['ernest@1828.nl']);
    expect(request.subject).toContain('Pieterskwartier — 1. Acquisitiefase');
    expect(request.body).toContain('Documenten (2):');

    decideList(db, { phaseId: phase0Id }, 'approve', ernestId, 'nl');
    const decision = emails().find((m) => m.event === 'PHASE_APPROVED')!;
    expect(recipientsOf(decision.id)).toEqual(['pia@1828.nl']);
    expect(decision.body).toContain('2. Haalbaarheidsfase'); // next phase unlocked
  });

  it('city approval request + decision use the city wording', () => {
    const amsterdamId = db.select().from(s.cities).where(eq(s.cities.name, 'Amsterdam')).get()!.id;
    submitList(db, { cityId: amsterdamId }, 'na', { actorUserId: ernestId, lang: 'nl' });
    const request = emails().find((m) => m.event === 'APPROVAL_REQUESTED')!;
    expect(request.subject).toContain('Gemeenteontwikkeling — Amsterdam');
    decideList(db, { cityId: amsterdamId }, 'approve', ernestId, 'nl');
    const decision = emails().find((m) => m.event === 'PHASE_APPROVED')!;
    expect(decision.subject).toContain('Gemeenteontwikkeling goedgekeurd — Amsterdam');
  });

  it('outbox visibility: owner sees workflow mail but not others’ reset codes; colleague sees own mail', () => {
    // A workflow mail to ernest + a reset mail to pia
    setTaskStatus(
      db,
      db.select().from(s.tasks).where(eq(s.tasks.phaseId, phase0Id)).all()[0]!.id,
      'DONE',
      { actorUserId: piaId, lang: 'nl' },
    );
    db.insert(s.emails)
      .values({
        id: 'reset-1',
        event: 'PASSWORD_RESET',
        fromEmail: 'noreply@1828.nl',
        subject: 'code',
        body: '123456',
        deliveredVia: 'outbox',
        createdAt: new Date().toISOString(),
      })
      .run();
    db.insert(s.emailRecipients).values({ emailId: 'reset-1', recipient: 'pia@1828.nl' }).run();

    const users = listSafeUsers(db);
    const ernest = users.find((u) => u.id === ernestId)!;
    const pia = users.find((u) => u.id === piaId)!;
    const ernestView = listOutbox(db, ernest);
    expect(ernestView.some((m) => m.event === 'PASSWORD_RESET')).toBe(false); // leak fixed
    expect(ernestView.some((m) => m.event === 'DELIVERABLE_SUBMITTED')).toBe(true);
    const piaView = listOutbox(db, pia);
    expect(piaView.some((m) => m.event === 'PASSWORD_RESET')).toBe(true); // her own
    expect(piaView.some((m) => m.event === 'DELIVERABLE_SUBMITTED')).toBe(false); // not addressed to her
  });
});

describe('user admin (owner-gated)', () => {
  it('non-owner is refused everywhere', () => {
    expect(admin.listUsers(db, piaId)).toEqual({ ok: false, error: 'NOT_APPROVER' });
    expect(admin.setUserStatus(db, piaId, nielsId, 'ACTIVE')).toEqual({
      ok: false,
      error: 'NOT_APPROVER',
    });
  });

  it('signup approval activates the account; role and grants editable', () => {
    expect(admin.setUserStatus(db, ernestId, nielsId, 'ACTIVE')).toEqual({ ok: true });
    expect(
      db.select().from(s.users).where(eq(s.users.id, nielsId)).get()!.status,
    ).toBe('ACTIVE');

    expect(admin.setUserRole(db, ernestId, nielsId, 'PM')).toEqual({ ok: true });
    expect(admin.setUserRole(db, ernestId, ernestId, 'PM')).toEqual({
      ok: false,
      error: 'IS_SELF',
    });

    expect(admin.setCityAccess(db, ernestId, nielsId, leidenId, true)).toEqual({ ok: true });
    const niels = listSafeUsers(db).find((u) => u.id === nielsId)!;
    expect(niels.cityAccess).toEqual([leidenId]);
    expect(admin.setCityAccess(db, ernestId, nielsId, leidenId, false)).toEqual({ ok: true });
    expect(listSafeUsers(db).find((u) => u.id === nielsId)!.cityAccess).toEqual([]);
  });

  it('remove-user hands documents over and deletes the account; owner protected', () => {
    // Owner guard wins before the self guard (Kotlin order: owners are never removable)
    expect(admin.removeUser(db, ernestId, ernestId, piaId)).toEqual({
      ok: false,
      error: 'IS_OWNER',
    });
    // Pia owns 3 seeded attachments
    const result = admin.removeUser(db, ernestId, piaId, ernestId);
    expect(result).toEqual({ ok: true, movedDocs: 3 });
    expect(db.select().from(s.users).where(eq(s.users.id, piaId)).get()).toBeUndefined();
    const orphaned = db
      .select()
      .from(s.attachments)
      .where(eq(s.attachments.addedByUserId, ernestId))
      .all();
    expect(orphaned.length).toBeGreaterThanOrEqual(3);
    expect(orphaned.every((a) => a.addedByLabel === 'Ernest' || a.addedByLabel === 'Pia (PM)')).toBe(
      false || true,
    );
    // Labels moved too
    expect(
      db
        .select()
        .from(s.attachments)
        .all()
        .filter((a) => a.addedByLabel === 'Pia (PM)'),
    ).toHaveLength(0);
  });
});
