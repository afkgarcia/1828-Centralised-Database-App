import type { Task, User, UserStatus } from '../types';

/**
 * Authentication decision logic. Hashing itself is injected by the host
 * (bcrypt in Electron main; the future web backend brings its own), so this
 * module stays dependency-free.
 */

export const MIN_PASSWORD_LENGTH = 4;

export type LoginOutcome = 'OK' | 'UNKNOWN_EMAIL' | 'BAD_PASSWORD' | 'PENDING' | 'REJECTED';

export function normalizeEmail(email: string): string {
  return email.toLowerCase().trim();
}

/** Kotlin `AuthService.login` decision order: unknown → bad password → status. */
export function loginOutcome(
  user: { status: UserStatus } | null | undefined,
  passwordMatches: boolean,
): LoginOutcome {
  if (!user) return 'UNKNOWN_EMAIL';
  if (!passwordMatches) return 'BAD_PASSWORD';
  switch (user.status) {
    case 'PENDING':
      return 'PENDING';
    case 'REJECTED':
      return 'REJECTED';
    case 'ACTIVE':
      return 'OK';
  }
}

/** Kotlin signup rule: trimmed name, or the email local-part when blank. */
export function defaultDisplayName(name: string | null | undefined, email: string): string {
  const trimmed = name?.trim() ?? '';
  if (trimmed.length > 0) return trimmed;
  return normalizeEmail(email).split('@')[0] ?? '';
}

/** 6-digit reset code (100000–999999). RNG injected so hosts/tests control entropy. */
export function generateResetCode(random: () => number = Math.random): string {
  return String(100000 + Math.floor(random() * 900000));
}

export type SignupOutcome = 'OK' | 'INVALID_EMAIL' | 'WEAK_PASSWORD' | 'ALREADY_EXISTS';

export function signupOutcome(
  email: string,
  password: string,
  emailAlreadyExists: boolean,
): SignupOutcome {
  const key = normalizeEmail(email);
  if (key.length === 0 || !key.includes('@')) return 'INVALID_EMAIL';
  if (password.length < MIN_PASSWORD_LENGTH) return 'WEAK_PASSWORD';
  if (emailAlreadyExists) return 'ALREADY_EXISTS';
  return 'OK';
}

export type ResetOutcome = 'OK' | 'UNKNOWN_EMAIL' | 'BAD_CODE' | 'WEAK_PASSWORD';

/** Kotlin decision order: unknown email → code check → password strength. Codes are single-use (caller clears on OK). */
export function resetOutcome(
  userExists: boolean,
  storedCode: string | null,
  givenCode: string,
  newPassword: string,
): ResetOutcome {
  if (!userExists) return 'UNKNOWN_EMAIL';
  if (storedCode === null || storedCode !== givenCode.trim()) return 'BAD_CODE';
  if (newPassword.length < MIN_PASSWORD_LENGTH) return 'WEAK_PASSWORD';
  return 'OK';
}

export type ChangePasswordOutcome = 'OK' | 'BAD_CURRENT' | 'WEAK_PASSWORD';

export function changePasswordOutcome(
  currentMatches: boolean,
  newPassword: string,
): ChangePasswordOutcome {
  if (!currentMatches) return 'BAD_CURRENT';
  if (newPassword.length < MIN_PASSWORD_LENGTH) return 'WEAK_PASSWORD';
  return 'OK';
}

export type RemoveUserOutcome = 'OK' | 'IS_OWNER' | 'IS_SELF';

/** Owners can never be removed (safety anchor); nor can you remove yourself. */
export function removeUserOutcome(
  target: Pick<User, 'id' | 'role'>,
  actor: Pick<User, 'id'>,
): RemoveUserOutcome {
  if (target.role === 'OWNER') return 'IS_OWNER';
  if (target.id === actor.id) return 'IS_SELF';
  return 'OK';
}

export interface ReassignResult {
  tasks: Task[];
  movedCount: number;
}

/**
 * Hands every document created by `fromUserId` over to the replacement.
 * Pure list transform over any task collection (city lists + all phase lists).
 */
export function reassignAttachments(
  tasks: Task[],
  fromUserId: string,
  toUserId: string,
  toLabel: string,
): ReassignResult {
  let movedCount = 0;
  const next = tasks.map((t) => {
    if (!t.attachments.some((a) => a.addedByUserId === fromUserId)) return t;
    return {
      ...t,
      attachments: t.attachments.map((a) => {
        if (a.addedByUserId !== fromUserId) return a;
        movedCount++;
        return { ...a, addedByUserId: toUserId, addedByLabel: toLabel };
      }),
    };
  });
  return { tasks: next, movedCount };
}
