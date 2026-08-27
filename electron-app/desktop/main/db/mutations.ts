import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { PhaseTemplate, RoleFilter, Task, TaskStatus, User } from '@shared/types';
import {
  approve,
  isEditLocked,
  isPhaseUnlocked,
  isTaskRelevantToRole,
  prepareAttachment,
  reject,
  reopen,
  submit,
  WIP_STEP,
  withdraw,
  type TransitionResult,
} from '@shared/business-logic';
import { t as tr, type Lang } from '@shared/i18n';
import type { Db } from './client';
import * as t from './schema';
import { addCity as seedAddCity, addProject as seedAddProject } from './seed';
import {
  notifyApprovalRequested,
  notifyDecision,
  notifyDeliverablesSubmitted,
} from '../notify';

/**
 * Write operations. Every guard runs HERE against shared logic — never only in
 * the UI — which is what closes the Kotlin custom-row/lock bypass class of bug.
 * Approval-decision notifications are recorded when feature 6 (email) lands.
 */

export type ListRef = { cityId: string } | { phaseId: string };

export type MutationError =
  | 'NOT_FOUND'
  | 'LOCKED'
  | 'NEEDS_CHOICE'
  | 'INVALID_CHOICE'
  | 'NO_NEXT_PHASE'
  | 'NOT_APPROVER'
  | 'ALREADY_SUBMITTED'
  | 'ALREADY_APPROVED'
  | 'NOT_SUBMITTED'
  | 'NOT_APPROVED'
  | 'DUPLICATE'
  | 'NOT_OWNER'
  | 'NO_ACCESS'
  | 'INVALID_NAME'
  | 'NOT_CUSTOM'
  | 'CANCELED'
  | 'TOO_LARGE';

/** Creates report the new row's id so the UI can navigate to it. */
export type MutationResult =
  | { ok: true; id?: string }
  | { ok: false; error: MutationError; openCount?: number };

interface FlagsRow {
  submitted: boolean;
  approved: boolean;
}

function loadFlags(db: Db, ref: ListRef): FlagsRow | undefined {
  if ('cityId' in ref) {
    const row = db.select().from(t.cities).where(eq(t.cities.id, ref.cityId)).get();
    return row ? { submitted: row.submitted, approved: row.approved } : undefined;
  }
  const row = db.select().from(t.phases).where(eq(t.phases.id, ref.phaseId)).get();
  return row ? { submitted: row.submitted, approved: row.approved } : undefined;
}

function saveFlags(db: Db, ref: ListRef, flags: FlagsRow): void {
  if ('cityId' in ref) {
    db.update(t.cities).set(flags).where(eq(t.cities.id, ref.cityId)).run();
  } else {
    db.update(t.phases).set(flags).where(eq(t.phases.id, ref.phaseId)).run();
  }
}

function listTasks(db: Db, ref: ListRef): (typeof t.tasks.$inferSelect)[] {
  const where = 'cityId' in ref ? eq(t.tasks.cityId, ref.cityId) : eq(t.tasks.phaseId, ref.phaseId);
  return db.select().from(t.tasks).where(where).orderBy(t.tasks.position).all();
}

/** Rewrite a list's positions to dense 0..n-1 (insert/delete/move leave gaps otherwise). */
function compactPositions(db: Db, ref: ListRef): void {
  listTasks(db, ref).forEach((row, position) => {
    if (row.position !== position)
      db.update(t.tasks).set({ position }).where(eq(t.tasks.id, row.id)).run();
  });
}

/**
 * Returns WIP rows that a submit-with-move carried out of `phaseId` to their
 * origin: original step/blok restored, re-inserted near their old position.
 * Runs inside the caller's transaction.
 */
