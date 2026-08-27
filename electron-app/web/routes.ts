import { raw, Router, type Request, type Response } from 'express';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { PhaseTemplate, RoleFilter, TaskStatus, User, UserRole } from '@shared/types';
import type { Lang } from '@shared/i18n';
import * as auth from '../desktop/main/auth';
import * as admin from '../desktop/main/admin';
import * as mutations from '../desktop/main/db/mutations';
import * as notify from '../desktop/main/notify';
import * as files from '../desktop/main/files';
import { exportWorkbook } from '../desktop/main/export';
import {
  buildAuthUrl,
  completeConnect,
  consumeState,
  driveFileName,
  driveStatus,
  uploadWorkbookToDrive,
} from '../desktop/main/drive-export';
import { readFile } from 'node:fs/promises';
import type { Db } from '../desktop/main/db/client';
import * as schema from '../desktop/main/db/schema';
import { canTouchRef, refForAttachment, refForTask, worldFor } from './access';
import { makeLimiter } from './rate-limit';
import {
  clearSidCookie,
  createSession,
  destroySession,
  readSid,
  sessionUserId,
  sidCookie,
} from './sessions';

/**
 * REST surface mirroring the preload TrackerApi, with two web-only rules:
 * the ACTOR IS ALWAYS THE SESSION USER (any actorUserId on the wire is
 * ignored), and every target is access-checked server-side before the shared
 * mutation guards run. Electron-only calls (open folder, PDF print) have no
 * routes — the web adapter hides those affordances.
 */

const UNAUTH = { ok: false, error: 'UNAUTHENTICATED' } as const;
const NO_ACCESS = { ok: false, error: 'NO_ACCESS' } as const;

