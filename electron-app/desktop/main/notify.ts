import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import type { NotifyEvent, User } from '@shared/types';
import {
  recipientsForApprovalRequested,
  recipientsForCityDecision,
  recipientsForDeliverableSubmitted,
  recipientsForPhaseDecision,
  subjectKeyFor,
} from '@shared/business-logic';
import { format, t, type Lang } from '@shared/i18n';
import type { Db } from './db/client';
import * as s from './db/schema';

/**
 * Notification delivery (Kotlin EmailService + Notifications parity):
 * every message is recorded in the emails tables and written as an .eml file;
 * real SMTP sends only when <dataDir>/smtp.json enables it. Composition uses
 * the caller's active UI language, like the Kotlin app.
 */

let dataDir = '';
export function initNotify(dir: string): void {
  dataDir = dir;
  mkdirSync(join(dataDir, 'outbox'), { recursive: true });
}
export function outboxDir(): string {
  return join(dataDir, 'outbox');
}

function nowStamp(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function listSafeUsers(db: Db): User[] {
  const rows = db.select().from(s.users).all();
  const cityGrants = db.select().from(s.userCityAccess).all();
  const projectGrants = db.select().from(s.userProjectAccess).all();
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    status: row.status,
    accessAllCities: row.accessAllCities,
    cityAccess: cityGrants.filter((g) => g.userId === row.id).map((g) => g.cityId),
    projectAccess: projectGrants.filter((g) => g.userId === row.id).map((g) => g.projectId),
  }));
}

interface SendInput {
  event: NotifyEvent;
  from: string;
  to: string[];
  subject: string;
  body: string;
}

function record(db: Db, input: SendInput): void {
  if (input.to.length === 0) return;
  const emailId = randomUUID();
  db.insert(s.emails)
    .values({
      id: emailId,
      event: input.event,
      fromEmail: input.from,
      subject: input.subject,
      body: input.body,
      deliveredVia: 'outbox',
      createdAt: new Date().toISOString(),
    })
    .run();
  for (const recipient of input.to) {
    db.insert(s.emailRecipients).values({ emailId, recipient }).run();
  }
  try {
    writeEml(input);
  } catch {
    /* .eml write is best-effort */
  }
  void trySmtp(db, emailId, input);
}

/**
 * Password-reset code mail — through the same record → .eml → SMTP pipeline as
 * every other notification. (It used to be written straight into the outbox
 * table by auth.ts and never actually sent, even with SMTP configured.)
 */
export function sendPasswordResetEmail(db: Db, to: string, code: string, lang: Lang = 'nl'): void {
  record(db, {
    event: 'PASSWORD_RESET',
    from: 'noreply@1828.nl',
    to: [to],
    subject: format('subjReset', {}, lang),
    body: `${format('mailResetIntro', {}, lang)}\n\n    ${code}\n\n${format('mailResetIgnore', {}, lang)}\n`,
  });
}

