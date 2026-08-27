/**
 * Domain types for the 1828 Fasedocument Tracker.
 *
 * Ported from the Kotlin/JavaFX app (see ../../audit/models-state.md). Deliberate
 * changes from the Kotlin model, per MIGRATION_NOTES §1.7:
 *  - every entity has a UUID `id`; cities/projects are no longer keyed by name
 *  - attachments reference their creator by user id (plus a denormalized label)
 *  - `existingLink` from the phase document is a display hint (`linkHint`), never a URL
 */

export type UserRole = 'OWNER' | 'PM' | 'OM' | 'PO' | 'PPM' | 'MT';
export type UserStatus = 'PENDING' | 'ACTIVE' | 'REJECTED';
export type TaskStatus = 'OPEN' | 'DONE' | 'NA';

export type DriveKind =
  | 'GOOGLE_DOC'
  | 'GOOGLE_SHEET'
  | 'GOOGLE_SLIDES'
  | 'GOOGLE_FORM'
  | 'DRIVE_FOLDER'
  | 'DRIVE_FILE'
  | 'WEB_LINK'
  /** Uploaded from the computer; bytes live in the app's files dir, not at a URL. */
  | 'FILE_UPLOAD';

export type NotifyEvent =
  | 'DELIVERABLE_SUBMITTED'
  | 'APPROVAL_REQUESTED'
  | 'PHASE_APPROVED'
  | 'PHASE_REJECTED'
  | 'PASSWORD_RESET';

/** RASCI filter value: a role or 'all'. */
export type RoleFilter = UserRole | 'all';

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  /** Blanket access regardless of the grant sets. */
  accessAllCities: boolean;
  /** City ids the user may see. Implies access to every project under each. */
  cityAccess: string[];
  /** Fine-grained project-id grants outside cityAccess. */
  projectAccess: string[];
}

export interface Attachment {
  id: string;
  name: string;
  url: string;
  kind: DriveKind;
  /** Creator's user id; null for system-created rows (e.g. template imports). */
  addedByUserId: string | null;
  /** Denormalized display label; survives user removal/rename for exports. */
  addedByLabel: string;
  addedAt: string; // ISO timestamp
}

export interface Task {
  id: string;
  step: string;
  blok: string;
  deliverable: string;
  r: string;
  a: string;
  s: string;
  c: string;
  iCol: string;
  opm: string;
  /** Placeholder description from the phase document ("Link naar besluit…"). Display-only. */
  linkHint: string;
  status: TaskStatus;
  attachments: Attachment[];
  /** True for admin-added rows. Custom rows can be deleted; base rows cannot. */
  custom: boolean;
  /** Phase this task was moved OUT of by a submit-with-move (WIP rows), if any. */
  movedFromPhaseId?: string | null;
}

/** Grouping key used for blok headers, identical to the Kotlin `blokKey`. */
export function blokKey(task: Pick<Task, 'step' | 'blok'>): string {
  return `${task.step}||${task.blok}`;
}

export interface ApprovalFlags {
  submitted: boolean;
  approved: boolean;
}

export interface City extends ApprovalFlags {
  id: string;
  name: string;
  tasks: Task[];
}

export interface Phase extends ApprovalFlags {
  id: string;
  /** 0-based index within the project (0 = Acquisitiefase). */
  idx: number;
  sheet: string;
  tasks: Task[];
}

export interface Project {
  id: string;
  name: string;
  cityId: string;
  phases: Phase[];
}

/** Template rows as imported from phases.json / the source workbook. */
export interface TaskTemplate {
  row: number;
  step: string;
  blok: string;
  deliverable: string;
  existingLink: string;
  r: string;
  a: string;
  s: string;
  c: string;
  i: string;
  opm: string;
}

export interface PhaseTemplate {
  sheet: string;
  tasks: TaskTemplate[];
}

export interface EmailMessage {
  id: string;
  event: NotifyEvent;
  from: string;
  to: string[];
  subject: string;
  body: string;
  createdAt: string; // ISO timestamp
  deliveredVia: string;
}
