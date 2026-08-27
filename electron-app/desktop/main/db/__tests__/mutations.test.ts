import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import phasesJson from '../../../../shared/data/phases.json';
import type { PhaseTemplate } from '@shared/types';
import { WIP_STEP } from '@shared/business-logic';
import { openDb, type Db } from '../client';
import { importTemplates, seedDemoData } from '../seed';
import {
  addAttachment,
  addCustomRow,
  decideList,
  deleteCustomRow,
  markAll,
  setTaskStatus,
  submitList,
} from '../mutations';
import * as t from '../schema';

const templates = phasesJson as PhaseTemplate[];

let db: Db;
let ernestId: string;
let piaId: string;
let phase0Id: string;
let phase1Id: string;
let amsterdamId: string;

beforeEach(() => {
  db = openDb(':memory:');
  importTemplates(db, templates);
  seedDemoData(db, templates);
  ernestId = db.select().from(t.users).where(eq(t.users.email, 'ernest@1828.nl')).get()!.id;
  piaId = db.select().from(t.users).where(eq(t.users.email, 'pia@1828.nl')).get()!.id;
  const pk = db.select().from(t.projects).where(eq(t.projects.name, 'Pieterskwartier')).get()!;
  phase0Id = db
    .select()
    .from(t.phases)
    .where(and(eq(t.phases.projectId, pk.id), eq(t.phases.idx, 0)))
    .get()!.id;
  phase1Id = db
    .select()
    .from(t.phases)
    .where(and(eq(t.phases.projectId, pk.id), eq(t.phases.idx, 1)))
    .get()!.id;
  amsterdamId = db.select().from(t.cities).where(eq(t.cities.name, 'Amsterdam')).get()!.id;
});

const phaseTasks = (phaseId: string) =>
  db.select().from(t.tasks).where(eq(t.tasks.phaseId, phaseId)).orderBy(t.tasks.position).all();

