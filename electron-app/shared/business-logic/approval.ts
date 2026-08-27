import type { ApprovalFlags, Task, User } from '../types';
import { isApprover } from './access';
import { openTasks } from './progress';

/**
 * Approval lifecycle shared by project phases and city Gemeenteontwikkeling:
 * open → submitted (frozen) → approved (frozen, next unlocks) with reject/withdraw/reopen.
 */

/**
 * Phase unlock rule with the city gate: phase 0 (Acquisitiefase) unlocks only when
 * the parent city's Gemeenteontwikkeling is approved; phase i>0 unlocks when the
 * previous phase is approved. (Kotlin `AppState.isPhaseUnlocked`.)
 */
export function isPhaseUnlocked(
  phaseIdx: number,
  phases: ApprovalFlags[],
  cityApproved: boolean,
): boolean {
  if (phaseIdx === 0) return cityApproved;
  return phases[phaseIdx - 1]?.approved === true;
}

/** Submitted or approved lists are frozen: no task edits, no custom-row deletion.
 *  (Enforced here, not in the UI — closes the Kotlin custom-row-delete-bypass bug.) */
export function isEditLocked(flags: ApprovalFlags): boolean {
  return flags.submitted || flags.approved;
}

export type TransitionError =
  | 'ALREADY_SUBMITTED'
  | 'ALREADY_APPROVED'
  | 'NOT_SUBMITTED'
  | 'NOT_APPROVED'
  | 'NOT_APPROVER'
  | 'LOCKED';

export type TransitionResult =
  | { ok: true; flags: ApprovalFlags }
  | { ok: false; error: TransitionError };

/** Submit is always available on an unlocked, unfrozen list (the unfinished-task
 *  choice is a separate concern — see unfinished.ts). */
export function submit(flags: ApprovalFlags): TransitionResult {
  if (flags.approved) return { ok: false, error: 'ALREADY_APPROVED' };
  if (flags.submitted) return { ok: false, error: 'ALREADY_SUBMITTED' };
  return { ok: true, flags: { submitted: true, approved: false } };
}

export function withdraw(flags: ApprovalFlags): TransitionResult {
  if (!flags.submitted) return { ok: false, error: 'NOT_SUBMITTED' };
  return { ok: true, flags: { submitted: false, approved: false } };
}

export function approve(flags: ApprovalFlags, actor: Pick<User, 'role'>): TransitionResult {
  if (!isApprover(actor)) return { ok: false, error: 'NOT_APPROVER' };
  if (!flags.submitted) return { ok: false, error: 'NOT_SUBMITTED' };
  return { ok: true, flags: { submitted: false, approved: true } };
}

export function reject(flags: ApprovalFlags, actor: Pick<User, 'role'>): TransitionResult {
  if (!isApprover(actor)) return { ok: false, error: 'NOT_APPROVER' };
  if (!flags.submitted) return { ok: false, error: 'NOT_SUBMITTED' };
  return { ok: true, flags: { submitted: false, approved: false } };
}

export function reopen(flags: ApprovalFlags, actor: Pick<User, 'role'>): TransitionResult {
  if (!isApprover(actor)) return { ok: false, error: 'NOT_APPROVER' };
  if (!flags.approved) return { ok: false, error: 'NOT_APPROVED' };
  return { ok: true, flags: { submitted: false, approved: false } };
}

/** Task mutations (status, links, custom rows) are only legal on unfrozen lists. */
export function canEditTasks(flags: ApprovalFlags): boolean {
  return !isEditLocked(flags);
}

/** Guard used by the submit UI: how many open tasks the unfinished-task dialog covers. */
export function openCountForSubmit(tasks: Task[]): number {
  return openTasks(tasks).length;
}

/** Kotlin `pendingCitySubmissions`: submitted-and-not-approved, input order preserved. */
export function pendingCitySubmissions<C extends ApprovalFlags>(cities: C[]): C[] {
  return cities.filter((c) => c.submitted && !c.approved);
}

export interface PendingPhase<P extends { phases: readonly ApprovalFlags[] }> {
  project: P;
  phaseIdx: number;
  phase: P['phases'][number];
}

/** Kotlin `pendingPhaseSubmissions`: (project, phaseIdx, phase) triples in project
 *  order, ascending phase index — feeds the owner's Approvals inbox. */
export function pendingPhaseSubmissions<P extends { phases: readonly ApprovalFlags[] }>(
  projects: P[],
): PendingPhase<P>[] {
  const out: PendingPhase<P>[] = [];
  for (const project of projects) {
    project.phases.forEach((phase, phaseIdx) => {
      if (phase.submitted && !phase.approved) out.push({ project, phaseIdx, phase });
    });
  }
  return out;
}
