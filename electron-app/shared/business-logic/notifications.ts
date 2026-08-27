import type { NotifyEvent, User } from '../types';
import { type ProjectRef, userCanAccessCity, userCanAccessProject } from './access';

/**
 * Notification recipient rules (Kotlin `Notifications` parity):
 *  - deliverable submitted / approval requested → active owners
 *  - phase or city approved/rejected → active non-owner team with access, falling back to owners
 *  - password reset → the account itself only
 * Composition (subject/body text) resolves through i18n at the delivery layer;
 * this module only decides WHO gets WHAT event.
 */

function activeOwners(users: User[]): string[] {
  return users.filter((u) => u.role === 'OWNER' && u.status === 'ACTIVE').map((u) => u.email);
}

function projectTeam(users: User[], project: ProjectRef): string[] {
  return users
    .filter(
      (u) => u.status === 'ACTIVE' && u.role !== 'OWNER' && userCanAccessProject(u, project),
    )
    .map((u) => u.email);
}

function cityTeam(users: User[], cityId: string, allProjects: ProjectRef[]): string[] {
  return users
    .filter(
      (u) =>
        u.status === 'ACTIVE' && u.role !== 'OWNER' && userCanAccessCity(u, cityId, allProjects),
    )
    .map((u) => u.email);
}

export function recipientsForDeliverableSubmitted(users: User[]): string[] {
  return activeOwners(users);
}

export function recipientsForApprovalRequested(users: User[]): string[] {
  return activeOwners(users);
}

export function recipientsForPhaseDecision(users: User[], project: ProjectRef): string[] {
  const team = projectTeam(users, project);
  return team.length > 0 ? team : activeOwners(users);
}

export function recipientsForCityDecision(
  users: User[],
  cityId: string,
  allProjects: ProjectRef[],
): string[] {
  const team = cityTeam(users, cityId, allProjects);
  return team.length > 0 ? team : activeOwners(users);
}

export function recipientsForPasswordReset(accountEmail: string): string[] {
  return [accountEmail];
}

/**
 * Outbox visibility (Kotlin `EmailService.visibleTo`): the owner sees every
 * message; colleagues only see mail addressed to them. Storage is newest-first;
 * this selector preserves input order.
 */
export function visibleEmails<M extends { to: string[] }>(
  messages: M[],
  viewerEmail: string,
  viewerIsOwner: boolean,
): M[] {
  if (viewerIsOwner) return messages;
  return messages.filter((m) => m.to.includes(viewerEmail));
}

/** i18n subject key per event, matching the Kotlin string table. */
export function subjectKeyFor(event: NotifyEvent, opts: { city?: boolean; count?: number }): string {
  switch (event) {
    case 'DELIVERABLE_SUBMITTED':
      return (opts.count ?? 1) > 1 ? 'subjSubmittedN' : 'subjSubmitted1';
    case 'APPROVAL_REQUESTED':
      return opts.city ? 'subjCityApproval' : 'subjApproval';
    case 'PHASE_APPROVED':
      return opts.city ? 'subjCityApproved' : 'subjApproved';
    case 'PHASE_REJECTED':
      return opts.city ? 'subjCityRejected' : 'subjRejected';
    case 'PASSWORD_RESET':
      return 'subjReset';
  }
}
