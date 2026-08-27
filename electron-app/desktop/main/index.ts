import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { basename } from 'node:path';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { count } from 'drizzle-orm';
import phasesJson from '../../shared/data/phases.json';
import type { PhaseTemplate } from '@shared/types';
import { openDb, type Db } from './db/client';
import { importTemplates, seedDemoData } from './db/seed';
import { bootstrapOwner } from './auth';
import { getWorld } from './db/queries';
import * as auth from './auth';
import * as admin from './admin';
import * as mutations from './db/mutations';
import * as notify from './notify';
import * as files from './files';
import * as driveExport from './drive-export';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { exportWorkbook, type ExportScope } from './export';
import { exportPdf } from './pdf';
import * as schema from './db/schema';
import { eq } from 'drizzle-orm';
import type { Lang } from '@shared/i18n';

let db: Db;

function initDb(): void {
  const dataDir = join(app.getPath('userData'), 'tracker-data');
  mkdirSync(dataDir, { recursive: true });
  notify.initNotify(dataDir);
  files.initFiles(dataDir);
  driveExport.initDrive(dataDir);
  db = openDb(join(dataDir, 'tracker.sqlite'));
  const templates = phasesJson as PhaseTemplate[];
  importTemplates(db, templates);
  // Demo world (well-known credentials) only in dev, or when explicitly requested
  // on a packaged build — never silently on a production install (§1.7.3).
  if (!app.isPackaged || process.env['SEED_DEMO'] === '1') {
    seedDemoData(db, templates);
  }
  // Packaged first run with an empty DB has the same bootstrap gap as the web.
  if (bootstrapOwner(db) === 'created') {
    console.log(`[bootstrap] owner account created for ${process.env['BOOTSTRAP_OWNER_EMAIL']}`);
  }
}

