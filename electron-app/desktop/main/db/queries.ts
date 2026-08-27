import type { Attachment, City, Phase, Project, Task } from '@shared/types';
import type { Db } from './client';
import * as t from './schema';

export interface World {
  cities: City[];
  projects: Project[];
}

/**
 * Assembles the full hierarchy in shared-type shape for the renderer.
 * The dataset is small (~1k tasks), so one snapshot per navigation keeps the
 * renderer backend-agnostic — the web version swaps this for API calls.
 */
export function getWorld(db: Db): World {
  const cityRows = db.select().from(t.cities).orderBy(t.cities.position).all();
  const projectRows = db.select().from(t.projects).orderBy(t.projects.position).all();
  const phaseRows = db.select().from(t.phases).orderBy(t.phases.idx).all();
  const taskRows = db.select().from(t.tasks).orderBy(t.tasks.position).all();
  const attRows = db.select().from(t.attachments).all();

  const attachmentsByTask = new Map<string, Attachment[]>();
  for (const a of attRows) {
    const list = attachmentsByTask.get(a.taskId) ?? [];
    list.push({
      id: a.id,
      name: a.name,
      url: a.url,
      kind: a.kind,
      addedByUserId: a.addedByUserId,
      addedByLabel: a.addedByLabel,
      addedAt: a.addedAt,
    });
    attachmentsByTask.set(a.taskId, list);
  }

  const toTask = (row: (typeof taskRows)[number]): Task => ({
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
    attachments: attachmentsByTask.get(row.id) ?? [],
    custom: row.isCustom,
    movedFromPhaseId: row.movedFromPhaseId,
  });

  const tasksByCity = new Map<string, Task[]>();
  const tasksByPhase = new Map<string, Task[]>();
  for (const row of taskRows) {
    const task = toTask(row);
    if (row.cityId) {
      const list = tasksByCity.get(row.cityId) ?? [];
      list.push(task);
      tasksByCity.set(row.cityId, list);
    } else if (row.phaseId) {
      const list = tasksByPhase.get(row.phaseId) ?? [];
      list.push(task);
      tasksByPhase.set(row.phaseId, list);
    }
  }

  const phasesByProject = new Map<string, Phase[]>();
  for (const row of phaseRows) {
    const list = phasesByProject.get(row.projectId) ?? [];
    list.push({
      id: row.id,
      idx: row.idx,
      sheet: row.sheet,
      submitted: row.submitted,
      approved: row.approved,
      tasks: tasksByPhase.get(row.id) ?? [],
    });
    phasesByProject.set(row.projectId, list);
  }

  const cities: City[] = cityRows.map((c) => ({
    id: c.id,
    name: c.name,
    submitted: c.submitted,
    approved: c.approved,
    tasks: tasksByCity.get(c.id) ?? [],
  }));

  const projects: Project[] = projectRows.map((p) => ({
    id: p.id,
    name: p.name,
    cityId: p.cityId,
    phases: phasesByProject.get(p.id) ?? [],
  }));

  return { cities, projects };
}
