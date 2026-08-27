import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { count, eq as sqlEq } from 'drizzle-orm';
import type { PhaseTemplate } from '@shared/types';
import { detectDriveKind, normalizeUrl, tokenizeRasciCell } from '@shared/business-logic';
import type { Db } from './client';
import * as t from './schema';

const now = () => new Date().toISOString();

export interface ImportReport {
  phases: number;
  tasks: number;
  linkHints: number;
  rasciTokenHistogram: Record<string, number>;
  rasciAnomalies: string[];
}

/** Known RASCI role tokens; anything else in the source data is reported, not rejected. */
const KNOWN_TOKENS = new Set(['OWNER', 'PM', 'OM', 'PO', 'PPM', 'MT']);

/** Imports phases.json into the immutable template tables. Idempotent (skips when
 *  present) and atomic — a mid-run failure leaves no partial template set behind. */
export function importTemplates(db: Db, templates: PhaseTemplate[]): ImportReport {
  return db.transaction(() => importTemplatesInner(db, templates));
}

function importTemplatesInner(db: Db, templates: PhaseTemplate[]): ImportReport {
  const histogram: Record<string, number> = {};
  const anomalies = new Set<string>();
  let taskCount = 0;
  let linkHints = 0;

  const existing = db.select({ n: count() }).from(t.phaseTemplates).get();
  const alreadyImported = (existing?.n ?? 0) > 0;

  templates.forEach((ph, idx) => {
    const phaseId = randomUUID();
    if (!alreadyImported) {
      db.insert(t.phaseTemplates)
        .values({ id: phaseId, idx, sheet: ph.sheet, isCityPhase: idx === 0 })
        .run();
    }
    ph.tasks.forEach((task, position) => {
      taskCount++;
      if (task.existingLink.trim().length > 0) linkHints++;
      for (const cell of [task.r, task.a, task.s, task.c, task.i]) {
        for (const token of tokenizeRasciCell(cell)) {
          histogram[token] = (histogram[token] ?? 0) + 1;
          if (!KNOWN_TOKENS.has(token)) anomalies.add(token);
        }
      }
      if (!alreadyImported) {
        db.insert(t.taskTemplates)
          .values({
            id: randomUUID(),
            phaseTemplateId: phaseId,
            position,
            sourceRow: task.row,
            step: task.step,
            blok: task.blok,
            deliverable: task.deliverable,
            linkHint: task.existingLink, // display hint, never a URL (MIGRATION_NOTES §1.7.1)
            r: task.r,
            a: task.a,
            s: task.s,
            c: task.c,
            iCol: task.i,
            opm: task.opm,
          })
          .run();
      }
    });
  });

  return {
    phases: templates.length,
    tasks: taskCount,
    linkHints,
    rasciTokenHistogram: histogram,
    rasciAnomalies: [...anomalies].sort(),
  };
}

function instantiateTasks(
  db: Db,
  templates: PhaseTemplate,
  target: { cityId: string } | { phaseId: string },
): void {
  templates.tasks.forEach((tmpl, position) => {
    db.insert(t.tasks)
      .values({
        id: randomUUID(),
        cityId: 'cityId' in target ? target.cityId : null,
        phaseId: 'phaseId' in target ? target.phaseId : null,
        position,
        step: tmpl.step,
        blok: tmpl.blok,
        deliverable: tmpl.deliverable,
        r: tmpl.r,
        a: tmpl.a,
        s: tmpl.s,
        c: tmpl.c,
        iCol: tmpl.i,
        opm: tmpl.opm,
        linkHint: tmpl.existingLink,
        status: 'OPEN',
        isCustom: false,
      })
      .run();
  });
}

export function addCity(db: Db, templates: PhaseTemplate[], name: string, position: number): string {
  const id = randomUUID();
  db.insert(t.cities).values({ id, name, position, createdAt: now() }).run();
  instantiateTasks(db, templates[0]!, { cityId: id });
  return id;
}

export function addProject(
  db: Db,
  templates: PhaseTemplate[],
  name: string,
  cityId: string,
  position: number,
): string {
  const id = randomUUID();
  db.insert(t.projects).values({ id, cityId, name, position, createdAt: now() }).run();
  templates.slice(1).forEach((ph, idx) => {
    const phaseId = randomUUID();
    db.insert(t.phases).values({ id: phaseId, projectId: id, idx, sheet: ph.sheet }).run();
    instantiateTasks(db, ph, { phaseId });
  });
  return id;
}

/**
 * Demo seeds — identical world to the Kotlin app (decision Q4):
 * Ernest/Pia/Niels, Leiden/Amsterdam/Utrecht, one project per city,
 * 4 demo attachments, Leiden fully done + pre-approved.
 */