describe('task mutations (guards in main, not UI)', () => {
  it('tri-state toggling writes through; unknown task rejected', () => {
    const task = phaseTasks(phase0Id)[0]!;
    expect(setTaskStatus(db, task.id, 'DONE')).toEqual({ ok: true });
    expect(phaseTasks(phase0Id)[0]!.status).toBe('DONE');
    expect(setTaskStatus(db, task.id, 'NA')).toEqual({ ok: true });
    expect(setTaskStatus(db, 'ghost', 'DONE')).toEqual({ ok: false, error: 'NOT_FOUND' });
  });

  it('markAll respects the role filter (tokenized) and skips N/A rows', () => {
    const tasks = phaseTasks(phase0Id);
    setTaskStatus(db, tasks[0]!.id, 'NA');
    expect(markAll(db, { phaseId: phase0Id }, 'DONE', 'all')).toEqual({ ok: true });
    const after = phaseTasks(phase0Id);
    expect(after[0]!.status).toBe('NA'); // N/A untouched
    expect(after.slice(1).every((row) => row.status === 'DONE')).toBe(true);

    // Reset with a role filter: only MT-relevant rows (3 of 27 in Acquisitiefase)
    // flip back to OPEN — the rest stay DONE
    expect(markAll(db, { phaseId: phase0Id }, 'OPEN', 'MT')).toEqual({ ok: true });
    const mixed = phaseTasks(phase0Id);
    expect(mixed.some((row) => row.status === 'OPEN')).toBe(true);
    expect(mixed.some((row) => row.status === 'DONE')).toBe(true);
  });

  it('submit with open tasks needs a choice; N/A choice converts and submits; edits lock after', () => {
    const needs = submitList(db, { phaseId: phase0Id }, undefined);
    expect(needs).toEqual({ ok: false, error: 'NEEDS_CHOICE', openCount: 27 });

    expect(submitList(db, { phaseId: phase0Id }, 'na')).toEqual({ ok: true });
    const phase = db.select().from(t.phases).where(eq(t.phases.id, phase0Id)).get()!;
    expect(phase.submitted).toBe(true);
    expect(phaseTasks(phase0Id).every((row) => row.status === 'NA')).toBe(true);

    // Frozen: task edits and mark-all rejected (closes the Kotlin bypass class)
    const task = phaseTasks(phase0Id)[0]!;
    expect(setTaskStatus(db, task.id, 'OPEN')).toEqual({ ok: false, error: 'LOCKED' });
    expect(markAll(db, { phaseId: phase0Id }, 'OPEN', 'all')).toEqual({
      ok: false,
      error: 'LOCKED',
    });
    // Double-submit rejected
    expect(submitList(db, { phaseId: phase0Id }, undefined)).toEqual({
      ok: false,
      error: 'ALREADY_SUBMITTED',
    });
  });

  it('move choice carries open tasks to the next phase under WIP, prepended', () => {
    const tasks = phaseTasks(phase0Id);
    tasks.forEach((row) => setTaskStatus(db, row.id, 'DONE'));
    tasks.slice(0, 3).forEach((row) => setTaskStatus(db, row.id, 'OPEN'));
    const nextBefore = phaseTasks(phase1Id).length;

    expect(submitList(db, { phaseId: phase0Id }, 'move')).toEqual({ ok: true });
    expect(phaseTasks(phase0Id)).toHaveLength(24);
    const next = phaseTasks(phase1Id);
    expect(next).toHaveLength(nextBefore + 3);
    for (const row of next.slice(0, 3)) {
      expect(row.step).toBe(WIP_STEP);
      expect(row.blok).toBe('');
      expect(row.status).toBe('OPEN');
    }
    // Original next-phase rows follow, order preserved
    expect(next[3]!.step).not.toBe(WIP_STEP);
  });

  it('cities cannot move tasks (no next phase); N/A path works and gates projects on approval', () => {
    expect(submitList(db, { cityId: amsterdamId }, 'move')).toEqual({
      ok: false,
      error: 'INVALID_CHOICE',
    });
    expect(submitList(db, { cityId: amsterdamId }, 'na')).toEqual({ ok: true });

    // Non-owner cannot approve
    expect(decideList(db, { cityId: amsterdamId }, 'approve', piaId)).toEqual({
      ok: false,
      error: 'NOT_APPROVER',
    });
    // Owner approves → city approved
    expect(decideList(db, { cityId: amsterdamId }, 'approve', ernestId)).toEqual({ ok: true });
    const amsterdam = db.select().from(t.cities).where(eq(t.cities.id, amsterdamId)).get()!;
    expect(amsterdam.approved).toBe(true);
    expect(amsterdam.submitted).toBe(false);
  });

  it('approve/reject/withdraw/reopen lifecycle with owner gating', () => {
    submitList(db, { phaseId: phase0Id }, 'na');

    expect(decideList(db, { phaseId: phase0Id }, 'approve', piaId)).toEqual({
      ok: false,
      error: 'NOT_APPROVER',
    });
    expect(decideList(db, { phaseId: phase0Id }, 'withdraw', piaId)).toEqual({ ok: true });
    expect(db.select().from(t.phases).where(eq(t.phases.id, phase0Id)).get()!.submitted).toBe(
      false,
    );

    submitList(db, { phaseId: phase0Id }, 'na');
    expect(decideList(db, { phaseId: phase0Id }, 'reject', ernestId)).toEqual({ ok: true });

    submitList(db, { phaseId: phase0Id }, 'na');
    expect(decideList(db, { phaseId: phase0Id }, 'approve', ernestId)).toEqual({ ok: true });
    const approved = db.select().from(t.phases).where(eq(t.phases.id, phase0Id)).get()!;
    expect(approved.approved).toBe(true);

    // Approved stays frozen; reopen (owner) unfreezes
    expect(markAll(db, { phaseId: phase0Id }, 'OPEN', 'all')).toEqual({
      ok: false,
      error: 'LOCKED',
    });
    expect(decideList(db, { phaseId: phase0Id }, 'reopen', ernestId)).toEqual({ ok: true });
    expect(markAll(db, { phaseId: phase0Id }, 'OPEN', 'all')).toEqual({ ok: true });
  });
});