function pullBackMovedRows(db: Db, phaseId: string): void {
  const moved = db
    .select()
    .from(t.tasks)
    .where(eq(t.tasks.movedFromPhaseId, phaseId))
    .orderBy(t.tasks.position)
    .all()
    .filter((row) => row.step === WIP_STEP); // untouched WIP rows only
  if (moved.length === 0) return;
  const sourceRefs = new Set(moved.map((row) => row.phaseId).filter((id): id is string => !!id));
  for (const row of moved) {
    db.update(t.tasks)
      .set({
        phaseId,
        step: row.movedFromStep ?? WIP_STEP,
        blok: row.movedFromBlok ?? '',
        position: 100000 + (row.movedFromPosition ?? 0), // sort key past the tail…
        movedFromPhaseId: null,
        movedFromStep: null,
        movedFromBlok: null,
        movedFromPosition: null,
      })
      .where(eq(t.tasks.id, row.id))
      .run();
  }
  // …then both lists renumber densely; restored rows land at their old spots'
  // relative order at the end of the origin list (original positions ordered).
  compactPositions(db, { phaseId });
  for (const sourceId of sourceRefs) compactPositions(db, { phaseId: sourceId });
}

/**
 * The renderer hides gated phases behind the 🔒 panel, but a crafted IPC call
 * bypasses that — so the city gate + sequential unlock also run here: editing a
 * phase requires the parent city approved (idx 0) or the previous phase
 * approved. Cities are never gated; decisions keep their own transition rules.
 */
function isRefGated(db: Db, ref: ListRef): boolean {
  if ('cityId' in ref) return false;
  const phase = db.select().from(t.phases).where(eq(t.phases.id, ref.phaseId)).get();
  if (!phase) return false; // missing refs surface as NOT_FOUND elsewhere
  const siblings = db
    .select()
    .from(t.phases)
    .where(eq(t.phases.projectId, phase.projectId))
    .orderBy(t.phases.idx)
    .all();
  const project = db.select().from(t.projects).where(eq(t.projects.id, phase.projectId)).get();
  const city = project
    ? db.select().from(t.cities).where(eq(t.cities.id, project.cityId)).get()
    : undefined;
  return !isPhaseUnlocked(phase.idx, siblings, city?.approved === true);
}

/** Minimal Task shape for the shared RASCI matcher. */
function toRasciTask(row: typeof t.tasks.$inferSelect): Task {
  return {
    id: row.id,
    step: row.step,
    blok: row.blok,
    deliverable: row.deliverable,
    r: row.r,
    a: row.a,
    s: row.s,
    c: row.c,
    iCol: row.iCol,
    opm: row.opm,
    linkHint: row.linkHint,
    status: row.status,
    attachments: [],
    custom: row.isCustom,
  };
}

/** Notification context for a list: who/where, in the caller's UI language. */
export interface NotifyOpts {
  actorUserId: string;
  lang: Lang;
}

interface RefInfo {
  cityId: string;
  cityName: string;
  projectId?: string;
  projectName?: string;
  phaseIdx?: number;
  sheet?: string;
}

function describeRef(db: Db, ref: ListRef): RefInfo | undefined {
  if ('cityId' in ref) {
    const city = db.select().from(t.cities).where(eq(t.cities.id, ref.cityId)).get();
    return city ? { cityId: city.id, cityName: city.name } : undefined;
  }
  const phase = db.select().from(t.phases).where(eq(t.phases.id, ref.phaseId)).get();
  if (!phase) return undefined;
  const project = db.select().from(t.projects).where(eq(t.projects.id, phase.projectId)).get();
  if (!project) return undefined;
  const city = db.select().from(t.cities).where(eq(t.cities.id, project.cityId)).get();
  return {
    cityId: project.cityId,
    cityName: city?.name ?? '',
    projectId: project.id,
    projectName: project.name,
    phaseIdx: phase.idx,
    sheet: phase.sheet,
  };
}

/** Kotlin TaskCtx.label(): "Leiden — Gemeenteontwikkeling" / "X — Fase 2: Y (Leiden)". */
function contextLabel(info: RefInfo, lang: Lang): string {
  if (info.projectName === undefined) return `${info.cityName} — Gemeenteontwikkeling`;
  return `${info.projectName} — ${tr('fase', lang)} ${info.phaseIdx! + 1}: ${info.sheet} (${info.cityName})`;
}

