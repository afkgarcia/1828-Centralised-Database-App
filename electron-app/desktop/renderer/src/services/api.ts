import type {
  AdminResult,
  DecideAction,
  ListRef,
  MutationResult,
  OutboxItem,
  TrackerApi,
  World,
} from '../../../preload';
import type { RoleFilter, TaskStatus, User, UserRole } from '@shared/types';

export type { AdminResult, DecideAction, ListRef, MutationResult, OutboxItem, World };

declare global {
  interface Window {
    tracker?: TrackerApi;
  }
}

/**
 * The single seam between the UI and its backend. Inside Electron the preload
 * bridge is present and every call goes over IPC. On the web it is absent and
 * the same surface is served by fetch calls against /api — there the session
 * cookie is the actor, so the actorUserId parameters are simply not sent.
 */
const desktop: TrackerApi | undefined = window.tracker;

/** Thrown by the web adapter on 401 — App's global handler alerts and returns to login. */
export class SessionExpiredError extends Error {
  constructor() {
    super('Sessie verlopen — log opnieuw in / Session expired — log in again.');
    this.name = 'SessionExpiredError';
  }
}

/** True when running as the web app (drives web-only UI: hidden folder/PDF buttons, session restore). */
export const isWeb = desktop === undefined;

async function http<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (res.status === 401 && path !== '/api/auth/session') {
    throw new SessionExpiredError();
  }
  return (await res.json()) as T;
}

const post = <T>(path: string, body?: unknown): Promise<T> => http<T>('POST', path, body ?? {});
const get = <T>(path: string): Promise<T> => http<T>('GET', path);

