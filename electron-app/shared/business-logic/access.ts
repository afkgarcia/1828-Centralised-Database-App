import type { Project, User } from '../types';

/** Minimal project shape access checks need (avoids requiring loaded phases). */
export type ProjectRef = Pick<Project, 'id' | 'cityId'>;

export function isOwner(user: Pick<User, 'role'> | null | undefined): boolean {
  return user?.role === 'OWNER';
}

/** Only the owner approves phases, cities and signups (Kotlin parity). */
export function isApprover(user: Pick<User, 'role'> | null | undefined): boolean {
  return isOwner(user);
}

export function userCanAccessProject(user: User, project: ProjectRef): boolean {
  if (user.accessAllCities || user.role === 'OWNER') return true;
  if (user.cityAccess.includes(project.cityId)) return true;
  return user.projectAccess.includes(project.id);
}

/**
 * City visible iff blanket access, direct grant, or the user holds a project grant
 * under that city (a project grant makes the parent city visible — Kotlin parity).
 */
export function userCanAccessCity(user: User, cityId: string, allProjects: ProjectRef[]): boolean {
  if (user.accessAllCities || user.role === 'OWNER') return true;
  if (user.cityAccess.includes(cityId)) return true;
  return allProjects.some((p) => p.cityId === cityId && user.projectAccess.includes(p.id));
}

export function accessibleCityIds(
  user: User,
  cityIdsInOrder: string[],
  allProjects: ProjectRef[],
): string[] {
  return cityIdsInOrder.filter((id) => userCanAccessCity(user, id, allProjects));
}

export function accessibleProjects<P extends ProjectRef>(user: User, projects: P[]): P[] {
  return projects.filter((p) => userCanAccessProject(user, p));
}

/** Kotlin `projectsForCity`: the city's projects the user may see, order preserved. */
export function projectsForCity<P extends ProjectRef>(
  user: User,
  cityId: string,
  projects: P[],
): P[] {
  return projects.filter((p) => p.cityId === cityId && userCanAccessProject(user, p));
}