function loadActor(db: Db, actorUserId: string): User | undefined {
  const row = db.select().from(t.users).where(eq(t.users.id, actorUserId)).get();
  if (!row) return undefined;
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    status: row.status,
    accessAllCities: row.accessAllCities,
    cityAccess: [],
    projectAccess: [],
  };
}

function taskAttachments(db: Db, taskId: string): { name: string; url: string }[] {
  return db
    .select()
    .from(t.attachments)
    .where(eq(t.attachments.taskId, taskId))
    .all()
    .map((a) => ({ name: a.name, url: a.url }));
}

export function setTaskStatus(
  db: Db,
  taskId: string,
  status: TaskStatus,
  notify?: NotifyOpts,
): MutationResult {
  const task = db.select().from(t.tasks).where(eq(t.tasks.id, taskId)).get();
  if (!task) return { ok: false, error: 'NOT_FOUND' };
  const ref: ListRef = task.cityId ? { cityId: task.cityId } : { phaseId: task.phaseId! };
  const flags = loadFlags(db, ref);
  if (!flags) return { ok: false, error: 'NOT_FOUND' };
  if (isEditLocked(flags) || isRefGated(db, ref)) return { ok: false, error: 'LOCKED' };
  db.update(t.tasks).set({ status }).where(eq(t.tasks.id, taskId)).run();

  // Kotlin parity: completing a deliverable notifies the owners.
  if (notify && task.status !== 'DONE' && status === 'DONE') {
    const actor = loadActor(db, notify.actorUserId);
    const info = describeRef(db, ref);
    if (actor && info) {
      notifyDeliverablesSubmitted(
        db,
        actor,
        contextLabel(info, notify.lang),
        [{ deliverable: task.deliverable, attachments: taskAttachments(db, task.id) }],
        notify.lang,
      );
    }
  }
  return { ok: true };
}

/** Kotlin markAll parity: only role-relevant tasks change; N/A rows are skipped. */
export function markAll(
  db: Db,
  ref: ListRef,
  target: 'DONE' | 'OPEN',
  filter: RoleFilter,
  notify?: NotifyOpts,
): MutationResult {
  const flags = loadFlags(db, ref);
  if (!flags) return { ok: false, error: 'NOT_FOUND' };
  if (isEditLocked(flags) || isRefGated(db, ref)) return { ok: false, error: 'LOCKED' };
  const rows = listTasks(db, ref);
  const completed: (typeof rows)[number][] = [];
  db.transaction(() => {
    for (const row of rows) {
      if (row.status === 'NA') continue;
      if (filter !== 'all' && !isTaskRelevantToRole(toRasciTask(row), filter)) continue;
      if (target === 'DONE' && row.status === 'OPEN') completed.push(row);
      db.update(t.tasks).set({ status: target }).where(eq(t.tasks.id, row.id)).run();
    }
  });

  // Kotlin parity: one digest email instead of one per row.
  if (notify && completed.length > 0) {
    const actor = loadActor(db, notify.actorUserId);
    const info = describeRef(db, ref);
    if (actor && info) {
      notifyDeliverablesSubmitted(
        db,
        actor,
        contextLabel(info, notify.lang),
        completed.map((row) => ({
          deliverable: row.deliverable,
          attachments: taskAttachments(db, row.id),
        })),
        notify.lang,
      );
    }
  }
  return { ok: true };
}

/**
 * Submit with unfinished-task handling. `choice` resolves open tasks:
 * 'na' marks them not-applicable; 'move' carries them to the next phase under
 * the WIP headline (projects only, never the last phase); absent choice with
 * open tasks returns NEEDS_CHOICE so the UI can run the two-step dialog.
 */
