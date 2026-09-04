import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import type { User, UserRole } from '@shared/types';
import {
  changePasswordOutcome,
  defaultDisplayName,
  generateResetCode,
  loginOutcome,
  normalizeEmail,
  resetOutcome,
  signupOutcome,
  type ChangePasswordOutcome,
  type LoginOutcome,
  type ResetOutcome,
  type SignupOutcome,
} from '@shared/business-logic';
import type { Db } from './db/client';
import { sendPasswordResetEmail } from './notify';
import * as t from './db/schema';

/**
 * Auth over the local database. Decision logic lives in @shared (the web backend
 * reuses it); this module supplies bcrypt, persistence and the reset-code store.
 * Reset codes are persisted and NEVER returned to callers (MIGRATION_NOTES §1.7.8).
 */

export type LoginResult = { outcome: Exclude<LoginOutcome, 'OK'> } | { outcome: 'OK'; user: User };

function toSafeUser(db: Db, row: typeof t.users.$inferSelect): User {
  const cityGrants = db
    .select()
    .from(t.userCityAccess)
    .where(eq(t.userCityAccess.userId, row.id))
    .all();
  const projectGrants = db
    .select()
    .from(t.userProjectAccess)
    .where(eq(t.userProjectAccess.userId, row.id))
    .all();
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    status: row.status,
    accessAllCities: row.accessAllCities,
    cityAccess: cityGrants.map((g) => g.cityId),
    projectAccess: projectGrants.map((g) => g.projectId),
  };
}

function findByEmail(db: Db, email: string): typeof t.users.$inferSelect | undefined {
  return db.select().from(t.users).where(eq(t.users.email, normalizeEmail(email))).get();
}

/**
 * First-boot owner creation. A fresh production install has no users and no way
 * to mint an OWNER through the UI (signup is PENDING + never owner, approval
 * needs an existing owner). Reads BOOTSTRAP_OWNER_EMAIL / BOOTSTRAP_OWNER_PASSWORD
 * (+ optional BOOTSTRAP_OWNER_NAME) and creates one ACTIVE owner iff the users
 * table is empty. Callers log the outcome.
 */
export function bootstrapOwner(db: Db): 'created' | 'not-empty' | 'no-env' {
  const existing = db.select({ id: t.users.id }).from(t.users).limit(1).get();
  if (existing) return 'not-empty';
  const email = process.env['BOOTSTRAP_OWNER_EMAIL']?.trim();
  const password = process.env['BOOTSTRAP_OWNER_PASSWORD'];
  if (!email || !password) return 'no-env';
  db.insert(t.users)
    .values({
      id: randomUUID(),
      email: normalizeEmail(email),
      passwordHash: bcrypt.hashSync(password, 10),
      displayName: defaultDisplayName(process.env['BOOTSTRAP_OWNER_NAME'], email),
      role: 'OWNER',
      status: 'ACTIVE',
      accessAllCities: true,
      createdAt: new Date().toISOString(),
    })
    .run();
  return 'created';
}

/** Session-resolved user with fresh grants (web server: the actor is never taken
 *  from the wire, so every request re-reads the DTO by session user id). */
export function getSafeUser(db: Db, userId: string): User | undefined {
  const row = db.select().from(t.users).where(eq(t.users.id, userId)).get();
  return row && row.status === 'ACTIVE' ? toSafeUser(db, row) : undefined;
}

/** Burns the same bcrypt work for unknown emails — no timing oracle on login. */
const TIMING_EQUALIZER_HASH = '$2a$10$/7oausqHkDj7mU7luTpMk..sxNVWLmuAaYKWc2zUfOWIocsOMbgTa';

export function login(db: Db, email: string, password: string): LoginResult {
  const row = findByEmail(db, email);
  const matches = row
    ? bcrypt.compareSync(password, row.passwordHash)
    : (bcrypt.compareSync(password, TIMING_EQUALIZER_HASH), false);
  const outcome = loginOutcome(row, matches);
  if (outcome !== 'OK') return { outcome };
  return { outcome, user: toSafeUser(db, row!) };
}

export function signup(
  db: Db,
  email: string,
  password: string,
  displayName: string,
  requestedRole: UserRole,
): SignupOutcome {
  const exists = findByEmail(db, email) !== undefined;
  const outcome = signupOutcome(email, password, exists);
  if (outcome !== 'OK') return outcome;
  // OWNER cannot be self-requested; downgrade silently to PM (UI never offers it).
  const role: UserRole = requestedRole === 'OWNER' ? 'PM' : requestedRole;
  db.insert(t.users)
    .values({
      id: randomUUID(),
      email: normalizeEmail(email),
      passwordHash: bcrypt.hashSync(password, 10),
      displayName: defaultDisplayName(displayName, email),
      role,
      status: 'PENDING',
      accessAllCities: false,
      createdAt: new Date().toISOString(),
    })
    .run();
  return outcome;
}

/**
 * Generates + stores a reset code and records the notification email in the
 * outbox table (delivery/.eml/SMTP arrive with feature 6). Returns whether the
 * account exists — never the code.
 */
export function requestPasswordReset(db: Db, email: string): boolean {
  const row = findByEmail(db, email);
  if (!row) return false;
  const code = generateResetCode();
  db.transaction(() => {
    db.delete(t.passwordResetCodes).where(eq(t.passwordResetCodes.userId, row.id)).run();
    db.insert(t.passwordResetCodes)
      .values({ userId: row.id, code, createdAt: new Date().toISOString() })
      .run();
  });
  // Recorded in the outbox AND actually delivered (.eml + SMTP when configured).
  sendPasswordResetEmail(db, row.email, code);
  return true;
}

export function completePasswordReset(
  db: Db,
  email: string,
  code: string,
  newPassword: string,
): ResetOutcome {
  const row = findByEmail(db, email);
  const stored = row
    ? (db
        .select()
        .from(t.passwordResetCodes)
        .where(eq(t.passwordResetCodes.userId, row.id))
        .get()?.code ?? null)
    : null;
  const outcome = resetOutcome(row !== undefined, stored, code, newPassword);
  if (outcome !== 'OK') return outcome;
  db.transaction(() => {
    db.update(t.users)
      .set({ passwordHash: bcrypt.hashSync(newPassword, 10) })
      .where(eq(t.users.id, row!.id))
      .run();
    // Single-use: consume the code
    db.delete(t.passwordResetCodes).where(eq(t.passwordResetCodes.userId, row!.id)).run();
  });
  return outcome;
}

export function changePassword(
  db: Db,
  email: string,
  currentPassword: string,
  newPassword: string,
): ChangePasswordOutcome {
  const row = findByEmail(db, email);
  const matches = row ? bcrypt.compareSync(currentPassword, row.passwordHash) : false;
  const outcome = changePasswordOutcome(matches, newPassword);
  if (outcome !== 'OK') return outcome;
  db.update(t.users)
    .set({ passwordHash: bcrypt.hashSync(newPassword, 10) })
    .where(eq(t.users.id, row!.id))
    .run();
  return outcome;
}