describe('structure edits — extras beyond structure.test.ts', () => {
  const blokOf = (row: { step: string; blok: string }) => `${row.step}||${row.blok}`;

  it('addCustomRow keeps positions contiguous across the whole list', () => {
    const key = blokOf(phaseTasks(phase0Id)[0]!);
    expect(addCustomRow(db, { phaseId: phase0Id }, key, 'Extra check', ernestId).ok).toBe(true);
    const after = phaseTasks(phase0Id);
    expect(after.map((row) => row.position)).toEqual(after.map((_, i) => i));
  });

  it('WIP-move leaves the source phase dense, so a later custom row lands at the true blok bottom', () => {
    // Review round repro (a): move 5 open tasks out, reject to unlock, then add.
    const tasks = phaseTasks(phase0Id);
    tasks.forEach((row) => setTaskStatus(db, row.id, 'DONE'));
    tasks.slice(0, 5).forEach((row) => setTaskStatus(db, row.id, 'OPEN'));
    submitList(db, { phaseId: phase0Id }, 'move');
    decideList(db, { phaseId: phase0Id }, 'reject', ernestId);

    const remaining = phaseTasks(phase0Id);
    expect(remaining.map((row) => row.position)).toEqual(remaining.map((_, i) => i));

    const lastKey = blokOf(remaining.at(-1)!);
    expect(addCustomRow(db, { phaseId: phase0Id }, lastKey, 'Nazorg', ernestId).ok).toBe(true);
    const after = phaseTasks(phase0Id);
    expect(after.at(-1)!.deliverable).toBe('Nazorg'); // truly at the blok bottom
    expect(after.map((row) => row.position)).toEqual(after.map((_, i) => i));
  });

  it('deleteCustomRow compacts positions — no duplicate slots for later inserts', () => {
    // Review round repro (b): add to the first blok, delete it, add to the last.
    const firstKey = blokOf(phaseTasks(phase0Id)[0]!);
    const added = addCustomRow(db, { phaseId: phase0Id }, firstKey, 'Weg', ernestId);
    expect(deleteCustomRow(db, (added as { ok: true; id: string }).id, ernestId)).toEqual({
      ok: true,
    });
    const lastKey = blokOf(phaseTasks(phase0Id).at(-1)!);
    expect(addCustomRow(db, { phaseId: phase0Id }, lastKey, 'Blijft', ernestId).ok).toBe(true);
    const positions = phaseTasks(phase0Id).map((row) => row.position);
    expect(positions).toEqual(positions.map((_, i) => i)); // dense, unique
  });

  it('gated phases refuse edits and submits in the main process (city gate + sequence)', () => {
    // Pieterskwartier phase 1 is gated until phase 0 is approved.
    const gatedTask = phaseTasks(phase1Id)[0]!;
    const key = blokOf(gatedTask);
    expect(setTaskStatus(db, gatedTask.id, 'DONE')).toEqual({ ok: false, error: 'LOCKED' });
    expect(markAll(db, { phaseId: phase1Id }, 'DONE', 'all')).toEqual({
      ok: false,
      error: 'LOCKED',
    });
    expect(addCustomRow(db, { phaseId: phase1Id }, key, 'Te vroeg', ernestId)).toEqual({
      ok: false,
      error: 'LOCKED',
    });
    expect(submitList(db, { phaseId: phase1Id }, 'na')).toEqual({ ok: false, error: 'LOCKED' });

    // Approving phase 0 unlocks phase 1 for all of the above.
    submitList(db, { phaseId: phase0Id }, 'na');
    decideList(db, { phaseId: phase0Id }, 'approve', ernestId);
    expect(setTaskStatus(db, gatedTask.id, 'DONE')).toEqual({ ok: true });
    expect(addCustomRow(db, { phaseId: phase1Id }, key, 'Nu wel', ernestId).ok).toBe(true);
  });

  it('deleteCustomRow cascades the attachments with the row', () => {
    const key = blokOf(phaseTasks(phase0Id)[0]!);
    const added = addCustomRow(db, { phaseId: phase0Id }, key, 'Tijdelijk', ernestId);
    const customId = (added as { ok: true; id: string }).id;
    addAttachment(db, customId, 'https://docs.google.com/document/d/tmp', null, ernestId);
    expect(
      db.select().from(t.attachments).where(eq(t.attachments.taskId, customId)).all(),
    ).toHaveLength(1);
    expect(deleteCustomRow(db, customId, ernestId)).toEqual({ ok: true });
    expect(
      db.select().from(t.attachments).where(eq(t.attachments.taskId, customId)).all(),
    ).toHaveLength(0);
  });
});
