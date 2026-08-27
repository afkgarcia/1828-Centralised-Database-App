import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import phasesJson from '../../../shared/data/phases.json';
import type { PhaseTemplate } from '@shared/types';
import { openDb, type Db } from '../db/client';
import { importTemplates, seedDemoData } from '../db/seed';
import * as schema from '../db/schema';
import {
  changePassword,
  completePasswordReset,
  login,
  requestPasswordReset,
  signup,
} from '../auth';

const templates = phasesJson as PhaseTemplate[];

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  importTemplates(db, templates);
  seedDemoData(db, templates);
});

describe('auth over the local DB (Kotlin AuthService parity)', () => {
  it('login outcomes: OK with safe user DTO, bad password, unknown, pending', () => {
    const ok = login(db, 'ernest@1828.nl', 'ernest');
    expect(ok.outcome).toBe('OK');
    if (ok.outcome === 'OK') {
      expect(ok.user.displayName).toBe('Ernest');
      expect(ok.user.role).toBe('OWNER');
      expect(ok.user.accessAllCities).toBe(true);
      expect('passwordHash' in ok.user).toBe(false);
    }

    const pia = login(db, 'PIA@1828.NL', 'test'); // email normalized
    expect(pia.outcome).toBe('OK');
    if (pia.outcome === 'OK') {
      expect(pia.user.cityAccess).toHaveLength(1); // Leiden grant resolved from DB
    }

    expect(login(db, 'ernest@1828.nl', 'wrong').outcome).toBe('BAD_PASSWORD');
    expect(login(db, 'ghost@1828.nl', 'x').outcome).toBe('UNKNOWN_EMAIL');
    expect(login(db, 'niels@1828.nl', 'test').outcome).toBe('PENDING');
  });

  it('signup creates a PENDING account with displayName fallback; duplicates rejected; OWNER not self-requestable', () => {
    expect(signup(db, 'nieuw@1828.nl', 'wachtwoord', '   ', 'PO')).toBe('OK');
    const row = db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, 'nieuw@1828.nl'))
      .get()!;
    expect(row.status).toBe('PENDING');
    expect(row.displayName).toBe('nieuw'); // email local-part fallback
    expect(row.role).toBe('PO');

    expect(signup(db, 'nieuw@1828.nl', 'x1234', 'X', 'PM')).toBe('ALREADY_EXISTS');
    expect(signup(db, 'bad', 'x1234', 'X', 'PM')).toBe('INVALID_EMAIL');
    expect(signup(db, 'ok@y.nl', 'abc', 'X', 'PM')).toBe('WEAK_PASSWORD');

    expect(signup(db, 'sneaky@1828.nl', 'x1234', 'Sneaky', 'OWNER')).toBe('OK');
    const sneaky = db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, 'sneaky@1828.nl'))
      .get()!;
    expect(sneaky.role).toBe('PM'); // silently downgraded
  });

  it('password reset: code persisted (never returned), outbox row recorded, single-use, new password works', () => {
    expect(requestPasswordReset(db, 'ghost@1828.nl')).toBe(false);
    const known = requestPasswordReset(db, 'pia@1828.nl');
    expect(known).toBe(true);

    const pia = db.select().from(schema.users).where(eq(schema.users.email, 'pia@1828.nl')).get()!;
    const stored = db
      .select()
      .from(schema.passwordResetCodes)
      .where(eq(schema.passwordResetCodes.userId, pia.id))
      .get()!;
    expect(stored.code).toMatch(/^\d{6}$/);

    // The notification landed in the outbox tables addressed to the account only
    const mails = db.select().from(schema.emails).all();
    expect(mails).toHaveLength(1);
    expect(mails[0]!.event).toBe('PASSWORD_RESET');
    expect(mails[0]!.body).toContain(stored.code);
    const rcpts = db.select().from(schema.emailRecipients).all();
    expect(rcpts.map((r) => r.recipient)).toEqual(['pia@1828.nl']);

    expect(completePasswordReset(db, 'pia@1828.nl', '000000', 'nieuw')).toBe('BAD_CODE');
    expect(completePasswordReset(db, 'pia@1828.nl', stored.code, 'abc')).toBe('WEAK_PASSWORD');
    expect(completePasswordReset(db, 'pia@1828.nl', stored.code, 'nieuw')).toBe('OK');

    expect(login(db, 'pia@1828.nl', 'test').outcome).toBe('BAD_PASSWORD');
    expect(login(db, 'pia@1828.nl', 'nieuw').outcome).toBe('OK');
    // single-use
    expect(completePasswordReset(db, 'pia@1828.nl', stored.code, 'weer')).toBe('BAD_CODE');
  });

  it('change password verifies the current one and takes effect', () => {
    expect(changePassword(db, 'pia@1828.nl', 'fout', 'abcd')).toBe('BAD_CURRENT');
    expect(changePassword(db, 'pia@1828.nl', 'test', 'abc')).toBe('WEAK_PASSWORD');
    expect(changePassword(db, 'pia@1828.nl', 'test', 'abcd')).toBe('OK');
    expect(login(db, 'pia@1828.nl', 'abcd').outcome).toBe('OK');
  });
});