/** RFC-822 style .eml with an RFC 2047 base64 subject (emoji-safe). */
function writeEml(input: SendInput): void {
  if (!dataDir) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const slug = input.subject.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40).replace(/^_+|_+$/g, '');
  const encSubject = `=?UTF-8?B?${Buffer.from(input.subject, 'utf8').toString('base64')}?=`;
  const content = [
    `From: ${input.from}`,
    `To: ${input.to.join(', ')}`,
    `Subject: ${encSubject}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    input.body,
  ].join('\r\n');
  writeFileSync(join(outboxDir(), `${stamp}_${slug}.eml`), content, 'utf8');
}

interface SmtpConfig {
  enabled: boolean;
  host: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
  from?: string;
}

function smtpConfig(): SmtpConfig | null {
  if (!dataDir) return null;
  const file = join(dataDir, 'smtp.json');
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as SmtpConfig;
  } catch {
    return null;
  }
}

async function trySmtp(db: Db, emailId: string, input: SendInput): Promise<void> {
  const cfg = smtpConfig();
  if (!cfg?.enabled) return;
  const mark = (via: string): void => {
    db.update(s.emails).set({ deliveredVia: via }).where(eq(s.emails.id, emailId)).run();
  };
  try {
    const transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port ?? 587,
      secure: cfg.secure ?? false,
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass ?? '' } : undefined,
    });
    await transport.sendMail({
      from: cfg.from ?? input.from,
      to: input.to.join(', '),
      subject: input.subject,
      text: input.body,
    });
    mark('SMTP ✓');
  } catch (e) {
    mark(`SMTP ✗ (${e instanceof Error ? e.message.slice(0, 60) : 'error'})`);
  }
}

// ── Event composers (Kotlin Notifications parity) ───────────────────────────

interface TaskLine {
  deliverable: string;
  attachments: { name: string; url: string }[];
}

export function notifyDeliverablesSubmitted(
  db: Db,
  actor: User,
  contextLabel: string,
  tasks: TaskLine[],
  lang: Lang,
): void {
  if (tasks.length === 0) return;
  const to = recipientsForDeliverableSubmitted(listSafeUsers(db));
  const subject =
    tasks.length === 1
      ? format('subjSubmitted1', { task: tasks[0]!.deliverable.slice(0, 70) }, lang)
      : format('subjSubmittedN', { n: tasks.length, ctx: contextLabel }, lang);
  const lines: string[] = [
    tasks.length === 1
      ? t('mailSubmittedIntro1', lang)
      : format('mailSubmittedIntroN', { n: tasks.length }, lang),
    '',
    `${t('lblContext', lang)}: ${contextLabel}`,
    `${t('mailBy', lang)}: ${actor.displayName} <${actor.email}>`,
    `${t('mailWhen', lang)}: ${nowStamp()}`,
    '',
  ];
  for (const task of tasks) {
    lines.push(`• ${task.deliverable}`);
    for (const att of task.attachments) lines.push(`   ↳ ${att.name} — ${att.url}`);
  }
  record(db, { event: 'DELIVERABLE_SUBMITTED', from: actor.email, to, subject, body: lines.join('\n') + '\n' });
}

export interface ApprovalCtx {
  projectName?: string;
  cityName: string;
  phaseLabel?: string; // "2. Haalbaarheidsfase"
  docs: { name: string; url: string }[];
}

export function notifyApprovalRequested(db: Db, actor: User, ctx: ApprovalCtx, lang: Lang): void {
  const to = recipientsForApprovalRequested(listSafeUsers(db));
  const isCity = ctx.projectName === undefined;
  const subject = isCity
    ? format(subjectKeyFor('APPROVAL_REQUESTED', { city: true }), { city: ctx.cityName }, lang)
    : format(
        subjectKeyFor('APPROVAL_REQUESTED', {}),
        { project: ctx.projectName!, phase: ctx.phaseLabel ?? '' },
        lang,
      );
  const lines: string[] = [
    isCity
      ? format('mailCityApprovalIntro', { user: actor.displayName }, lang)
      : format('mailApprovalIntro', { user: actor.displayName }, lang),
    '',
  ];
  if (isCity) lines.push(`${t('lblCity', lang)}: ${ctx.cityName}`);
  else {
    lines.push(`${t('lblProject', lang)}: ${ctx.projectName} (${ctx.cityName})`);
    lines.push(`${t('lblPhase', lang)}: ${ctx.phaseLabel}`);
  }
  lines.push(`${t('mailWhen', lang)}: ${nowStamp()}`);
  if (ctx.docs.length > 0) {
    lines.push('', `${t('mailDocs', lang)} (${ctx.docs.length}):`);
    for (const d of ctx.docs) lines.push(`• ${d.name} — ${d.url}`);
  }
  lines.push('', t('mailAction', lang));
  record(db, { event: 'APPROVAL_REQUESTED', from: actor.email, to, subject, body: lines.join('\n') + '\n' });
}

export interface DecisionCtx {
  projectRef?: { id: string; cityId: string };
  projectName?: string;
  cityId: string;
  cityName: string;
  phaseLabel?: string;
  nextPhaseLabel?: string; // absent on the last phase
}

export function notifyDecision(
  db: Db,
  actor: User,
  ctx: DecisionCtx,
  approved: boolean,
  lang: Lang,
): void {
  const users = listSafeUsers(db);
  const allProjects = db
    .select()
    .from(s.projects)
    .all()
    .map((p) => ({ id: p.id, cityId: p.cityId }));
  const to = ctx.projectRef
    ? recipientsForPhaseDecision(users, ctx.projectRef)
    : recipientsForCityDecision(users, ctx.cityId, allProjects);
  const isCity = ctx.projectRef === undefined;
  const event: NotifyEvent = approved ? 'PHASE_APPROVED' : 'PHASE_REJECTED';
  const subject = isCity
    ? format(subjectKeyFor(event, { city: true }), { city: ctx.cityName }, lang)
    : format(
        subjectKeyFor(event, {}),
        { project: ctx.projectName!, phase: ctx.phaseLabel ?? '' },
        lang,
      );
  const introKey = isCity
    ? approved
      ? 'mailCityApprovedIntro'
      : 'mailCityRejectedIntro'
    : approved
      ? 'mailApprovedIntro'
      : 'mailRejectedIntro';
  const lines: string[] = [format(introKey, { user: actor.displayName }, lang), ''];
  if (isCity) lines.push(`${t('lblCity', lang)}: ${ctx.cityName}`);
  else {
    lines.push(`${t('lblProject', lang)}: ${ctx.projectName} (${ctx.cityName})`);
    lines.push(`${t('lblPhase', lang)}: ${ctx.phaseLabel}`);
  }
  lines.push(`${t('mailWhen', lang)}: ${nowStamp()}`);
  if (!isCity && approved) {
    lines.push(
      '',
      ctx.nextPhaseLabel
        ? format('mailNextPhase', { phase: ctx.nextPhaseLabel }, lang)
        : t('mailLastPhase', lang),
    );
  }
  record(db, { event, from: actor.email, to, subject, body: lines.join('\n') + '\n' });
}

// ── Outbox queries ──────────────────────────────────────────────────────────

export interface OutboxItem {
  id: string;
  event: NotifyEvent;
  from: string;
  to: string[];
  subject: string;
  body: string;
  deliveredVia: string;
  createdAt: string;
}

/**
 * Owner sees all workflow mail but NOT other people's password-reset codes
 * (fixes the audited leak §1.7.8 instead of porting it); colleagues see only
 * mail addressed to them. Newest first.
 */
export function listOutbox(db: Db, viewer: User): OutboxItem[] {
  const rows = db.select().from(s.emails).all();
  const rcpts = db.select().from(s.emailRecipients).all();
  const byEmail = new Map<string, string[]>();
  for (const r of rcpts) {
    const list = byEmail.get(r.emailId) ?? [];
    list.push(r.recipient);
    byEmail.set(r.emailId, list);
  }
  const isOwner = viewer.role === 'OWNER';
  return rows
    .map((row) => ({
      id: row.id,
      event: row.event,
      from: row.fromEmail,
      to: byEmail.get(row.id) ?? [],
      subject: row.subject,
      body: row.body,
      deliveredVia: row.deliveredVia,
      createdAt: row.createdAt,
    }))
    .filter((m) => {
      const addressedToViewer = m.to.includes(viewer.email);
      if (m.event === 'PASSWORD_RESET') return addressedToViewer;
      return isOwner || addressedToViewer;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