export function seedDemoData(db: Db, templates: PhaseTemplate[]): void {
  db.transaction(() => seedDemoDataInner(db, templates));
}

function seedDemoDataInner(db: Db, templates: PhaseTemplate[]): void {
  // Atomic (see transaction above), so guarding on either table is safe; check
  // both anyway so a future partial world never re-triggers the user inserts.
  const cityCount = db.select({ n: count() }).from(t.cities).get()?.n ?? 0;
  const userCount = db.select({ n: count() }).from(t.users).get()?.n ?? 0;
  if (cityCount > 0 || userCount > 0) return;

  const hash = (pw: string) => bcrypt.hashSync(pw, 10);
  const ernestId = randomUUID();
  const piaId = randomUUID();
  const nielsId = randomUUID();

  db.insert(t.users)
    .values([
      {
        id: ernestId,
        email: 'ernest@1828.nl',
        passwordHash: hash('ernest'),
        displayName: 'Ernest',
        role: 'OWNER',
        status: 'ACTIVE',
        accessAllCities: true,
        createdAt: now(),
      },
      {
        id: piaId,
        email: 'pia@1828.nl',
        passwordHash: hash('test'),
        displayName: 'Pia (PM)',
        role: 'PM',
        status: 'ACTIVE',
        accessAllCities: false,
        createdAt: now(),
      },
      {
        id: nielsId,
        email: 'niels@1828.nl',
        passwordHash: hash('test'),
        displayName: 'Niels (OM)',
        role: 'OM',
        status: 'PENDING',
        accessAllCities: false,
        createdAt: now(),
      },
    ])
    .run();

  const leidenId = addCity(db, templates, 'Leiden', 0);
  const amsterdamId = addCity(db, templates, 'Amsterdam', 1);
  const utrechtId = addCity(db, templates, 'Utrecht', 2);
  addProject(db, templates, 'Pieterskwartier', leidenId, 0);
  addProject(db, templates, 'Sloterdijk Noord', amsterdamId, 1);
  addProject(db, templates, 'Utrecht Oost', utrechtId, 2);

  db.insert(t.userCityAccess).values({ userId: piaId, cityId: leidenId }).run();

  const attach = (taskId: string, url: string, name: string, userId: string, label: string) => {
    const normalized = normalizeUrl(url);
    db.insert(t.attachments)
      .values({
        id: randomUUID(),
        taskId,
        name,
        url: normalized,
        kind: detectDriveKind(normalized),
        addedByUserId: userId,
        addedByLabel: label,
        addedAt: now(),
      })
      .run();
  };

  const leidenTasks = db
    .select()
    .from(t.tasks)
    .where(sqlEq(t.tasks.cityId, leidenId))
    .orderBy(t.tasks.position)
    .all();
  attach(
    leidenTasks[0]!.id,
    'https://docs.google.com/spreadsheets/d/1G40LijstVerrijkt2026/edit',
    'G40 lijst verrijkt',
    ernestId,
    'Ernest',
  );
  attach(
    leidenTasks[1]!.id,
    'https://docs.google.com/document/d/1AnalyseWoonvisieLeiden/edit',
    'Analyse woonvisie Leiden',
    piaId,
    'Pia (PM)',
  );

  const pieterskwartier = db.select().from(t.projects).where(sqlEq(t.projects.name, 'Pieterskwartier')).get()!;
  const phase0 = db
    .select()
    .from(t.phases)
    .where(sqlEq(t.phases.projectId, pieterskwartier.id))
    .orderBy(t.phases.idx)
    .all()[0]!;
  const phase0Tasks = db
    .select()
    .from(t.tasks)
    .where(sqlEq(t.tasks.phaseId, phase0.id))
    .orderBy(t.tasks.position)
    .all();
  attach(
    phase0Tasks[0]!.id,
    'https://drive.google.com/drive/folders/1PieterskwartierAcquisitie',
    'Acquisitie-map',
    piaId,
    'Pia (PM)',
  );
  attach(
    phase0Tasks[1]!.id,
    'https://docs.google.com/presentation/d/1PitchGemeenteLeiden/edit',
    'Pitch gemeente Leiden',
    piaId,
    'Pia (PM)',
  );

  // Leiden: Gemeenteontwikkeling finished and approved → Pieterskwartier immediately workable.
  db.update(t.tasks).set({ status: 'DONE' }).where(sqlEq(t.tasks.cityId, leidenId)).run();
  db.update(t.cities).set({ approved: true }).where(sqlEq(t.cities.id, leidenId)).run();
}