export function submitList(
  db: Db,
  ref: ListRef,
  choice: 'na' | 'move' | undefined,
  notify?: NotifyOpts,
): MutationResult {
  let result: MutationResult = { ok: true };
  db.transaction(() => {
    const flags = loadFlags(db, ref);
    if (!flags) {
      result = { ok: false, error: 'NOT_FOUND' };
      return;
    }
    if (isRefGated(db, ref)) {
      result = { ok: false, error: 'LOCKED' };
      return;
    }
    const transition: TransitionResult = submit(flags);
    if (!transition.ok) {
      result = { ok: false, error: transition.error as MutationError };
      return;
    }
    const open = listTasks(db, ref).filter((row) => row.status === 'OPEN');
    if (open.length > 0) {
      if (!choice) {
        result = { ok: false, error: 'NEEDS_CHOICE', openCount: open.length };
        return;
      }
      if (choice === 'na') {
        for (const row of open) {
          db.update(t.tasks).set({ status: 'NA' }).where(eq(t.tasks.id, row.id)).run();
        }
      } else {
        if ('cityId' in ref) {
          result = { ok: false, error: 'INVALID_CHOICE' };
          return;
        }
        const phase = db.select().from(t.phases).where(eq(t.phases.id, ref.phaseId)).get()!;
        const next = db
          .select()
          .from(t.phases)
          .where(and(eq(t.phases.projectId, phase.projectId), eq(t.phases.idx, phase.idx + 1)))
          .get();
        if (!next) {
          result = { ok: false, error: 'NO_NEXT_PHASE' };
          return;
        }
        // Prepend under the WIP headline: existing rows shift down, moved rows lead.
        const nextTasks = db
          .select()
          .from(t.tasks)
          .where(eq(t.tasks.phaseId, next.id))
          .orderBy(t.tasks.position)
          .all();
        nextTasks.forEach((row, i) => {
          db.update(t.tasks)
            .set({ position: open.length + i })
            .where(eq(t.tasks.id, row.id))
            .run();
        });
        open.forEach((row, i) => {
          db.update(t.tasks)
            .set({
              phaseId: next.id,
              position: i,
              step: WIP_STEP,
              blok: '',
              movedFromPhaseId: phase.id,
              movedFromStep: row.step,
              movedFromBlok: row.blok,
              movedFromPosition: row.position,
            })
            .where(eq(t.tasks.id, row.id))
            .run();
        });
        compactPositions(db, ref); // the moved-out rows leave gaps behind
      }
    }
    saveFlags(db, ref, transition.flags);
  });

  // Approval-request email once the submit actually happened.
  if (result.ok && notify) {
    const actor = loadActor(db, notify.actorUserId);
    const info = describeRef(db, ref);
    if (actor && info) {
      const docs = listTasks(db, ref).flatMap((row) => taskAttachments(db, row.id));
      notifyApprovalRequested(
        db,
        actor,
        {
          projectName: info.projectName,
          cityName: info.cityName,
          phaseLabel:
            info.phaseIdx !== undefined ? `${info.phaseIdx + 1}. ${info.sheet}` : undefined,
          docs,
        },
        notify.lang,
      );
    }
  }
  return result;
}

export type DecideAction = 'approve' | 'reject' | 'withdraw' | 'reopen';

