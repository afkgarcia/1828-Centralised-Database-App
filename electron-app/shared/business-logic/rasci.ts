import type { RoleFilter, Task, UserRole } from '../types';

/**
 * RASCI role matching.
 *
 * The Kotlin app matched roles by substring (`cell.contains(role)`), which made the
 * "PM" filter match every "PPM" cell (36 tasks affected). Fixed here by tokenizing
 * cells on the separators that actually occur in the phase document data:
 * "MT/PO", "PO/MT", "MT, PO", "DENISE + PO".
 */
export function tokenizeRasciCell(cell: string): string[] {
  return cell
    .split(/[/,+&\s]+/)
    .map((t) => t.trim().toUpperCase())
    .filter((t) => t.length > 0);
}

/** True when the role appears as a whole token in any of r/a/s/c (i is informed-only, excluded — Kotlin parity). */
export function isTaskRelevantToRole(task: Task, role: UserRole): boolean {
  return [task.r, task.a, task.s, task.c].some((cell) => tokenizeRasciCell(cell).includes(role));
}

/** Kotlin `AppState.relevantTasks`: 'all' returns everything. */
export function relevantTasks<T extends Task>(tasks: T[], filter: RoleFilter): T[] {
  if (filter === 'all') return tasks;
  return tasks.filter((t) => isTaskRelevantToRole(t, filter));
}

/**
 * Kotlin `User.rasciFilterKey`: the default filter chip for an account.
 * OWNER maps to 'all' — no RASCI cell ever contains an OWNER token, so filtering
 * by the literal role would show an owner zero tasks (the exact inversion).
 */
export function roleToFilter(role: UserRole): RoleFilter {
  return role === 'OWNER' ? 'all' : role;
}
