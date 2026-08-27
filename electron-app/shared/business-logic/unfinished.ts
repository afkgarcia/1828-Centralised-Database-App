import type { Task } from '../types';

/** Placeholder headline for tasks carried into the next phase. Final title pending from Ernest. */
export const WIP_STEP = 'WIP';

export interface MarkNaResult {
  tasks: Task[];
  changedIds: string[];
}

/** "Mark as not applicable" choice: every OPEN task becomes NA. Pure — returns new task objects. */
export function markOpenTasksNa(tasks: Task[]): MarkNaResult {
  const changedIds: string[] = [];
  const next = tasks.map((t) => {
    if (t.status !== 'OPEN') return t;
    changedIds.push(t.id);
    return { ...t, status: 'NA' as const };
  });
  return { tasks: next, changedIds };
}

export interface MoveResult {
  current: Task[];
  next: Task[];
  movedIds: string[];
}

/**
 * "Move to next phase (WIP)" choice: OPEN tasks leave the current list and are
 * PREPENDED to the next phase under the WIP headline (step = WIP, blok = ''),
 * keeping status, RASCI tags and attachments. (Kotlin `moveOpenTasksToNextPhase`.)
 * `next === null` means there is no next phase (last phase, or a city list):
 * the move is a no-op, enforced here rather than left to the caller.
 */
export function moveOpenTasksToNext(current: Task[], next: Task[] | null): MoveResult {
  if (next === null) return { current, next: [], movedIds: [] };
  const moving = current.filter((t) => t.status === 'OPEN');
  if (moving.length === 0) return { current, next, movedIds: [] };
  const stayed = current.filter((t) => t.status !== 'OPEN');
  const moved = moving.map((t) => ({ ...t, step: WIP_STEP, blok: '' }));
  return {
    current: stayed,
    next: [...moved, ...next],
    movedIds: moved.map((t) => t.id),
  };
}