/** Owner-gated decisions; actor is resolved from the DB, not trusted from the wire. */
export function decideList(
  db: Db,
  ref: ListRef,
  action: DecideAction,
  actorUserId: string,
  lang: Lang = 'nl',
): MutationResult {
  const actor = db.select().from(t.users).where(eq(t.users.id, actorUserId)).get();
  if (!actor) return { ok: false, error: 'NOT_FOUND' };
  const flags = loadFlags(db, ref);
  if (!flags) return { ok: false, error: 'NOT_FOUND' };

  const transition: TransitionResult =
    action === 'approve'
      ? approve(flags, actor)
      : action === 'reject'
        ? reject(flags, actor)
        : action === 'reopen'
          ? reopen(flags, actor)
          : withdraw(flags);

  if (!transition.ok) return { ok: false, error: transition.error as MutationError };
  db.transaction(() => {
    saveFlags(db, ref, transition.flags);
    // Ernest's WIP rule: a rejected or withdrawn submission takes its moved
    // rows back — they only truly land in the next phase once approved.
    if ((action === 'reject' || action === 'withdraw') && 'phaseId' in ref) {
      pullBackMovedRows(db, ref.phaseId);
    }
  });

  // Approve/reject notify the team (withdraw/reopen are silent — Kotlin parity).
  if (action === 'approve' || action === 'reject') {
    const info = describeRef(db, ref);
    const actorDto = loadActor(db, actorUserId);
    if (info && actorDto) {
      let nextPhaseLabel: string | undefined;
      if (info.projectId !== undefined && action === 'approve') {
        const next = db
          .select()
          .from(t.phases)
          .where(and(eq(t.phases.projectId, info.projectId), eq(t.phases.idx, info.phaseIdx! + 1)))
          .get();
        nextPhaseLabel = next ? `${next.idx + 1}. ${next.sheet}` : undefined;
      }
      notifyDecision(
        db,
        actorDto,
        {
          projectRef:
            info.projectId !== undefined
              ? { id: info.projectId, cityId: info.cityId }
              : undefined,
          projectName: info.projectName,
          cityId: info.cityId,
          cityName: info.cityName,
          phaseLabel:
            info.phaseIdx !== undefined ? `${info.phaseIdx + 1}. ${info.sheet}` : undefined,
          nextPhaseLabel,
        },
        action === 'approve',
        lang,
      );
    }
  }
  return { ok: true };
}

// ── Attachments (Drive links) ───────────────────────────────────────────────

export function addAttachment(
  db: Db,
  taskId: string,
  url: string,
  name: string | null,
  actorUserId: string,
): MutationResult {
  const task = db.select().from(t.tasks).where(eq(t.tasks.id, taskId)).get();
  if (!task) return { ok: false, error: 'NOT_FOUND' };
  const ref: ListRef = task.cityId ? { cityId: task.cityId } : { phaseId: task.phaseId! };
  const flags = loadFlags(db, ref);
  if (!flags || isEditLocked(flags) || isRefGated(db, ref))
    return { ok: false, error: flags ? 'LOCKED' : 'NOT_FOUND' };
  const actor = loadActor(db, actorUserId);
  if (!actor) return { ok: false, error: 'NOT_FOUND' };
  const prepared = prepareAttachment(url, name);
  if (!prepared) return { ok: false, error: 'INVALID_CHOICE' };
  db.insert(t.attachments)
    .values({
      id: randomUUID(),
      taskId,
      name: prepared.name,
      url: prepared.url,
      kind: prepared.kind,
      addedByUserId: actor.id,
      addedByLabel: actor.displayName,
      addedAt: new Date().toISOString(),
    })
    .run();
  return { ok: true };
}

/**
 * Attachment row for an uploaded file (kind FILE_UPLOAD, url `upload://<id>`).
 * Same guards as link attachments; the CALLER writes the bytes to the files
 * dir after ok (and compensates by deleting the row if that write fails).
 */
export function addFileAttachment(
  db: Db,
  taskId: string,
  fileName: string,
  actorUserId: string,
): MutationResult {
  const task = db.select().from(t.tasks).where(eq(t.tasks.id, taskId)).get();
  if (!task) return { ok: false, error: 'NOT_FOUND' };
  const ref: ListRef = task.cityId ? { cityId: task.cityId } : { phaseId: task.phaseId! };
  const flags = loadFlags(db, ref);
  if (!flags || isEditLocked(flags) || isRefGated(db, ref))
    return { ok: false, error: flags ? 'LOCKED' : 'NOT_FOUND' };
  const actor = loadActor(db, actorUserId);
  if (!actor) return { ok: false, error: 'NOT_FOUND' };
  const trimmed = fileName.trim().replace(/[\\/]/g, '_').slice(0, 200);
  if (trimmed.length === 0) return { ok: false, error: 'INVALID_NAME' };
  const id = randomUUID();
  db.insert(t.attachments)
    .values({
      id,
      taskId,
      name: trimmed,
      url: `upload://${id}`,
      kind: 'FILE_UPLOAD',
      addedByUserId: actor.id,
      addedByLabel: actor.displayName,
      addedAt: new Date().toISOString(),
    })
    .run();
  return { ok: true, id };
}