export function apiRouter(db: Db, templates: PhaseTemplate[]): Router {
  const router = Router();
  const secureCookies = process.env['NODE_ENV'] === 'production';

  // Brute-force / enumeration brake on the unauthenticated auth endpoints.
  const authLimit = makeLimiter(Number(process.env['AUTH_RATE_LIMIT'] ?? 10), 5 * 60 * 1000);
  const rateLimited = (req: Request, res: Response): boolean => {
    if (authLimit(req.ip ?? 'unknown')) return false;
    res.status(429).json({ ok: false, error: 'RATE_LIMITED' });
    return true;
  };

  const sessionUser = (req: Request): User | undefined => {
    const userId = sessionUserId(db, readSid(req.headers.cookie));
    return userId ? auth.getSafeUser(db, userId) : undefined;
  };

  /** Wraps a handler that needs a signed-in user; 401s otherwise. */
  const authed =
    (handler: (req: Request, res: Response, user: User) => void) =>
    (req: Request, res: Response): void => {
      const user = sessionUser(req);
      if (!user) {
        res.status(401).json(UNAUTH);
        return;
      }
      handler(req, res, user);
    };

  const langOf = (req: Request): Lang => (req.body?.lang === 'en' ? 'en' : 'nl');
  const notifyOpts = (req: Request, user: User): mutations.NotifyOpts => ({
    actorUserId: user.id,
    lang: langOf(req),
  });
  const guardRef = (req: Request, res: Response, user: User, ref: mutations.ListRef): boolean => {
    if (canTouchRef(db, user, ref)) return true;
    res.status(403).json(NO_ACCESS);
    return false;
  };

  // ── auth ──────────────────────────────────────────────────────────────────
  router.post('/auth/login', (req, res) => {
    if (rateLimited(req, res)) return;
    const result = auth.login(db, String(req.body?.email ?? ''), String(req.body?.password ?? ''));
    if (result.outcome === 'OK') {
      res.setHeader('Set-Cookie', sidCookie(createSession(db, result.user.id), secureCookies));
    }
    // Unknown address answers like a wrong password — no account oracle.
    res.json(result.outcome === 'UNKNOWN_EMAIL' ? { outcome: 'BAD_PASSWORD' } : result);
  });

  router.post('/auth/logout', (req, res) => {
    destroySession(db, readSid(req.headers.cookie));
    res.setHeader('Set-Cookie', clearSidCookie());
    res.json({ ok: true });
  });

  router.get(
    '/auth/session',
    authed((_req, res, user) => res.json({ user })),
  );

  router.post('/auth/signup', (req, res) => {
    if (rateLimited(req, res)) return;
    res.json(
      auth.signup(
        db,
        String(req.body?.email ?? ''),
        String(req.body?.password ?? ''),
        String(req.body?.displayName ?? ''),
        String(req.body?.role ?? 'PM') as UserRole,
      ),
    );
  });

  router.post('/auth/reset-request', (req, res) => {
    if (rateLimited(req, res)) return;
    auth.requestPasswordReset(db, String(req.body?.email ?? ''));
    res.json(true); // constant-shaped answer — no account oracle
  });

  router.post('/auth/reset-complete', (req, res) => {
    if (rateLimited(req, res)) return;
    const outcome = auth.completePasswordReset(
      db,
      String(req.body?.email ?? ''),
      String(req.body?.code ?? ''),
      String(req.body?.newPassword ?? ''),
    );
    // Unknown address answers like a wrong code — no account oracle.
    res.json(outcome === 'UNKNOWN_EMAIL' ? 'BAD_CODE' : outcome);
  });

  router.post(
    '/auth/change-password',
    authed((req, res, user) => {
      // The email on the wire is ignored — you change your own password.
      res.json(
        auth.changePassword(db, user.email, String(req.body?.current ?? ''), String(req.body?.next ?? '')),
      );
    }),
  );

  // ── world ─────────────────────────────────────────────────────────────────
  router.get(
    '/world',
    authed((_req, res, user) => res.json(worldFor(db, user))),
  );

  // ── task + list mutations ─────────────────────────────────────────────────
  router.post(
    '/task/status',
    authed((req, res, user) => {
      const taskId = String(req.body?.taskId ?? '');
      const ref = refForTask(db, taskId);
      if (!ref) {
        res.status(404).json({ ok: false, error: 'NOT_FOUND' });
        return;
      }
      if (!guardRef(req, res, user, ref)) return;
      res.json(
        mutations.setTaskStatus(db, taskId, String(req.body?.status) as TaskStatus, notifyOpts(req, user)),
      );
    }),
  );

  router.post(
    '/list/mark-all',
    authed((req, res, user) => {
      const ref = req.body?.ref as mutations.ListRef;
      if (!guardRef(req, res, user, ref)) return;
      res.json(
        mutations.markAll(
          db,
          ref,
          req.body?.target === 'OPEN' ? 'OPEN' : 'DONE',
          String(req.body?.filter ?? 'all') as RoleFilter,
          notifyOpts(req, user),
        ),
      );
    }),
  );

  router.post(
    '/list/submit',
    authed((req, res, user) => {
      const ref = req.body?.ref as mutations.ListRef;
      if (!guardRef(req, res, user, ref)) return;
      const choice = req.body?.choice === 'na' || req.body?.choice === 'move' ? req.body.choice : undefined;
      res.json(mutations.submitList(db, ref, choice, notifyOpts(req, user)));
    }),
  );

  router.post(
    '/list/decide',
    authed((req, res, user) => {
      const ref = req.body?.ref as mutations.ListRef;
      if (!guardRef(req, res, user, ref)) return;
      res.json(
        mutations.decideList(
          db,
          ref,
          String(req.body?.action) as mutations.DecideAction,
          user.id,
          langOf(req),
        ),
      );
    }),
  );

  // ── attachments ───────────────────────────────────────────────────────────
  router.post(
    '/attachment/add',
    authed((req, res, user) => {
      const taskId = String(req.body?.taskId ?? '');
      const ref = refForTask(db, taskId);
      if (!ref) {
        res.status(404).json({ ok: false, error: 'NOT_FOUND' });
        return;
      }
      if (!guardRef(req, res, user, ref)) return;
      const name = req.body?.name == null ? null : String(req.body.name);
      res.json(mutations.addAttachment(db, taskId, String(req.body?.url ?? ''), name, user.id));
    }),
  );

  router.post(
    '/attachment/remove',
    authed((req, res, user) => {
      const attachmentId = String(req.body?.attachmentId ?? '');
      const ref = refForAttachment(db, attachmentId);
      if (!ref) {
        res.status(404).json({ ok: false, error: 'NOT_FOUND' });
        return;
      }
      if (!guardRef(req, res, user, ref)) return;
      const att = db
        .select()
        .from(schema.attachments)
        .where(eq(schema.attachments.id, attachmentId))
        .get();
      const result = mutations.removeAttachment(db, attachmentId);
      if (result.ok && att?.kind === 'FILE_UPLOAD') files.deleteUploadedFile(att.id);
      res.json(result);
    }),
  );

  // Ernest: attach from the computer. Raw body (no multipart dependency); the
  // filename travels in the query string, the bytes in the request body.
  router.post(
    '/attachment/upload',
    raw({ type: () => true, limit: files.MAX_UPLOAD_BYTES }),
    authed((req, res, user) => {
      const taskId = String(req.query['taskId'] ?? '');
      const name = String(req.query['name'] ?? '');
      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        res.status(400).json({ ok: false, error: 'INVALID_NAME' });
        return;
      }
      const ref = refForTask(db, taskId);
      if (!ref) {
        res.status(404).json({ ok: false, error: 'NOT_FOUND' });
        return;
      }
      if (!guardRef(req, res, user, ref)) return;
      const result = mutations.addFileAttachment(db, taskId, name, user.id);
      if (!result.ok) {
        res.json(result);
        return;
      }
      try {
        files.saveUploadedFile(result.id!, body);
      } catch {
        db.delete(schema.attachments).where(eq(schema.attachments.id, result.id!)).run();
        res.status(500).json({ ok: false, error: 'UPLOAD_FAILED' });
        return;
      }
      res.json(result);
    }),
  );

  // Access-checked download of an uploaded file.
  router.get(
    '/files/:attachmentId',
    authed((req, res, user) => {
      const attachmentId = String(req.params['attachmentId'] ?? '');
      const att = db
        .select()
        .from(schema.attachments)
        .where(eq(schema.attachments.id, attachmentId))
        .get();
      const ref = att ? refForAttachment(db, attachmentId) : undefined;
      if (!att || att.kind !== 'FILE_UPLOAD' || !ref || !files.uploadedFileExists(att.id)) {
        res.status(404).json({ ok: false, error: 'NOT_FOUND' });
        return;
      }
      if (!guardRef(req, res, user, ref)) return;
      res.download(files.uploadedFilePath(att.id), att.name);
    }),
  );

  // ── structure edits ───────────────────────────────────────────────────────
  router.post(
    '/city/create',
    authed((req, res, user) => {
      res.json(mutations.createCity(db, templates, String(req.body?.name ?? ''), user.id));
    }),
  );

  router.post(
    '/project/create',
    authed((req, res, user) => {
      // createCity/createProject run their own role/access checks against the actor.
      res.json(
        mutations.createProject(
          db,
          templates,
          String(req.body?.name ?? ''),
          String(req.body?.cityId ?? ''),
          user.id,
        ),
      );
    }),
  );

  router.post(
    '/task/add-custom',
    authed((req, res, user) => {
      const ref = req.body?.ref as mutations.ListRef;
      if (!guardRef(req, res, user, ref)) return;
      res.json(
        mutations.addCustomRow(
          db,
          ref,
          String(req.body?.blokKey ?? ''),
          String(req.body?.deliverable ?? ''),
          user.id,
        ),
      );
    }),
  );

  router.post(
    '/task/delete-custom',
    authed((req, res, user) => {
      const taskId = String(req.body?.taskId ?? '');
      const ref = refForTask(db, taskId);
      if (!ref) {
        res.status(404).json({ ok: false, error: 'NOT_FOUND' });
        return;
      }
      if (!guardRef(req, res, user, ref)) return;
      res.json(mutations.deleteCustomRow(db, taskId, user.id));
    }),
  );

  router.post(
    '/list/move-blok',
    authed((req, res, user) => {
      const ref = req.body?.ref as mutations.ListRef;
      if (!guardRef(req, res, user, ref)) return;
      res.json(
        mutations.moveBlok(
          db,
          ref,
          String(req.body?.blokKey ?? ''),
          req.body?.dir === -1 ? -1 : 1,
          user.id,
        ),
      );
    }),
  );

  router.post(
    '/task/move',
    authed((req, res, user) => {
      const taskId = String(req.body?.taskId ?? '');
      const ref = refForTask(db, taskId);
      if (!ref) {
        res.status(404).json({ ok: false, error: 'NOT_FOUND' });
        return;
      }
      if (!guardRef(req, res, user, ref)) return;
      res.json(mutations.moveTask(db, taskId, req.body?.dir === -1 ? -1 : 1, user.id));
    }),
  );

  // ── user admin (owner-gated inside admin.ts, actor = session user) ────────
  router.get(
    '/admin/users',
    authed((_req, res, user) => res.json(admin.listUsers(db, user.id))),
  );

  router.post(
    '/admin/set-status',
    authed((req, res, user) => {
      res.json(
        admin.setUserStatus(
          db,
          user.id,
          String(req.body?.targetUserId ?? ''),
          req.body?.status === 'REJECTED' ? 'REJECTED' : 'ACTIVE',
        ),
      );
    }),
  );

  router.post(
    '/admin/set-role',
    authed((req, res, user) => {
      res.json(
        admin.setUserRole(db, user.id, String(req.body?.targetUserId ?? ''), String(req.body?.role) as UserRole),
      );
    }),
  );

  router.post(
    '/admin/set-city-access',
    authed((req, res, user) => {
      res.json(
        admin.setCityAccess(
          db,
          user.id,
          String(req.body?.targetUserId ?? ''),
          String(req.body?.cityId ?? ''),
          req.body?.granted === true,
        ),
      );
    }),
  );

  router.post(
    '/admin/set-access-all',
    authed((req, res, user) => {
      res.json(
        admin.setAccessAllCities(db, user.id, String(req.body?.targetUserId ?? ''), req.body?.value === true),
      );
    }),
  );

  router.post(
    '/admin/remove-user',
    authed((req, res, user) => {
      res.json(
        admin.removeUser(
          db,
          user.id,
          String(req.body?.targetUserId ?? ''),
          String(req.body?.replacementUserId ?? ''),
        ),
      );
    }),
  );

  // ── Google Drive export (owner-only; needs google-oauth.json, see DEPLOY.md) ──
  const driveRedirectUri = (req: Request): string =>
    `${req.protocol}://${req.get('host')}/api/drive/callback`;

  router.get(
    '/drive/status',
    authed((_req, res, user) =>
      res.json({ status: driveStatus(), canConnect: user.role === 'OWNER' }),
    ),
  );

  router.get(
    '/drive/connect',
    authed((req, res, user) => {
      if (user.role !== 'OWNER') {
        res.status(403).json(NO_ACCESS);
        return;
      }
      const auth = buildAuthUrl(driveRedirectUri(req));
      if (!auth) {
        res.status(400).json({ ok: false, error: 'DRIVE_UNCONFIGURED' });
        return;
      }
      res.redirect(auth.url);
    }),
  );

  router.get(
    '/drive/callback',
    authed((req, res, user) => {
      const state = String(req.query['state'] ?? '');
      const code = String(req.query['code'] ?? '');
      if (user.role !== 'OWNER' || !consumeState(state) || !code) {
        res.redirect('/');
        return;
      }
      void completeConnect(code, driveRedirectUri(req)).finally(() => res.redirect('/'));
    }),
  );

  router.post(
    '/export/drive',
    authed((req, res, user) => {
      if (user.role !== 'OWNER') {
        res.status(403).json(NO_ACCESS);
        return;
      }
      const projectId = String(req.body?.projectId ?? '');
      const project = worldFor(db, user).projects.find((p) => p.id === projectId);
      if (!project) {
        res.status(404).json({ ok: false, error: 'NOT_FOUND' });
        return;
      }
      const tmp = join(tmpdir(), `1828-drive-${randomUUID()}.xlsx`);
      void exportWorkbook(db, tmp, { projectId })
        .then(async () => {
          const result = await uploadWorkbookToDrive(
            await readFile(tmp),
            driveFileName(project.name),
          );
          res.json(result);
        })
        .catch((e: unknown) => {
          console.error('[drive-export]', e);
          res.status(500).json({ ok: false, error: 'EXPORT_FAILED' });
        })
        .finally(() => void unlink(tmp).catch(() => undefined));
    }),
  );

  // ── outbox ────────────────────────────────────────────────────────────────
  router.get(
    '/outbox',
    authed((_req, res, user) => res.json(notify.listOutbox(db, user))),
  );

  // ── exports ───────────────────────────────────────────────────────────────
  router.get(
    '/export/excel',
    authed((req, res, user) => {
      const projectId = typeof req.query['projectId'] === 'string' ? req.query['projectId'] : undefined;
      if (projectId) {
        if (!worldFor(db, user).projects.some((p) => p.id === projectId)) {
          res.status(403).json(NO_ACCESS);
          return;
        }
      } else if (user.role !== 'OWNER' && !user.accessAllCities) {
        // Portfolio export spans every city — owner/all-access only on the web.
        res.status(403).json(NO_ACCESS);
        return;
      }
      const tmp = join(tmpdir(), `1828-export-${randomUUID()}.xlsx`);
      void exportWorkbook(db, tmp, projectId ? { projectId } : {})
        .then(() => {
          res.download(tmp, 'fasedocument.xlsx', () => {
            void unlink(tmp).catch(() => undefined);
          });
        })
        .catch((e: unknown) => {
          // Log the detail server-side; never echo exception internals to clients.
          console.error('[export]', e);
          res.status(500).json({ ok: false, error: 'EXPORT_FAILED' });
        });
    }),
  );

  return router;
}
