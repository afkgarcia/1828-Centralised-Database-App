import type { Project, Task } from '../types';

/**
 * The reviewer's row-by-row view of a submitted list (Ernest's approval
 * screen): completed rows, N.v.t. rows, and — for project phases — the rows a
 * submit-with-move carried out to the next phase (they sit there under WIP,
 * tagged with the phase they left via movedFromPhaseId).
 */
export function movedOutTasks(project: Project, phaseId: string): Task[] {
  return project.phases
    .flatMap((phase) => phase.tasks)
    .filter((task) => task.movedFromPhaseId === phaseId);
}
