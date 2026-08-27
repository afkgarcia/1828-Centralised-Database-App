import type { RoleFilter, Task } from '../types';
import { relevantTasks } from './rasci';

/**
 * Progress = done / applicable, where N/A drops out of the denominator.
 * Empty applicable set ⇒ 1.0 (Kotlin parity: "nothing applicable = complete").
 * Worked example from the client brief: 5/20 N/A and 12 of the remaining 15 done ⇒ 0.8.
 */
export function progressOf(tasks: Task[], filter: RoleFilter): number {
  const rel = relevantTasks(tasks, filter);
  const applicable = rel.filter((t) => t.status !== 'NA');
  if (applicable.length === 0) return 1.0;
  return applicable.filter((t) => t.status === 'DONE').length / applicable.length;
}

export function openTasks(tasks: Task[]): Task[] {
  return tasks.filter((t) => t.status === 'OPEN');
}

/**
 * Readiness for submission.
 *
 * MIGRATION_NOTES §3 — intentional behavior difference from Kotlin: the Kotlin app
 * had two disagreeing definitions (role-filtered `isPhaseReady` for banner styling
 * vs full-list open count for the submit dialog). The port standardizes on the
 * stricter full-list definition, which is what submission actually gates on:
 * ready ⇔ the list is non-empty and contains no OPEN task, regardless of role filter.
 */
export function isReadyForSubmission(tasks: Task[]): boolean {
  if (tasks.length === 0) return false;
  return openTasks(tasks).length === 0;
}

/** Kotlin `AppState.openTaskCount`: open tasks across every visible list, role-filtered. */
export function openTaskCountAcross(taskLists: Task[][], filter: RoleFilter): number {
  return taskLists.reduce(
    (sum, tasks) => sum + relevantTasks(tasks, filter).filter((t) => t.status === 'OPEN').length,
    0,
  );
}
