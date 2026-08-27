import { eq } from 'drizzle-orm';
import type { User } from '@shared/types';
import { accessibleProjects, userCanAccessCity } from '@shared/business-logic';
import type { Db } from '../desktop/main/db/client';
import * as t from '../desktop/main/db/schema';
import { getWorld, type World } from '../desktop/main/db/queries';
import type { ListRef } from '../desktop/main/db/mutations';

/**
 * Server-side access enforcement — the piece the desktop app scopes in the
 * renderer (documented trust model). Every mutating route resolves its target
 * to a ListRef and asserts the session user may touch that city/project before
 * the shared mutation guards run.
 */

/** The world snapshot scoped to what this user may see (same shared rules the renderer uses). */
export function worldFor(db: Db, user: User): World {
  const world = getWorld(db);
  return {
    cities: world.cities.filter((c) => userCanAccessCity(user, c.id, world.projects)),
    projects: accessibleProjects(user, world.projects),
  };
}

function canTouchCity(db: Db, user: User, cityId: string): boolean {
  if (user.role === 'OWNER' || user.accessAllCities) return true;
  if (user.cityAccess.includes(cityId)) return true;
  if (user.projectAccess.length === 0) return false;
  const projects = db
    .select({ id: t.projects.id })
    .from(t.projects)
    .where(eq(t.projects.cityId, cityId))
    .all();
  return projects.some((p) => user.projectAccess.includes(p.id));
}

export function canTouchRef(db: Db, user: User, ref: ListRef): boolean {
  if ('cityId' in ref) return canTouchCity(db, user, ref.cityId);
  const phase = db.select().from(t.phases).where(eq(t.phases.id, ref.phaseId)).get();
  if (!phase) return false;
  const project = db.select().from(t.projects).where(eq(t.projects.id, phase.projectId)).get();
  if (!project) return false;
  if (user.role === 'OWNER' || user.accessAllCities) return true;
  return user.projectAccess.includes(project.id) || user.cityAccess.includes(project.cityId);
}

export function refForTask(db: Db, taskId: string): ListRef | undefined {
  const task = db.select().from(t.tasks).where(eq(t.tasks.id, taskId)).get();
  if (!task) return undefined;
  return task.cityId ? { cityId: task.cityId } : { phaseId: task.phaseId! };
}

export function refForAttachment(db: Db, attachmentId: string): ListRef | undefined {
  const att = db.select().from(t.attachments).where(eq(t.attachments.id, attachmentId)).get();
  return att ? refForTask(db, att.taskId) : undefined;
}