function registerIpc(): void {
  ipcMain.handle('health', () => ({
    phaseTemplates: db.select({ n: count() }).from(schema.phaseTemplates).get()?.n ?? 0,
    taskTemplates: db.select({ n: count() }).from(schema.taskTemplates).get()?.n ?? 0,
    cities: db.select({ n: count() }).from(schema.cities).get()?.n ?? 0,
    projects: db.select({ n: count() }).from(schema.projects).get()?.n ?? 0,
    tasks: db.select({ n: count() }).from(schema.tasks).get()?.n ?? 0,
    users: db.select({ n: count() }).from(schema.users).get()?.n ?? 0,
  }));

  ipcMain.handle('world:get', () => getWorld(db));

  const notifyOpts = (actorUserId: unknown, lang: unknown): mutations.NotifyOpts | undefined =>
    typeof actorUserId === 'string' && actorUserId.length > 0
      ? { actorUserId, lang: (lang === 'en' ? 'en' : 'nl') as Lang }
      : undefined;

  ipcMain.handle(
    'task:set-status',
    (_e, taskId: string, status: string, actorUserId?: string, lang?: string) =>
      mutations.setTaskStatus(
        db,
        String(taskId),
        status as 'OPEN' | 'DONE' | 'NA',
        notifyOpts(actorUserId, lang),
      ),
  );
  ipcMain.handle(
    'list:mark-all',
    (_e, ref: mutations.ListRef, target: string, filter: string, actorUserId?: string, lang?: string) =>
      mutations.markAll(
        db,
        ref,
        target as 'DONE' | 'OPEN',
        filter as 'all',
        notifyOpts(actorUserId, lang),
      ),
  );
  ipcMain.handle(
    'list:submit',
    (_e, ref: mutations.ListRef, choice?: 'na' | 'move', actorUserId?: string, lang?: string) =>
      mutations.submitList(db, ref, choice, notifyOpts(actorUserId, lang)),
  );
  ipcMain.handle(
    'list:decide',
    (
      _e,
      ref: mutations.ListRef,
      action: mutations.DecideAction,
      actorUserId: string,
      lang?: string,
    ) =>
      mutations.decideList(
        db,
        ref,
        action,
        String(actorUserId),
        (lang === 'en' ? 'en' : 'nl') as Lang,
      ),
  );

  ipcMain.handle(
    'attachment:add',
    (_e, taskId: string, url: string, name: string | null, actorUserId: string) =>
      mutations.addAttachment(db, String(taskId), String(url), name, String(actorUserId)),
  );
  ipcMain.handle('attachment:remove', (_e, attachmentId: string) => {
    const att = db
      .select()
      .from(schema.attachments)
      .where(eq(schema.attachments.id, String(attachmentId)))
      .get();
    const result = mutations.removeAttachment(db, String(attachmentId));
    if (result.ok && att?.kind === 'FILE_UPLOAD') files.deleteUploadedFile(att.id);
    return result;
  });

  // Ernest: attach a file from the computer, like an email attachment.
  ipcMain.handle('attachment:upload-native', async (_e, taskId: string, actorUserId: string) => {
    const picked = await dialog.showOpenDialog({ properties: ['openFile'] });
    if (picked.canceled || picked.filePaths.length === 0)
      return { ok: false, error: 'CANCELED' };
    const filePath = picked.filePaths[0]!;
    if (statSync(filePath).size > files.MAX_UPLOAD_BYTES)
      return { ok: false, error: 'TOO_LARGE' };
    const result = mutations.addFileAttachment(
      db,
      String(taskId),
      basename(filePath),
      String(actorUserId),
    );
    if (!result.ok) return result;
    try {
      files.saveUploadedFile(result.id!, readFileSync(filePath));
    } catch (err) {
      db.delete(schema.attachments).where(eq(schema.attachments.id, result.id!)).run();
      throw err;
    }
    return result;
  });

  ipcMain.handle('attachment:open-upload', (_e, attachmentId: string) => {
    const att = db
      .select()
      .from(schema.attachments)
      .where(eq(schema.attachments.id, String(attachmentId)))
      .get();
    if (!att || att.kind !== 'FILE_UPLOAD' || !files.uploadedFileExists(att.id)) return false;
    void shell.openPath(files.uploadedFilePath(att.id));
    return true;
  });

  // Structure edits (admin mode + add city/project). Templates come from the
  // same phases.json import the seeder uses.
  const templates = phasesJson as PhaseTemplate[];
  ipcMain.handle('city:create', (_e, name: string, actorUserId: string) =>
    mutations.createCity(db, templates, String(name), String(actorUserId)),
  );
  ipcMain.handle('project:create', (_e, name: string, cityId: string, actorUserId: string) =>
    mutations.createProject(db, templates, String(name), String(cityId), String(actorUserId)),
  );
  ipcMain.handle(
    'task:add-custom',
    (_e, ref: mutations.ListRef, blokKey: string, deliverable: string, actorUserId: string) =>
      mutations.addCustomRow(db, ref, String(blokKey), String(deliverable), String(actorUserId)),
  );
  ipcMain.handle('task:delete-custom', (_e, taskId: string, actorUserId: string) =>
    mutations.deleteCustomRow(db, String(taskId), String(actorUserId)),
  );
  ipcMain.handle(
    'list:move-blok',
    (_e, ref: mutations.ListRef, blokKey: string, dir: number, actorUserId: string) =>
      mutations.moveBlok(db, ref, String(blokKey), dir < 0 ? -1 : 1, String(actorUserId)),
  );
  ipcMain.handle('task:move', (_e, taskId: string, dir: number, actorUserId: string) =>
    mutations.moveTask(db, String(taskId), dir < 0 ? -1 : 1, String(actorUserId)),
  );

  ipcMain.handle('outbox:list', (_e, viewerUserId: string) => {
    const viewer = notify.listSafeUsers(db).find((u) => u.id === String(viewerUserId));
    return viewer ? notify.listOutbox(db, viewer) : [];
  });
  ipcMain.handle('outbox:open-folder', () => {
    void shell.openPath(notify.outboxDir());
    return true;
  });

  const saveAndRun = async (
    ext: 'xlsx' | 'pdf',
    run: (filePath: string) => Promise<void>,
  ): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }> => {
    const result = await dialog.showSaveDialog({
      title: 'Exporteer naar fasedocument',
      defaultPath: `fasedocument_${new Date().toISOString().slice(0, 10)}.${ext}`,
      filters: [{ name: ext === 'xlsx' ? 'Excel' : 'PDF', extensions: [ext] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    try {
      await run(result.filePath);
      return { ok: true, path: result.filePath };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  };

  ipcMain.handle('export:excel', (_e, scope?: ExportScope) =>
    saveAndRun('xlsx', (filePath) => exportWorkbook(db, filePath, scope ?? {})),
  );
  ipcMain.handle('drive:status', () => ({
    status: driveExport.driveStatus(),
    canConnect: true, // desktop trust model: the UI gates on the owner role
  }));

  // Loopback OAuth (Google desktop-app clients allow http://127.0.0.1 redirects).
  ipcMain.handle('drive:connect', async () => {
    if (driveExport.driveStatus() === 'unconfigured') return false;
    return await new Promise<boolean>((resolve) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        if (url.pathname !== '/callback') {
          res.end();
          return;
        }
        const code = url.searchParams.get('code') ?? '';
        const state = url.searchParams.get('state') ?? '';
        const redirectUri = `http://127.0.0.1:${(server.address() as { port: number }).port}/callback`;
        void (async () => {
          const ok = driveExport.consumeState(state) && code
            ? await driveExport.completeConnect(code, redirectUri)
            : false;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(
            ok
              ? '<h2>Google Drive verbonden — je kunt dit venster sluiten.</h2>'
              : '<h2>Verbinden mislukt — sluit dit venster en probeer opnieuw.</h2>',
          );
          server.close();
          resolve(ok);
        })();
      });
      server.listen(0, '127.0.0.1', () => {
        const port = (server.address() as { port: number }).port;
        const auth = driveExport.buildAuthUrl(`http://127.0.0.1:${port}/callback`);
        if (!auth) {
          server.close();
          resolve(false);
          return;
        }
        void shell.openExternal(auth.url);
      });
      setTimeout(() => {
        server.close();
        resolve(false);
      }, 5 * 60 * 1000).unref();
    });
  });

  ipcMain.handle('export:drive', async (_e, projectId: string) => {
    const world = getWorld(db);
    const project = world.projects.find((p) => p.id === String(projectId));
    if (!project) return { ok: false, error: 'NOT_FOUND' };
    const tmp = join(tmpdir(), `1828-drive-${randomUUID()}.xlsx`);
    try {
      await exportWorkbook(db, tmp, { projectId: project.id });
      return await driveExport.uploadWorkbookToDrive(
        await readFile(tmp),
        driveExport.driveFileName(project.name),
      );
    } catch (e) {
      console.error('[drive-export]', e);
      return { ok: false, error: 'EXPORT_FAILED' };
    }
  });

  ipcMain.handle('export:pdf', (_e, scope?: ExportScope, lang?: string) =>
    saveAndRun('pdf', (filePath) =>
      exportPdf(db, filePath, scope ?? {}, (lang === 'en' ? 'en' : 'nl') as Lang),
    ),
  );

  ipcMain.handle('admin:list-users', (_e, actorUserId: string) =>
    admin.listUsers(db, String(actorUserId)),
  );
  ipcMain.handle(
    'admin:set-status',
    (_e, actorUserId: string, targetUserId: string, status: 'ACTIVE' | 'REJECTED') =>
      admin.setUserStatus(db, String(actorUserId), String(targetUserId), status),
  );
  ipcMain.handle(
    'admin:set-role',
    (_e, actorUserId: string, targetUserId: string, role: string) =>
      admin.setUserRole(
        db,
        String(actorUserId),
        String(targetUserId),
        role as Parameters<typeof admin.setUserRole>[3],
      ),
  );
  ipcMain.handle(
    'admin:set-city-access',
    (_e, actorUserId: string, targetUserId: string, cityId: string, granted: boolean) =>
      admin.setCityAccess(db, String(actorUserId), String(targetUserId), String(cityId), !!granted),
  );
  ipcMain.handle(
    'admin:set-access-all',
    (_e, actorUserId: string, targetUserId: string, value: boolean) =>
      admin.setAccessAllCities(db, String(actorUserId), String(targetUserId), !!value),
  );
  ipcMain.handle(
    'admin:remove-user',
    (_e, actorUserId: string, targetUserId: string, replacementUserId: string) =>
      admin.removeUser(db, String(actorUserId), String(targetUserId), String(replacementUserId)),
  );

  ipcMain.handle('auth:login', (_e, email: string, password: string) =>
    auth.login(db, String(email), String(password)),
  );
  ipcMain.handle(
    'auth:signup',
    (_e, email: string, password: string, displayName: string, role: string) =>
      auth.signup(
        db,
        String(email),
        String(password),
        String(displayName),
        role as Parameters<typeof auth.signup>[4],
      ),
  );
  ipcMain.handle('auth:reset-request', (_e, email: string) => {
    const known = auth.requestPasswordReset(db, String(email));
    // Dev convenience until the outbox UI lands (feature 6): surface the code in
    // the terminal. Never in packaged builds.
    if (known && !app.isPackaged) {
      const row = db
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, String(email).toLowerCase().trim()))
        .get();
      const code = row
        ? db
            .select()
            .from(schema.passwordResetCodes)
            .where(eq(schema.passwordResetCodes.userId, row.id))
            .get()?.code
        : undefined;
      console.log(`[dev] password-reset code for ${String(email)}: ${code ?? '?'}`);
    }
    return known;
  });
  ipcMain.handle('auth:reset-complete', (_e, email: string, code: string, newPassword: string) =>
    auth.completePasswordReset(db, String(email), String(code), String(newPassword)),
  );
  ipcMain.handle('auth:change-password', (_e, email: string, current: string, next: string) =>
    auth.changePassword(db, String(email), String(current), String(next)),
  );

  // Documents open in the system browser; only web URLs are allowed through.
  ipcMain.handle('open-external', (_event, url: unknown) => {
    if (typeof url !== 'string') return false;
    if (!/^https?:\/\//i.test(url)) return false;
    void shell.openExternal(url);
    return true;
  });
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    title: '1828 · Fasedocument Tracker',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  initDb();

  // Headless verification hook: `electron . --pdf-smoke=/tmp/x.pdf` renders the
  // portfolio PDF through the real printToPDF pipeline and exits.
  const smokeArg = process.argv.find((a) => a.startsWith('--pdf-smoke='));
  if (smokeArg) {
    const target = smokeArg.slice('--pdf-smoke='.length);
    try {
      await exportPdf(db, target, {}, 'nl');
      const { statSync } = await import('node:fs');
      console.log(`PDF_SMOKE_OK ${statSync(target).size}`);
      app.exit(0);
    } catch (e) {
      console.error('PDF_SMOKE_FAIL', e);
      app.exit(1);
    }
    return;
  }

  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