export function removeAttachment(db: Db, attachmentId: string): MutationResult {
  const att = db.select().from(t.attachments).where(eq(t.attachments.id, attachmentId)).get();
  if (!att) return { ok: false, error: 'NOT_FOUND' };
  const task = db.select().from(t.tasks).where(eq(t.tasks.id, att.taskId)).get();
  if (!task) return { ok: false, error: 'NOT_FOUND' };
  const ref: ListRef = task.cityId ? { cityId: task.cityId } : { phaseId: task.phaseId! };
  const flags = loadFlags(db, ref);
  if (!flags || isEditLocked(flags) || isRefGated(db, ref))
    return { ok: false, error: flags ? 'LOCKED' : 'NOT_FOUND' };
  db.delete(t.attachments).where(eq(t.attachments.id, attachmentId)).run();
  return { ok: true };
}

// ── Structure edits (Kotlin v0.9 admin mode + add city/project) ─────────────
//
// Kotlin gates these in the UI only (adminMode is owner-only state); here the
// actor is resolved from the DB and every rule runs in the main process. The
// Kotlin delete-custom-row lock bypass (TaskRow.kt:124) is fixed, not ported.

type ActorRow = typeof t.users.$inferSelect;

function loadActiveActor(db: Db, actorUserId: string): ActorRow | undefined {
  const row = db.select().from(t.users).where(eq(t.users.id, actorUserId)).get();
  return row && row.status === 'ACTIVE' ? row : undefined;
}

/** Kotlin `+ Stad` (DashboardView.kt): owner-only; duplicate names rejected. */
export function createCity(
  db: Db,
  templates: PhaseTemplate[],
  name: string,
  actorUserId: string,
): MutationResult {
  const actor = loadActiveActor(db, actorUserId);
  if (!actor) return { ok: false, error: 'NOT_FOUND' };
  if (actor.role !== 'OWNER') return { ok: false, error: 'NOT_OWNER' };
  const trimmed = name.trim();
  if (trimmed.length === 0) return { ok: false, error: 'INVALID_NAME' };
  if (db.select().from(t.cities).where(eq(t.cities.name, trimmed)).get())
    return { ok: false, error: 'DUPLICATE' };
  const position =
    (db.select().from(t.cities).all().reduce((m, c) => Math.max(m, c.position), -1) ?? -1) + 1;
  let id = '';
  db.transaction(() => {
    id = seedAddCity(db, templates, trimmed, position);
  });
  return { ok: true, id };
}

/**
 * Kotlin `+ Project` (CityDetailView.kt): any signed-in user who can open the
 * city page; project names are globally unique (Kotlin AppState.addProject).
 */
export function createProject(
  db: Db,
  templates: PhaseTemplate[],
  name: string,
  cityId: string,
  actorUserId: string,
): MutationResult {
  const actor = loadActiveActor(db, actorUserId);
  if (!actor) return { ok: false, error: 'NOT_FOUND' };
  const city = db.select().from(t.cities).where(eq(t.cities.id, cityId)).get();
  if (!city) return { ok: false, error: 'NOT_FOUND' };
  if (actor.role !== 'OWNER' && !actor.accessAllCities) {
    const hasCity = db
      .select()
      .from(t.userCityAccess)
      .where(and(eq(t.userCityAccess.userId, actor.id), eq(t.userCityAccess.cityId, cityId)))
      .get();
    const hasProjectUnderCity = db
      .select({ id: t.userProjectAccess.projectId })
      .from(t.userProjectAccess)
      .innerJoin(t.projects, eq(t.userProjectAccess.projectId, t.projects.id))
      .where(and(eq(t.userProjectAccess.userId, actor.id), eq(t.projects.cityId, cityId)))
      .get();
    if (!hasCity && !hasProjectUnderCity) return { ok: false, error: 'NO_ACCESS' };
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) return { ok: false, error: 'INVALID_NAME' };
  if (db.select().from(t.projects).where(eq(t.projects.name, trimmed)).get())
    return { ok: false, error: 'DUPLICATE' };
  const position =
    (db.select().from(t.projects).all().reduce((m, p) => Math.max(m, p.position), -1) ?? -1) + 1;
  let id = '';
  db.transaction(() => {
    id = seedAddProject(db, templates, trimmed, cityId, position);
  });
  return { ok: true, id };
}