export const api = {
  getWorld: (): Promise<World> => (desktop ? desktop.getWorld() : get('/api/world')),
  openExternal: (url: string): Promise<boolean> => {
    if (desktop) return desktop.openExternal(url);
    // Same scheme guard as the desktop main process: web URLs only.
    if (!/^https?:\/\//i.test(url)) return Promise.resolve(false);
    window.open(url, '_blank', 'noopener');
    return Promise.resolve(true);
  },
  login: (email: string, password: string) =>
    desktop
      ? desktop.login(email, password)
      : post<Awaited<ReturnType<TrackerApi['login']>>>('/api/auth/login', { email, password }),
  /** Web only: re-adopt a live cookie session on reload (desktop keeps Kotlin's no-persistence). */
  restoreSession: async (): Promise<User | null> => {
    if (desktop) return null;
    try {
      const result = await get<{ user?: User }>('/api/auth/session');
      return result.user ?? null;
    } catch {
      return null;
    }
  },
  /** Web only: server-side session teardown; desktop logout is renderer state. */
  logout: (): Promise<void> =>
    desktop ? Promise.resolve() : post('/api/auth/logout').then(() => undefined),
  signup: (email: string, password: string, name: string, role: UserRole) =>
    desktop
      ? desktop.signup(email, password, name, role)
      : post<Awaited<ReturnType<TrackerApi['signup']>>>('/api/auth/signup', {
          email,
          password,
          displayName: name,
          role,
        }),
  resetRequest: (email: string) =>
    desktop ? desktop.resetRequest(email) : post<boolean>('/api/auth/reset-request', { email }),
  resetComplete: (email: string, code: string, pw: string) =>
    desktop
      ? desktop.resetComplete(email, code, pw)
      : post<Awaited<ReturnType<TrackerApi['resetComplete']>>>('/api/auth/reset-complete', {
          email,
          code,
          newPassword: pw,
        }),
  changePassword: (email: string, current: string, next: string) =>
    desktop
      ? desktop.changePassword(email, current, next)
      : post<Awaited<ReturnType<TrackerApi['changePassword']>>>('/api/auth/change-password', {
          current,
          next,
        }),
  setTaskStatus: (
    taskId: string,
    status: TaskStatus,
    actorUserId?: string,
    lang?: string,
  ): Promise<MutationResult> =>
    desktop
      ? desktop.setTaskStatus(taskId, status, actorUserId, lang)
      : post('/api/task/status', { taskId, status, lang }),
  markAll: (
    ref: ListRef,
    target: 'DONE' | 'OPEN',
    filter: RoleFilter,
    actorUserId?: string,
    lang?: string,
  ): Promise<MutationResult> =>
    desktop
      ? desktop.markAll(ref, target, filter, actorUserId, lang)
      : post('/api/list/mark-all', { ref, target, filter, lang }),
  submitList: (
    ref: ListRef,
    choice?: 'na' | 'move',
    actorUserId?: string,
    lang?: string,
  ): Promise<MutationResult> =>
    desktop
      ? desktop.submitList(ref, choice, actorUserId, lang)
      : post('/api/list/submit', { ref, choice, lang }),
  decideList: (
    ref: ListRef,
    action: DecideAction,
    actorUserId: string,
    lang?: string,
  ): Promise<MutationResult> =>
    desktop
      ? desktop.decideList(ref, action, actorUserId, lang)
      : post('/api/list/decide', { ref, action, lang }),
  addAttachment: (taskId: string, url: string, name: string | null, actorUserId: string) =>
    desktop
      ? desktop.addAttachment(taskId, url, name, actorUserId)
      : post<MutationResult>('/api/attachment/add', { taskId, url, name }),
  removeAttachment: (attachmentId: string) =>
    desktop
      ? desktop.removeAttachment(attachmentId)
      : post<MutationResult>('/api/attachment/remove', { attachmentId }),
  /** Attach a file from the computer. Desktop opens the native picker (file
   *  param unused); web sends the chosen File as a raw body. */
  attachFile: async (taskId: string, actorUserId: string, file?: File): Promise<MutationResult> => {
    if (desktop) return desktop.uploadFileAttachment(taskId, actorUserId);
    if (!file) return { ok: false, error: 'CANCELED' };
    if (file.size > 25 * 1024 * 1024) return { ok: false, error: 'TOO_LARGE' };
    const res = await fetch(
      `/api/attachment/upload?taskId=${encodeURIComponent(taskId)}&name=${encodeURIComponent(file.name)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
        credentials: 'same-origin',
      },
    );
    if (res.status === 401) throw new SessionExpiredError();
    return (await res.json()) as MutationResult;
  },
  /** Open an uploaded file: desktop → OS default app; web → download route. */
  openUploadedAttachment: (attachmentId: string): Promise<boolean> => {
    if (desktop) return desktop.openUploadedFile(attachmentId);
    window.open(`/api/files/${encodeURIComponent(attachmentId)}`, '_blank', 'noopener');
    return Promise.resolve(true);
  },
  createCity: (name: string, actorUserId: string): Promise<MutationResult> =>
    desktop ? desktop.createCity(name, actorUserId) : post('/api/city/create', { name }),
  createProject: (name: string, cityId: string, actorUserId: string): Promise<MutationResult> =>
    desktop
      ? desktop.createProject(name, cityId, actorUserId)
      : post('/api/project/create', { name, cityId }),
  addCustomRow: (
    ref: ListRef,
    blokKey: string,
    deliverable: string,
    actorUserId: string,
  ): Promise<MutationResult> =>
    desktop
      ? desktop.addCustomRow(ref, blokKey, deliverable, actorUserId)
      : post('/api/task/add-custom', { ref, blokKey, deliverable }),
  deleteCustomRow: (taskId: string, actorUserId: string): Promise<MutationResult> =>
    desktop
      ? desktop.deleteCustomRow(taskId, actorUserId)
      : post('/api/task/delete-custom', { taskId }),
  moveBlok: (
    ref: ListRef,
    blokKey: string,
    dir: -1 | 1,
    actorUserId: string,
  ): Promise<MutationResult> =>
    desktop
      ? desktop.moveBlok(ref, blokKey, dir, actorUserId)
      : post('/api/list/move-blok', { ref, blokKey, dir }),
  moveTask: (taskId: string, dir: -1 | 1, actorUserId: string): Promise<MutationResult> =>
    desktop
      ? desktop.moveTask(taskId, dir, actorUserId)
      : post('/api/task/move', { taskId, dir }),
  listOutbox: (viewerUserId: string): Promise<OutboxItem[]> =>
    desktop ? desktop.listOutbox(viewerUserId) : get('/api/outbox'),
  openOutboxFolder: () => (desktop ? desktop.openOutboxFolder() : Promise.resolve(false)),
  adminListUsers: (actorUserId: string) =>
    desktop
      ? desktop.adminListUsers(actorUserId)
      : get<Awaited<ReturnType<TrackerApi['adminListUsers']>>>('/api/admin/users'),
  adminSetStatus: (actorUserId: string, targetUserId: string, status: 'ACTIVE' | 'REJECTED') =>
    desktop
      ? desktop.adminSetStatus(actorUserId, targetUserId, status)
      : post<AdminResult>('/api/admin/set-status', { targetUserId, status }),
  adminSetRole: (actorUserId: string, targetUserId: string, role: UserRole) =>
    desktop
      ? desktop.adminSetRole(actorUserId, targetUserId, role)
      : post<AdminResult>('/api/admin/set-role', { targetUserId, role }),
  adminSetCityAccess: (
    actorUserId: string,
    targetUserId: string,
    cityId: string,
    granted: boolean,
  ) =>
    desktop
      ? desktop.adminSetCityAccess(actorUserId, targetUserId, cityId, granted)
      : post<AdminResult>('/api/admin/set-city-access', { targetUserId, cityId, granted }),
  adminSetAccessAll: (actorUserId: string, targetUserId: string, value: boolean) =>
    desktop
      ? desktop.adminSetAccessAll(actorUserId, targetUserId, value)
      : post<AdminResult>('/api/admin/set-access-all', { targetUserId, value }),
  adminRemoveUser: (actorUserId: string, targetUserId: string, replacementUserId: string) =>
    desktop
      ? desktop.adminRemoveUser(actorUserId, targetUserId, replacementUserId)
      : post<AdminResult>('/api/admin/remove-user', { targetUserId, replacementUserId }),
  exportExcel: async (scope?: { projectId?: string }): Promise<ExportResult> => {
    if (desktop) return desktop.exportExcel(scope);
    // Fetch as a blob so server refusals surface as results instead of a
    // raw-JSON tab plus a fabricated success alert.
    const q = scope?.projectId ? `?projectId=${encodeURIComponent(scope.projectId)}` : '';
    const res = await fetch(`/api/export/excel${q}`, { credentials: 'same-origin' });
    if (!res.ok) {
      if (res.status === 401) throw new SessionExpiredError();
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    }
    const blobUrl = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = 'fasedocument.xlsx';
    a.click();
    URL.revokeObjectURL(blobUrl);
    return { ok: true, path: 'fasedocument.xlsx' };
  },
  driveStatus: (): Promise<{ status: 'unconfigured' | 'disconnected' | 'connected'; canConnect: boolean }> =>
    desktop ? desktop.driveStatus() : get('/api/drive/status'),
  /** Desktop: loopback OAuth via the system browser. Web: full-page redirect. */
  driveConnect: (): Promise<boolean> => {
    if (desktop) return desktop.driveConnect();
    window.location.href = '/api/drive/connect';
    return Promise.resolve(true);
  },
  exportDrive: (
    projectId: string,
  ): Promise<{ ok: boolean; error?: string; link?: string; fileName?: string }> =>
    desktop ? desktop.exportDrive(projectId) : post('/api/export/drive', { projectId }),
  exportPdf: (scope?: { projectId?: string }, lang?: string): Promise<ExportResult> =>
    desktop
      ? desktop.exportPdf(scope, lang)
      : Promise.resolve({
          ok: false,
          error: 'PDF-export is (nog) alleen beschikbaar in de desktop-app.',
        }),
};

type ExportResult = { ok: boolean; path?: string; canceled?: boolean; error?: string };
