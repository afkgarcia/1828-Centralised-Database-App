// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, and } from 'drizzle-orm';
import phasesJson from '../../../shared/data/phases.json';
import type { PhaseTemplate } from '@shared/types';
import { movedOutTasks } from '@shared/business-logic';
import { t as tr } from '@shared/i18n';
import { openDb, type Db } from '../db/client';
import { importTemplates, seedDemoData } from '../db/seed';
import { addAttachment, decideList, setTaskStatus, submitList } from '../db/mutations';
import { getWorld } from '../db/queries';
import { exportWorkbook } from '../export';
import { buildPdfHtml } from '../pdf-html';
import * as t from '../db/schema';

/**
 * Ernest's review + export ask: a submitted phase must show — in the app, the
 * Excel and the PDF — its N.v.t. rows, its moved-to-next-phase rows, and the
 * attached documents; never just the completed ones.
 */
let db: Db;
let projectId: string;
let phase0Id: string;

beforeEach(() => {
  db = openDb(':memory:');
  const templates = phasesJson as PhaseTemplate[];
  importTemplates(db, templates);
  seedDemoData(db, templates);
  const ernestId = db.select().from(t.users).where(eq(t.users.email, 'ernest@1828.nl')).get()!.id;
  projectId = db.select().from(t.projects).where(eq(t.projects.name, 'Pieterskwartier')).get()!.id;
  phase0Id = db
    .select()
    .from(t.phases)
    .where(and(eq(t.phases.projectId, projectId), eq(t.phases.idx, 0)))
    .get()!.id;

  // Mixed outcome: most done, one N.v.t., two open (with a doc) moved to phase 2.
  const tasks = db
    .select()
    .from(t.tasks)
    .where(eq(t.tasks.phaseId, phase0Id))
    .orderBy(t.tasks.position)
    .all();
  tasks.forEach((row) => setTaskStatus(db, row.id, 'DONE'));
  setTaskStatus(db, tasks[0]!.id, 'NA');
  setTaskStatus(db, tasks[1]!.id, 'OPEN');
  setTaskStatus(db, tasks[2]!.id, 'OPEN');
  addAttachment(db, tasks[1]!.id, 'https://docs.google.com/document/d/review', null, ernestId);
  expect(submitList(db, { phaseId: phase0Id }, 'move')).toEqual({ ok: true });
});

describe('WIP rows are governed by the approval flow (Ernest)', () => {
  it('reject pulls moved rows back with their original step/blok/position', () => {
    const ernestId = db.select().from(t.users).where(eq(t.users.email, 'ernest@1828.nl')).get()!
      .id;
    const phase1Id = db
      .select()
      .from(t.phases)
      .where(and(eq(t.phases.projectId, projectId), eq(t.phases.idx, 1)))
      .get()!.id;

    // Before reject: 2 WIP rows sit atop phase 2.
    const wipBefore = db.select().from(t.tasks).where(eq(t.tasks.phaseId, phase1Id)).all()
      .filter((row) => row.step === 'WIP');
    expect(wipBefore).toHaveLength(2);
    expect(wipBefore.every((row) => row.movedFromStep !== null)).toBe(true);

    expect(decideList(db, { phaseId: phase0Id }, 'reject', ernestId)).toEqual({ ok: true });

    // After reject: back home, original step/blok restored, provenance cleared.
    const wipAfter = db
      .select()
      .from(t.tasks)
      .where(eq(t.tasks.phaseId, phase1Id))
      .all()
      .filter((row) => row.step === 'WIP');
    expect(wipAfter).toHaveLength(0);
    const origin = db
      .select()
      .from(t.tasks)
      .where(eq(t.tasks.phaseId, phase0Id))
      .orderBy(t.tasks.position)
      .all();
    const restored = origin.filter((row) => row.status === 'OPEN');
    expect(restored).toHaveLength(2);
    expect(restored.every((row) => row.step !== 'WIP' && row.movedFromPhaseId === null)).toBe(
      true,
    );
    expect(origin.map((row) => row.position)).toEqual(origin.map((_, i) => i)); // dense again

    // Approve path: resubmit with move → approve → rows STAY in phase 2.
    expect(submitList(db, { phaseId: phase0Id }, 'move')).toEqual({ ok: true });
    expect(decideList(db, { phaseId: phase0Id }, 'approve', ernestId)).toEqual({ ok: true });
    const kept = db
      .select()
      .from(t.tasks)
      .where(eq(t.tasks.phaseId, phase1Id))
      .all()
      .filter((row) => row.step === 'WIP');
    expect(kept).toHaveLength(2);
  });
});

describe('review data + exports carry NA, moved and attachments', () => {
  it('moved rows keep their origin phase id and their documents', () => {
    const world = getWorld(db);
    const project = world.projects.find((p) => p.id === projectId)!;
    const moved = movedOutTasks(project, phase0Id);
    expect(moved).toHaveLength(2);
    expect(moved.every((task) => task.step === 'WIP')).toBe(true);
    // The doc travelled along with its moved row (seed adds its own docs too).
    expect(moved.flatMap((task) => task.attachments).map((a) => a.url)).toContain(
      'https://docs.google.com/document/d/review',
    );
    // …and they are gone from the origin phase's own list
    expect(project.phases[0]!.tasks.some((task) => task.status === 'OPEN')).toBe(false);
  });

  it('Excel: origin sheet gets a struck-through moved section + NA strikethrough', async () => {
    const file = join(mkdtempSync(join(tmpdir(), '1828-exp-')), 'export.xlsx');
    await exportWorkbook(db, file, { projectId });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const sheet = wb.getWorksheet('Acquisitiefase')!;
    const cellTexts: string[] = [];
    const struckRows: string[] = [];
    sheet.eachRow((row) => {
      const first = row.getCell(1).text;
      const third = row.getCell(3).text;
      cellTexts.push(first);
      if (row.getCell(3).font?.strike) struckRows.push(third);
    });
    expect(cellTexts).toContain(tr('reviewMoved', 'nl')); // section heading present
    expect(struckRows.length).toBeGreaterThanOrEqual(3); // 1 NA row + 2 moved rows
    // Overview legend explains the strikethrough
    const overview = wb.getWorksheet('Overzicht')!;
    const legend: string[] = [];
    overview.eachRow((row) => legend.push(row.getCell(1).text));
    expect(legend).toContain(tr('exportLegendMoved', 'nl'));
  });

  it('PDF: moved rows render struck in the origin phase with their documents linked', () => {
    const html = buildPdfHtml(getWorld(db), { projectId }, 'nl');
    const movedMarker = `class="pill moved">${tr('reviewMoved', 'nl')}`;
    expect(html).toContain(movedMarker);
    expect((html.match(/tr class="moved"/g) ?? []).length).toBe(2);
    expect(html).toContain('https://docs.google.com/document/d/review'); // doc link kept
    expect(html).toContain('tr.moved .deliv { text-decoration: line-through'); // styling shipped
  });
});