/** `"step||blok"` → parts (Kotlin Task.custom blokKey parsing). */
function splitBlokKey(key: string): { step: string; blok: string } {
  const idx = key.indexOf('||');
  return idx < 0 ? { step: '', blok: key } : { step: key.slice(0, idx), blok: key.slice(idx + 2) };
}

/**
 * Kotlin `+ Regel toevoegen` (TaskListView.promptAddRow): owner/admin only,
 * never on a locked list; the row lands at the bottom of its blok group with
 * empty RASCI and `custom = true`.
 */
export function addCustomRow(
  db: Db,
  ref: ListRef,
  blokKeyStr: string,
  deliverable: string,
  actorUserId: string,
): MutationResult {
  // Ernest: any active user may add rows (was owner-only). Lock + phase gate
  // still apply; web routes additionally require access to the list.
  const actor = loadActiveActor(db, actorUserId);
  if (!actor) return { ok: false, error: 'NOT_FOUND' };
  const flags = loadFlags(db, ref);
  if (!flags) return { ok: false, error: 'NOT_FOUND' };
  if (isEditLocked(flags) || isRefGated(db, ref)) return { ok: false, error: 'LOCKED' };
  const trimmed = deliverable.trim();
  if (trimmed.length === 0) return { ok: false, error: 'INVALID_NAME' };

  const { step, blok } = splitBlokKey(blokKeyStr);
  const id = randomUUID();
  db.transaction(() => {
    const rows = listTasks(db, ref);
    let insertAt = rows.length;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (`${rows[i]!.step}||${rows[i]!.blok}` === blokKeyStr) {
        insertAt = i + 1;
        break;
      }
    }
    // Renumber the WHOLE list densely (stored positions may carry gaps from
    // deletes or WIP moves; array indices are the truth, like Kotlin's List.add).
    rows.forEach((row, i) => {
      const position = i < insertAt ? i : i + 1;
      if (row.position !== position)
        db.update(t.tasks).set({ position }).where(eq(t.tasks.id, row.id)).run();
    });
    db.insert(t.tasks)
      .values({
        id,
        cityId: 'cityId' in ref ? ref.cityId : null,
        phaseId: 'phaseId' in ref ? ref.phaseId : null,
        position: insertAt,
        step,
        blok,
        deliverable: trimmed,
        r: '',
        a: '',
        s: '',
        c: '',
        iCol: '',
        opm: '',
        linkHint: '',
        status: 'OPEN',
        isCustom: true,
      })
      .run();
  });
  return { ok: true, id };
}

/**
 * Kotlin TaskRow.deleteCustom — with the lock enforced (the Kotlin 🗑 button
 * skipped the `!locked` check, letting admins mutate submitted/approved lists).
 * Attachments go with the row via the FK cascade.
 */
export function deleteCustomRow(db: Db, taskId: string, actorUserId: string): MutationResult {
  const actor = loadActiveActor(db, actorUserId);
  if (!actor) return { ok: false, error: 'NOT_FOUND' };
  if (actor.role !== 'OWNER') return { ok: false, error: 'NOT_OWNER' };
  const task = db.select().from(t.tasks).where(eq(t.tasks.id, taskId)).get();
  if (!task) return { ok: false, error: 'NOT_FOUND' };
  if (!task.isCustom) return { ok: false, error: 'NOT_CUSTOM' };
  const ref: ListRef = task.cityId ? { cityId: task.cityId } : { phaseId: task.phaseId! };
  const flags = loadFlags(db, ref);
  if (!flags) return { ok: false, error: 'NOT_FOUND' };
  if (isEditLocked(flags) || isRefGated(db, ref)) return { ok: false, error: 'LOCKED' };
  db.transaction(() => {
    db.delete(t.tasks).where(eq(t.tasks.id, taskId)).run();
    compactPositions(db, ref);
  });
  return { ok: true };
}

