import { beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { eq } from 'drizzle-orm';
import phasesJson from '../../../shared/data/phases.json';
import type { PhaseTemplate } from '@shared/types';
import { openDb, type Db } from '../db/client';
import { addProject, importTemplates, seedDemoData } from '../db/seed';
import { exportWorkbook, EXCEL_THEME } from '../export';
import { buildPdfHtml } from '../pdf-html';
import { getWorld } from '../db/queries';
import * as s from '../db/schema';

const templates = phasesJson as PhaseTemplate[];

const ORIGINAL_SHEETS = [
  'Overzicht',
  'Gemeenteontwikkeling',
  'Acquisitiefase',
  'Haalbaarheidsfase',
  'Ontwikkelfase VO',
  'Ontwikkelfase DO',
  'Ontwikkelfase TO',
  'Ontwikkelfase UO',
  'Verkoopfase',
  'Realisatiefase',
  'Garantiefase',
];

let db: Db;
let pieterskwartierId: string;

beforeEach(() => {
  db = openDb(':memory:');
  importTemplates(db, templates);
  seedDemoData(db, templates);
  pieterskwartierId = db
    .select()
    .from(s.projects)
    .where(eq(s.projects.name, 'Pieterskwartier'))
    .get()!.id;
});

describe('Excel export — original phase-tracker format (measured from the source workbook)', () => {
  it('per-project export reproduces the original sheet names and layout', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'tracker-export-')), 'project.xlsx');
    await exportWorkbook(db, file, { projectId: pieterskwartierId });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    expect(wb.worksheets.map((ws) => ws.name)).toEqual(ORIGINAL_SHEETS);

    const acq = wb.getWorksheet('Acquisitiefase')!;
    // Original phase-sheet layout: Dutch 9-column header (NO 'opm' — that column
    // header exists only on Gemeenteontwikkeling), spacer row 2, data from row 3
    expect(acq.getRow(1).values).toEqual([
      undefined,
      'Processtap', 'Blok', 'Deliverable', 'Omschrijving / Link', 'R', 'A', 'S', 'C', 'I',
    ]);
    expect(acq.getRow(1).getCell(1).font?.bold).toBe(true);
    expect(acq.getRow(1).getCell(1).font?.name).toBe('Calibri');
    // No header fill (ExcelJS reads empty fills back as pattern:'none')
    const headerFill = acq.getRow(1).getCell(1).fill as { pattern?: string };
    expect(headerFill?.pattern ?? 'none').not.toBe('solid');
    expect(acq.getRow(2).actualCellCount).toBe(0); // spacer
    expect(acq.getRow(3).getCell(1).text).toBe('1.4'); // first Acquisitie step
    // 27 tasks + 7 blok-separator blanks = the original's exact last row (36)
    expect(acq.rowCount).toBe(36);

    // Measured per-sheet column widths from the source workbook (hardcoded here,
    // deliberately NOT read from EXCEL_THEME, so theme drift is caught)
    expect(acq.getColumn(1).width).toBeCloseTo(9.29, 1);
    expect(acq.getColumn(3).width).toBeCloseTo(55.71, 1);
    expect(acq.getColumn(4).width).toBeCloseTo(45.71, 1);

    // Column D: seeded attachment becomes a live link with "name — url" text
    const dCell = acq.getRow(3).getCell(4);
    const v = dCell.value as { text?: string; hyperlink?: string };
    expect(v.text).toContain('Acquisitie-map — https://');
    expect(v.hyperlink).toContain('drive.google.com');
    // A row without attachments round-trips the original placeholder text —
    // including the source workbook's own typo ('v erkoopvoorwaarden')
    expect(acq.getRow(7).getCell(4).text).toBe('Link naar v erkoopvoorwaarden');

    // Different phase sheet uses ITS OWN measured widths (Haalbaarheidsfase B=55.43)
    const haal = wb.getWorksheet('Haalbaarheidsfase')!;
    expect(haal.getColumn(2).width).toBeCloseTo(55.43, 1);
    expect(haal.getColumn(3).width).toBeCloseTo(34.0, 1);

    // Gemeenteontwikkeling: the original's OWN layout — no spacer (data at row 2),
    // 'opm' header present, C width 74.71; seeded DONE → status tint
    const gem = wb.getWorksheet('Gemeenteontwikkeling')!;
    expect(gem.getRow(1).getCell(10).text).toBe('opm');
    expect(gem.getRow(2).getCell(1).text).toBe('1.1'); // no spacer row
    expect(gem.getColumn(3).width).toBeCloseTo(74.71, 1);
    // 26 tasks + 2 blok-separator blanks
    expect(gem.rowCount).toBe(1 + 26 + 2);
    const fill = gem.getRow(2).getCell(1).fill as { fgColor?: { argb?: string } };
    expect(fill?.fgColor?.argb).toBe(EXCEL_THEME.fills['DONE']);
    // Open rows stay untinted, like the original
    const acqFill = acq.getRow(3).getCell(1).fill as { pattern?: string };
    expect(acqFill?.pattern ?? 'none').not.toBe('solid');
    // Unset columns fall to the original's sheet default width
    expect(gem.properties.defaultColWidth).toBeCloseTo(14.43, 1);

    // Overzicht carries phase status lines + the color legend
    const overzicht = wb.getWorksheet('Overzicht')!;
    const texts: string[] = [];
    overzicht.eachRow((row) => texts.push(row.getCell(1).text));
    expect(texts.some((line) => line.includes('Fase 1: Acquisitiefase'))).toBe(true);
    expect(texts.some((line) => line.includes('Groen = klaar'))).toBe(true);
  });

  it('portfolio export: Overzicht + 3 city sheets + 27 phase sheets, unique ≤31-char names', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'tracker-export-')), 'all.xlsx');
    await exportWorkbook(db, file, {});
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    expect(wb.worksheets).toHaveLength(1 + 3 + 27);
    const names = wb.worksheets.map((ws) => ws.name);
    expect(names[0]).toBe('Overzicht');
    expect(names).toContain('Gemeenteontw. — Leiden');
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
    expect(names.every((n) => n.length <= 31)).toBe(true);
    // Truncation keeps the PHASE identity and shortens the project part instead
    expect(names.filter((n) => n.endsWith('Ontwikkelfase VO'))).toHaveLength(3);
    expect(names.filter((n) => n.endsWith('Ontwikkelfase DO'))).toHaveLength(3);
  });

  it("regression: Dutch names with apostrophes ('s-Gravenhage) export without crashing", async () => {
    const leidenId = db.select().from(s.cities).where(eq(s.cities.name, 'Leiden')).get()!.id;
    addProject(db, templates, "'s-Gravenhage Binckhorst", leidenId, 9);
    const file = join(mkdtempSync(join(tmpdir(), 'tracker-export-')), 'apos.xlsx');
    await exportWorkbook(db, file, {});
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const names = wb.worksheets.map((ws) => ws.name);
    expect(names.some((n) => n.includes('s-Gravenhage'))).toBe(true);
    expect(names.every((n) => !n.startsWith("'") && !n.endsWith("'"))).toBe(true);
  });

  it('unknown project id throws a clear error', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'tracker-export-')), 'x.xlsx');
    await expect(exportWorkbook(db, file, { projectId: 'ghost' })).rejects.toThrow(
      'Project niet gevonden',
    );
  });
});

