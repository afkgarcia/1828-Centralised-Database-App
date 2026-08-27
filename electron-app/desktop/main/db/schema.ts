import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * Local SQLite schema, designed to port to Postgres unchanged in shape:
 * UUID text PKs, ISO-8601 text timestamps, integer booleans (boolean columns in PG),
 * no SQLite-specific column types. Mirrors shared/types with MIGRATION_NOTES §1.7 fixes.
 */

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  role: text('role', { enum: ['OWNER', 'PM', 'OM', 'PO', 'PPM', 'MT'] }).notNull(),
  status: text('status', { enum: ['PENDING', 'ACTIVE', 'REJECTED'] }).notNull(),
  accessAllCities: integer('access_all_cities', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
});

export const userCityAccess = sqliteTable(
  'user_city_access',
  {
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    cityId: text('city_id').notNull().references(() => cities.id, { onDelete: 'cascade' }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.cityId] }) }),
);

export const userProjectAccess = sqliteTable(
  'user_project_access',
  {
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  },
  (t) => ({ pk: primaryKey({ columns: [t.userId, t.projectId] }) }),
);

/** Web cookie sessions — server-side state so restarts/deploys keep users signed in. */
export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(), // epoch ms, slid forward on use
});

export const passwordResetCodes = sqliteTable('password_reset_codes', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  createdAt: text('created_at').notNull(),
});

export const cities = sqliteTable('cities', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  position: integer('position').notNull(), // insertion order (Kotlin cityOrder)
  submitted: integer('submitted', { mode: 'boolean' }).notNull().default(false),
  approved: integer('approved', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
});

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  cityId: text('city_id').notNull().references(() => cities.id, { onDelete: 'cascade' }),
  name: text('name').notNull().unique(),
  position: integer('position').notNull(),
  createdAt: text('created_at').notNull(),
});

export const phases = sqliteTable(
  'phases',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(), // 0 = Acquisitiefase … 8 = Garantiefase
    sheet: text('sheet').notNull(),
    submitted: integer('submitted', { mode: 'boolean' }).notNull().default(false),
    approved: integer('approved', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => ({ uniq: uniqueIndex('phases_project_idx').on(t.projectId, t.idx) }),
);

/**
 * Tasks belong to EITHER a city (Gemeenteontwikkeling) OR a project phase —
 * enforced by the tasks_list_xor CHECK below (in generated migrations since
 * drizzle-kit adoption, 2026-08-10).
 */
export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    cityId: text('city_id').references(() => cities.id, { onDelete: 'cascade' }),
    phaseId: text('phase_id').references(() => phases.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    step: text('step').notNull(),
    blok: text('blok').notNull(),
    deliverable: text('deliverable').notNull(),
    r: text('r').notNull().default(''),
    a: text('a').notNull().default(''),
    s: text('s').notNull().default(''),
    c: text('c').notNull().default(''),
    iCol: text('i_col').notNull().default(''),
    opm: text('opm').notNull().default(''),
    /** Placeholder description from the phase document; display-only, never a URL. */
    linkHint: text('link_hint').notNull().default(''),
    status: text('status', { enum: ['OPEN', 'DONE', 'NA'] }).notNull().default('OPEN'),
    isCustom: integer('is_custom', { mode: 'boolean' }).notNull().default(false),
    /** Set when a submit-with-move carried this task out of that phase (WIP rows).
     *  Powers the reviewer's "moved to next phase" strikethrough rows + exports,
     *  and — with the saved origin fields below — the pull-back on reject/withdraw. */
    movedFromPhaseId: text('moved_from_phase_id'),
    movedFromStep: text('moved_from_step'),
    movedFromBlok: text('moved_from_blok'),
    movedFromPosition: integer('moved_from_position'),
  },
  (t) => ({
    byCity: index('tasks_city').on(t.cityId),
    byPhase: index('tasks_phase').on(t.phaseId),
    // A task belongs to exactly one list: a city's Gemeenteontwikkeling XOR a phase.
    listXor: check(
      'tasks_list_xor',
      sql`(${t.cityId} IS NULL) <> (${t.phaseId} IS NULL)`,
    ),
  }),
);

export const attachments = sqliteTable('attachments', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  url: text('url').notNull(),
  kind: text('kind', {
    enum: [
      'GOOGLE_DOC',
      'GOOGLE_SHEET',
      'GOOGLE_SLIDES',
      'GOOGLE_FORM',
      'DRIVE_FOLDER',
      'DRIVE_FILE',
      'WEB_LINK',
      'FILE_UPLOAD',
    ],
  }).notNull(),
  addedByUserId: text('added_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  addedByLabel: text('added_by_label').notNull(),
  addedAt: text('added_at').notNull(),
});

export const emails = sqliteTable('emails', {
  id: text('id').primaryKey(),
  event: text('event', {
    enum: [
      'DELIVERABLE_SUBMITTED',
      'APPROVAL_REQUESTED',
      'PHASE_APPROVED',
      'PHASE_REJECTED',
      'PASSWORD_RESET',
    ],
  }).notNull(),
  fromEmail: text('from_email').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  deliveredVia: text('delivered_via').notNull().default('outbox'),
  createdAt: text('created_at').notNull(),
});

export const emailRecipients = sqliteTable(
  'email_recipients',
  {
    emailId: text('email_id').notNull().references(() => emails.id, { onDelete: 'cascade' }),
    recipient: text('recipient').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.emailId, t.recipient] }) }),
);

/** Immutable template tables imported from phases.json / the source workbook. */
export const phaseTemplates = sqliteTable('phase_templates', {
  id: text('id').primaryKey(),
  idx: integer('idx').notNull().unique(), // 0 = Gemeenteontwikkeling (city phase), 1..9 projects
  sheet: text('sheet').notNull(),
  isCityPhase: integer('is_city_phase', { mode: 'boolean' }).notNull(),
});

export const taskTemplates = sqliteTable(
  'task_templates',
  {
    id: text('id').primaryKey(),
    phaseTemplateId: text('phase_template_id')
      .notNull()
      .references(() => phaseTemplates.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    sourceRow: integer('source_row').notNull(),
    step: text('step').notNull(),
    blok: text('blok').notNull(),
    deliverable: text('deliverable').notNull(),
    linkHint: text('link_hint').notNull().default(''),
    r: text('r').notNull().default(''),
    a: text('a').notNull().default(''),
    s: text('s').notNull().default(''),
    c: text('c').notNull().default(''),
    iCol: text('i_col').notNull().default(''),
    opm: text('opm').notNull().default(''),
  },
  (t) => ({ byPhase: index('task_templates_phase').on(t.phaseTemplateId) }),
);