/**
 * Kotlin TaskListView.moveBlok: swap two adjacent blok groups, then rebuild the
 * list grouped-by-key — non-contiguous runs of the same key merge permanently
 * (documented Kotlin behaviour, kept).
 */
export function moveBlok(
  db: Db,
  ref: ListRef,
  blokKeyStr: string,
  dir: -1 | 1,
  actorUserId: string,
): MutationResult {
  const actor = loadActiveActor(db, actorUserId);
  if (!actor) return { ok: false, error: 'NOT_FOUND' };
  if (actor.role !== 'OWNER') return { ok: false, error: 'NOT_OWNER' };
  const flags = loadFlags(db, ref);
  if (!flags) return { ok: false, error: 'NOT_FOUND' };
  if (isEditLocked(flags) || isRefGated(db, ref)) return { ok: false, error: 'LOCKED' };

  let result: MutationResult = { ok: true };
  db.transaction(() => {
    const rows = listTasks(db, ref);
    const key = (row: (typeof rows)[number]): string => `${row.step}||${row.blok}`;
    const order: string[] = [];
    for (const row of rows) if (!order.includes(key(row))) order.push(key(row));
    const idx = order.indexOf(blokKeyStr);
    const ni = idx + dir;
    if (idx < 0 || ni < 0 || ni >= order.length) {
      result = { ok: false, error: 'INVALID_CHOICE' };
      return;
    }
    [order[idx], order[ni]] = [order[ni]!, order[idx]!];
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      const k = key(row);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(row);
    }
    order
      .flatMap((k) => groups.get(k) ?? [])
      .forEach((row, position) => {
        db.update(t.tasks).set({ position }).where(eq(t.tasks.id, row.id)).run();
      });
  });
  return result;
}

/** Kotlin TaskRow.moveTask: swap with the neighbour; tasks never leave their blok. */
export function moveTask(
  db: Db,
  taskId: string,
  dir: -1 | 1,
  actorUserId: string,
): MutationResult {
  const actor = loadActiveActor(db, actorUserId);
  if (!actor) return { ok: false, error: 'NOT_FOUND' };
  if (actor.role !== 'OWNER') return { ok: false, error: 'NOT_OWNER' };
  const task = db.select().from(t.tasks).where(eq(t.tasks.id, taskId)).get();
  if (!task) return { ok: false, error: 'NOT_FOUND' };
  const ref: ListRef = task.cityId ? { cityId: task.cityId } : { phaseId: task.phaseId! };
  const flags = loadFlags(db, ref);
  if (!flags) return { ok: false, error: 'NOT_FOUND' };
  if (isEditLocked(flags) || isRefGated(db, ref)) return { ok: false, error: 'LOCKED' };

  let result: MutationResult = { ok: true };
  db.transaction(() => {
    const rows = listTasks(db, ref);
    const idx = rows.findIndex((row) => row.id === taskId);
    const ni = idx + dir;
    if (ni < 0 || ni >= rows.length) {
      result = { ok: false, error: 'INVALID_CHOICE' };
      return;
    }
    const a = rows[idx]!;
    const b = rows[ni]!;
    if (`${a.step}||${a.blok}` !== `${b.step}||${b.blok}`) {
      result = { ok: false, error: 'INVALID_CHOICE' };
      return;
    }
    db.update(t.tasks).set({ position: b.position }).where(eq(t.tasks.id, a.id)).run();
    db.update(t.tasks).set({ position: a.position }).where(eq(t.tasks.id, b.id)).run();
  });
  return result;
}