describe('PDF export — HTML report builder', () => {
  it('per-project report contains the city section, all 9 phases, pills, docs and no scripts', () => {
    const html = buildPdfHtml(getWorld(db), { projectId: pieterskwartierId }, 'nl');
    expect(html).toContain('1828 · Fasedocument rapport');
    expect(html).toContain('Pieterskwartier (Leiden)');
    expect(html).toContain('Gemeenteontwikkeling — Leiden');
    for (const sheet of ORIGINAL_SHEETS.slice(2)) expect(html).toContain(sheet);
    // Status pills + progress
    expect(html).toContain('class="pill done"');
    expect(html).toContain('Voortgang: 100%'); // Leiden seeded complete
    // Seeded document as a link
    expect(html).toContain('href="https://drive.google.com/drive/folders/1PieterskwartierAcquisitie"');
    // Print rules + self-contained
    expect(html).toContain('break-before: page');
    expect(html).toContain('break-inside: avoid');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('src=');
    expect(html).not.toContain('<link');
  });

  it('portfolio report covers every city and project; HTML-escapes content', () => {
    // Inject a name that must be escaped
    db.update(s.tasks)
      .set({ deliverable: 'Kaart <en> "details"' })
      .where(eq(s.tasks.step, '1.4'))
      .run();
    const html = buildPdfHtml(getWorld(db), {}, 'en');
    for (const name of ['Leiden', 'Amsterdam', 'Utrecht', 'Pieterskwartier', 'Sloterdijk Noord', 'Utrecht Oost']) {
      expect(html).toContain(name);
    }
    expect(html).toContain('Kaart &lt;en&gt; &quot;details&quot;');
    expect(html).not.toContain('Kaart <en>');
    expect(html).toContain('Phase document report'); // EN i18n
    expect(html).toContain('<th class="step">Step</th>'); // localized table headers
  });
});
