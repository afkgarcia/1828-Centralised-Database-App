import { contextBridge, ipcRenderer } from 'electron';
import type { City, Project, RoleFilter, TaskStatus, User, UserRole } from '@shared/types';
import type {
  ChangePasswordOutcome,
  LoginOutcome,
  ResetOutcome,
  SignupOutcome,
} from '@shared/business-logic';

/**
 * Typed bridge between renderer and main. The renderer consumes this through
 * the services adapter only (desktop/renderer/src/services/api.ts), so the web
 * build can swap the adapter for fetch calls without touching components.
 */
export interface World {
  cities: City[];
  projects: Project[];
}

export type LoginResult = { outcome: Exclude<LoginOutcome, 'OK'> } | { outcome: 'OK'; user: User };

export type ListRef = { cityId: string } | { phaseId: string };
export type MutationResult =
  | { ok: true; id?: string }
  | { ok: false; error: string; openCount?: number };
export type DecideAction = 'approve' | 'reject' | 'withdraw' | 'reopen';

export interface TrackerApi {
  health(): Promise<{
    phaseTemplates: number;
    taskTemplates: number;
    cities: number;
    projects: number;
    tasks: number;
    users: number;
  }>;
  getWorld(): Promise<World>;
  openExternal(url: string): Promise<boolean>;
  login(email: string, password: string): Promise<LoginResult>;
  signup(
    email: string,
    password: string,
    displayName: string,
    role: UserRole,
  ): Promise<SignupOutcome>;
  resetRequest(email: string): Promise<boolean>;
  resetComplete(email: string, code: string, newPassword: string): Promise<ResetOutcome>;
  changePassword(
    email: string,
    current: string,
    next: string,
  ): Promise<ChangePasswordOutcome>;
  setTaskStatus(
    taskId: string,
    status: TaskStatus,
    actorUserId?: string,
    lang?: string,
  ): Promise<MutationResult>;
  markAll(
    ref: ListRef,
    target: 'DONE' | 'OPEN',
    filter: RoleFilter,
    actorUserId?: string,
    lang?: string,
  ): Promise<MutationResult>;
  submitList(
    ref: ListRef,
    choice?: 'na' | 'move',
    actorUserId?: string,
    lang?: string,
  ): Promise<MutationResult>;
  decideList(
    ref: ListRef,
    action: DecideAction,
    actorUserId: string,
    lang?: string,
  ): Promise<MutationResult>;
  addAttachment(
    taskId: string,
    url: string,
    name: string | null,
    actorUserId: string,
  ): Promise<MutationResult>;
  removeAttachment(attachmentId: string): Promise<MutationResult>;
  uploadFileAttachment(taskId: string, actorUserId: string): Promise<MutationResult>;
  openUploadedFile(attachmentId: string): Promise<boolean>;
  createCity(name: string, actorUserId: string): Promise<MutationResult>;
  createProject(name: string, cityId: string, actorUserId: string): Promise<MutationResult>;
  addCustomRow(
    ref: ListRef,
    blokKey: string,
    deliverable: string,
    actorUserId: string,
  ): Promise<MutationResult>;
  deleteCustomRow(taskId: string, actorUserId: string): Promise<MutationResult>;
  moveBlok(ref: ListRef, blokKey: string, dir: -1 | 1, actorUserId: string): Promise<MutationResult>;
  moveTask(taskId: string, dir: -1 | 1, actorUserId: string): Promise<MutationResult>;
  listOutbox(viewerUserId: string): Promise<OutboxItem[]>;
  openOutboxFolder(): Promise<boolean>;
  adminListUsers(actorUserId: string): Promise<User[] | { ok: false; error: string }>;
  adminSetStatus(
    actorUserId: string,
    targetUserId: string,
    status: 'ACTIVE' | 'REJECTED',
  ): Promise<AdminResult>;
  adminSetRole(actorUserId: string, targetUserId: string, role: UserRole): Promise<AdminResult>;
  adminSetCityAccess(
    actorUserId: string,
    targetUserId: string,
    cityId: string,
    granted: boolean,
  ): Promise<AdminResult>;
  adminSetAccessAll(
    actorUserId: string,
    targetUserId: string,
    value: boolean,
  ): Promise<AdminResult>;
  adminRemoveUser(
    actorUserId: string,
    targetUserId: string,
    replacementUserId: string,
  ): Promise<AdminResult>;
  exportExcel(scope?: {
    projectId?: string;
  }): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>;
  driveStatus(): Promise<{ status: 'unconfigured' | 'disconnected' | 'connected'; canConnect: boolean }>;
  driveConnect(): Promise<boolean>;
  exportDrive(projectId: string): Promise<{ ok: boolean; error?: string; link?: string; fileName?: string }>;
  exportPdf(
    scope?: { projectId?: string },
    lang?: string,
  ): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>;
}

