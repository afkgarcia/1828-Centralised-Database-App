import { and, eq } from 'drizzle-orm';
import type { User, UserRole } from '@shared/types';
import { isApprover, removeUserOutcome } from '@shared/business-logic';
import type { Db } from './db/client';
import * as s from './db/schema';
import { listSafeUsers } from './notify';

/**
 * Owner-only user management (Kotlin UserAdminView parity). Every function
 * resolves the ACTOR from the DB and refuses non-owners — never trusts the wire.
 */

export type AdminError =
  | 'NOT_FOUND'
  | 'NOT_APPROVER'
  | 'IS_OWNER'
  | 'IS_SELF';

export type AdminResult =
  | { ok: true; movedDocs?: number }
  | { ok: false; error: AdminError };

function requireOwner(db: Db, actorUserId: string): User | AdminResult {
  const actor = listSafeUsers(db).find((u) => u.id === actorUserId);
  if (!actor) return { ok: false, error: 'NOT_FOUND' };
  if (!isApprover(actor)) return { ok: false, error: 'NOT_APPROVER' };
  return actor;
}

export function listUsers(db: Db, actorUserId: string): User[] | AdminResult {
  const gate = requireOwner(db, actorUserId);
  if ('ok' in gate) return gate;
  return listSafeUsers(db);
}

export function setUserStatus(
  db: Db,
  actorUserId: string,
  targetUserId: string,
  status: 'ACTIVE' | 'REJECTED',
): AdminResult {
  const gate = requireOwner(db, actorUserId);
  if ('ok' in gate) return gate;
  const target = db.select().from(s.users).where(eq(s.users.id, targetUserId)).get();
  if (!target) return { ok: false, error: 'NOT_FOUND' };
  db.update(s.users).set({ status }).where(eq(s.users.id, targetUserId)).run();
  return { ok: true };
}

export function setUserRole(
  db: Db,
  actorUserId: string,
  targetUserId: string,
  role: UserRole,
): AdminResult {
  const gate = requireOwner(db, actorUserId);
  if ('ok' in gate) return gate;
  // The owner cannot demote themselves (Kotlin: self row disabled).
  if (targetUserId === actorUserId) return { ok: false, error: 'IS_SELF' };
  const target = db.select().from(s.users).where(eq(s.users.id, targetUserId)).get();
  if (!target) return { ok: false, error: 'NOT_FOUND' };
  db.update(s.users).set({ role }).where(eq(s.users.id, targetUserId)).run();
  return { ok: true };
}

export function setCityAccess(
  db: Db,
  actorUserId: string,
  targetUserId: string,
  cityId: string,
  granted: boolean,
): AdminResult {
  const gate = requireOwner(db, actorUserId);
  if ('ok' in gate) return gate;
  const target = db.select().from(s.users).where(eq(s.users.id, targetUserId)).get();
  if (!target) return { ok: false, error: 'NOT_FOUND' };
  if (granted) {
    db.insert(s.userCityAccess)
      .values({ userId: targetUserId, cityId })
      .onConflictDoNothing()
      .run();
  } else {
    db.delete(s.userCityAccess)
      .where(
        and(eq(s.userCityAccess.userId, targetUserId), eq(s.userCityAccess.cityId, cityId)),
      )
      .run();
  }
  return { ok: true };
}

export function setAccessAllCities(
  db: Db,
  actorUserId: string,
  targetUserId: string,
  value: boolean,
): AdminResult {
  const gate = requireOwner(db, actorUserId);
  if ('ok' in gate) return gate;
  const target = db.select().from(s.users).where(eq(s.users.id, targetUserId)).get();
  if (!target) return { ok: false, error: 'NOT_FOUND' };
  db.update(s.users).set({ accessAllCities: value }).where(eq(s.users.id, targetUserId)).run();
  return { ok: true };
}

/**
 * Remove a user and hand every document they linked over to the replacement
 * (Kotlin remove-user parity: never the owner, never yourself; the handover
 * count is reported back for the confirmation message).
 */
export function removeUser(
  db: Db,
  actorUserId: string,
  targetUserId: string,
  replacementUserId: string,
): AdminResult {
  const gate = requireOwner(db, actorUserId);
  if ('ok' in gate) return gate;
  const actor = gate;
  const target = db.select().from(s.users).where(eq(s.users.id, targetUserId)).get();
  const replacement = db
    .select()
    .from(s.users)
    .where(eq(s.users.id, replacementUserId))
    .get();
  if (!target || !replacement) return { ok: false, error: 'NOT_FOUND' };

  const outcome = removeUserOutcome(target, actor);
  if (outcome !== 'OK') return { ok: false, error: outcome };

  let movedDocs = 0;
  db.transaction(() => {
    const owned = db
      .select()
      .from(s.attachments)
      .where(eq(s.attachments.addedByUserId, targetUserId))
      .all();
    movedDocs = owned.length;
    db.update(s.attachments)
      .set({ addedByUserId: replacementUserId, addedByLabel: replacement.displayName })
      .where(eq(s.attachments.addedByUserId, targetUserId))
      .run();
    // Grants + reset codes cascade via FK; the account row goes last.
    db.delete(s.users).where(eq(s.users.id, targetUserId)).run();
  });
  return { ok: true, movedDocs };
}
