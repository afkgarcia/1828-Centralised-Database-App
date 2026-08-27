import { randomUUID } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import type { Db } from '../desktop/main/db/client';
import * as t from '../desktop/main/db/schema';

/**
 * DB-backed cookie sessions: the HttpOnly cookie carries an opaque id, state
 * lives in the sessions table, sliding 7-day TTL — deploys and restarts keep
 * users signed in. Expired rows are pruned lazily on read.
 */

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Skip the sliding-TTL write when the session was touched less than this ago. */
const SLIDE_WRITE_INTERVAL_MS = 60 * 60 * 1000;

export function createSession(db: Db, userId: string): string {
  const sid = randomUUID();
  db.insert(t.sessions).values({ id: sid, userId, expiresAt: Date.now() + TTL_MS }).run();
  db.delete(t.sessions).where(lt(t.sessions.expiresAt, Date.now())).run();
  return sid;
}

export function sessionUserId(db: Db, sid: string | undefined): string | undefined {
  if (!sid) return undefined;
  const row = db.select().from(t.sessions).where(eq(t.sessions.id, sid)).get();
  if (!row) return undefined;
  const now = Date.now();
  if (row.expiresAt < now) {
    db.delete(t.sessions).where(eq(t.sessions.id, sid)).run();
    return undefined;
  }
  if (row.expiresAt < now + TTL_MS - SLIDE_WRITE_INTERVAL_MS) {
    db.update(t.sessions).set({ expiresAt: now + TTL_MS }).where(eq(t.sessions.id, sid)).run();
  }
  return row.userId;
}

export function destroySession(db: Db, sid: string | undefined): void {
  if (sid) db.delete(t.sessions).where(eq(t.sessions.id, sid)).run();
}

export function readSid(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx < 0) continue;
    if (part.slice(0, eqIdx).trim() === 'sid') return decodeURIComponent(part.slice(eqIdx + 1).trim());
  }
  return undefined;
}

export function sidCookie(sid: string, secure: boolean): string {
  const base = `sid=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL_MS / 1000}`;
  return secure ? `${base}; Secure` : base;
}

export function clearSidCookie(): string {
  return 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}