export interface OutboxItem {
  id: string;
  event: string;
  from: string;
  to: string[];
  subject: string;
  body: string;
  deliveredVia: string;
  createdAt: string;
}

export type AdminResult = { ok: true; movedDocs?: number } | { ok: false; error: string };

const api: TrackerApi = {
  health: () => ipcRenderer.invoke('health'),
  getWorld: () => ipcRenderer.invoke('world:get'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  login: (email, password) => ipcRenderer.invoke('auth:login', email, password),
  signup: (email, password, displayName, role) =>
    ipcRenderer.invoke('auth:signup', email, password, displayName, role),
  resetRequest: (email) => ipcRenderer.invoke('auth:reset-request', email),
  resetComplete: (email, code, newPassword) =>
    ipcRenderer.invoke('auth:reset-complete', email, code, newPassword),
  changePassword: (email, current, next) =>
    ipcRenderer.invoke('auth:change-password', email, current, next),
  setTaskStatus: (taskId, status, actorUserId, lang) =>
    ipcRenderer.invoke('task:set-status', taskId, status, actorUserId, lang),
  markAll: (ref, target, filter, actorUserId, lang) =>
    ipcRenderer.invoke('list:mark-all', ref, target, filter, actorUserId, lang),
  submitList: (ref, choice, actorUserId, lang) =>
    ipcRenderer.invoke('list:submit', ref, choice, actorUserId, lang),
  decideList: (ref, action, actorUserId, lang) =>
    ipcRenderer.invoke('list:decide', ref, action, actorUserId, lang),
  addAttachment: (taskId, url, name, actorUserId) =>
    ipcRenderer.invoke('attachment:add', taskId, url, name, actorUserId),
  removeAttachment: (attachmentId) => ipcRenderer.invoke('attachment:remove', attachmentId),
  uploadFileAttachment: (taskId, actorUserId) =>
    ipcRenderer.invoke('attachment:upload-native', taskId, actorUserId),
  openUploadedFile: (attachmentId) => ipcRenderer.invoke('attachment:open-upload', attachmentId),
  createCity: (name, actorUserId) => ipcRenderer.invoke('city:create', name, actorUserId),
  createProject: (name, cityId, actorUserId) =>
    ipcRenderer.invoke('project:create', name, cityId, actorUserId),
  addCustomRow: (ref, blokKey, deliverable, actorUserId) =>
    ipcRenderer.invoke('task:add-custom', ref, blokKey, deliverable, actorUserId),
  deleteCustomRow: (taskId, actorUserId) =>
    ipcRenderer.invoke('task:delete-custom', taskId, actorUserId),
  moveBlok: (ref, blokKey, dir, actorUserId) =>
    ipcRenderer.invoke('list:move-blok', ref, blokKey, dir, actorUserId),
  moveTask: (taskId, dir, actorUserId) =>
    ipcRenderer.invoke('task:move', taskId, dir, actorUserId),
  listOutbox: (viewerUserId) => ipcRenderer.invoke('outbox:list', viewerUserId),
  openOutboxFolder: () => ipcRenderer.invoke('outbox:open-folder'),
  adminListUsers: (actorUserId) => ipcRenderer.invoke('admin:list-users', actorUserId),
  adminSetStatus: (actorUserId, targetUserId, status) =>
    ipcRenderer.invoke('admin:set-status', actorUserId, targetUserId, status),
  adminSetRole: (actorUserId, targetUserId, role) =>
    ipcRenderer.invoke('admin:set-role', actorUserId, targetUserId, role),
  adminSetCityAccess: (actorUserId, targetUserId, cityId, granted) =>
    ipcRenderer.invoke('admin:set-city-access', actorUserId, targetUserId, cityId, granted),
  adminSetAccessAll: (actorUserId, targetUserId, value) =>
    ipcRenderer.invoke('admin:set-access-all', actorUserId, targetUserId, value),
  adminRemoveUser: (actorUserId, targetUserId, replacementUserId) =>
    ipcRenderer.invoke('admin:remove-user', actorUserId, targetUserId, replacementUserId),
  exportExcel: (scope) => ipcRenderer.invoke('export:excel', scope),
  exportPdf: (scope, lang) => ipcRenderer.invoke('export:pdf', scope, lang),
  driveStatus: () => ipcRenderer.invoke('drive:status'),
  driveConnect: () => ipcRenderer.invoke('drive:connect'),
  exportDrive: (projectId) => ipcRenderer.invoke('export:drive', projectId),
};

contextBridge.exposeInMainWorld('tracker', api);
