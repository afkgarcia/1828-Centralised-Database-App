import ExcelJS from 'exceljs';
import type { City, Phase, Task } from '@shared/types';
import { blokKey, movedOutTasks, progressOf } from '@shared/business-logic';
import { t } from '@shared/i18n';
import type { Db } from './db/client';
import { getWorld, type World } from './db/queries';

/**
 * Excel export matching the ORIGINAL phase-tracker workbook
 * (Documents/260320 fasedocument Vdef), measured per sheet with openpyxl:
 *   - Dutch header (bold Calibri 11, no fill); the `opm` J-column header exists
 *     ONLY on Gemeenteontwikkeling
 *   - a blank spacer row under the header on the 9 phase sheets; Gemeenteontwikkeling
 *     starts data at row 2 (no spacer)
 *   - column widths differ PER SHEET (SHEET_LAYOUTS below); unset columns fall to
 *     the workbook's defaultColWidth of 14.43
 *   - blank separator rows between blok groups (reproduces the original's blanks
 *     exactly on 7 of 10 sheets; the rest have minor source-side inconsistencies)
 *   - no borders, freeze panes, or autofilter
 * Tracker value added: subtle status row tints (legend on Overzicht) and live
 * document links in the original's own "Omschrijving / Link" column.
 *
 * Known deliberate deviations (for the team formatting round): our first sheet
 * is a status "Overzicht" (the original's is a "Gebruiksaanwijzing" manual), and
 * a handful of ad-hoc highlight fills in the source have no data equivalent.
 *
 * All knobs live in EXCEL_THEME / SHEET_LAYOUTS — formatting iteration should
 * only ever touch these.
 */
export const EXCEL_THEME = {
  font: { name: 'Calibri', size: 11 },
  headerBase: ['Processtap', 'Blok', 'Deliverable', 'Omschrijving / Link', 'R', 'A', 'S', 'C', 'I'],
  opmHeader: 'opm',
  defaultColWidth: 14.43,
  /** Row tints by task status (ARGB). OPEN rows stay untinted like the original. */
  fills: { DONE: 'FFE6F4EA', NA: 'FFF1F3F4' } as Record<string, string>,
  linkColor: 'FF1967D2',
  wrapColumns: [3, 4], // Deliverable + Omschrijving / Link
  /** N.v.t. rows: grey + struck through, matching the app's review screen. */
  naFont: { strike: true, color: 'FF80868B' },
  /** Rows moved out by a submit-with-move: struck through, no tint. */
  movedFont: { strike: true, color: 'FF9AA0A6' },
};

interface SheetLayout {
  widths: (number | null)[];
  hasOpm: boolean;
  spacer: boolean;
}

/** Measured column widths per original sheet (null = leave at defaultColWidth). */
export const SHEET_LAYOUTS: Record<string, SheetLayout> = {
  'Gemeenteontwikkeling': { widths: [8.86, 40.86, 74.71, 38.0, 8.86, null, null, null, null, null], hasOpm: true, spacer: false },
  'Acquisitiefase': { widths: [9.29, 36.71, 55.71, 45.71, 8.86, null, null, null, null, null], hasOpm: false, spacer: true },
  'Haalbaarheidsfase': { widths: [10.71, 55.43, 34.0, 50.86, 10.71, null, null, null, null, null], hasOpm: false, spacer: true },
  'Ontwikkelfase VO': { widths: [11.14, 37.71, 41.71, 26.86, 8.86, null, null, null, null, null], hasOpm: false, spacer: true },
  'Ontwikkelfase DO': { widths: [10.71, 62.0, 40.29, 53.43, 10.71, null, null, null, null, null], hasOpm: false, spacer: true },
  'Ontwikkelfase TO': { widths: [9.29, 45.43, 27.29, 38.71, 10.71, null, null, null, null, null], hasOpm: false, spacer: true },
  'Ontwikkelfase UO': { widths: [10.71, 32.0, 34.43, 27.0, 10.71, null, null, null, null, null], hasOpm: false, spacer: true },
  'Verkoopfase': { widths: [10.71, 42.14, 46.86, 65.0, 10.71, null, null, null, null, null], hasOpm: false, spacer: true },
  'Realisatiefase': { widths: [10.71, 36.29, 57.14, 67.14, 10.71, null, null, null, null, null], hasOpm: false, spacer: true },
  'Garantiefase': { widths: [9.43, 34.14, 44.14, 63.14, 8.29, null, null, null, null, 34.14], hasOpm: false, spacer: true },
};

const FALLBACK_LAYOUT: SheetLayout = SHEET_LAYOUTS['Acquisitiefase']!;

export interface ExportScope {
  /** Present → one workbook in the original per-project format; absent → whole portfolio. */
  projectId?: string;
}

function applyFont(cell: ExcelJS.Cell, extra?: Partial<ExcelJS.Font>): void {
  cell.font = { name: EXCEL_THEME.font.name, size: EXCEL_THEME.font.size, ...extra };
}

/** Column D carries documents when present, else the original placeholder text —
 *  an untouched task round-trips the source workbook's own wording. */
function attachmentLabel(att: Task['attachments'][number]): string {
  // Uploaded files live in the app, not at a URL — the name IS the reference.
  return att.kind === 'FILE_UPLOAD' ? `${att.name} (bijlage)` : `${att.name} — ${att.url}`;
}

function omschrijvingValue(task: Task): { text: string; hyperlink?: string } {
  if (task.attachments.length === 1) {
    const att = task.attachments[0]!;
    return {
      text: attachmentLabel(att),
      hyperlink: att.kind === 'FILE_UPLOAD' ? undefined : att.url,
    };
  }
  if (task.attachments.length > 1) {
    return { text: task.attachments.map(attachmentLabel).join('; ') };
  }
  return { text: task.linkHint };
}

/** One sheet in the original's layout: measured widths, conditional opm header,
 *  conditional spacer, blank separator rows between blok groups. */
function addPhaseSheet(
  wb: ExcelJS.Workbook,
  name: string,
  tasks: Task[],
  layoutKey: string,
  movedOut: Task[] = [],
): void {
  const layout = SHEET_LAYOUTS[layoutKey] ?? FALLBACK_LAYOUT;
  const ws = wb.addWorksheet(name);
  ws.properties.defaultColWidth = EXCEL_THEME.defaultColWidth;
  layout.widths.forEach((width, i) => {
    if (width !== null) ws.getColumn(i + 1).width = width;
  });

  const headerValues = layout.hasOpm
    ? [...EXCEL_THEME.headerBase, EXCEL_THEME.opmHeader]
    : EXCEL_THEME.headerBase;
  const header = ws.addRow(headerValues);
  header.eachCell((cell) => applyFont(cell, { bold: true }));
  if (layout.spacer) ws.addRow([]);

  let prevBlok: string | null = null;
  for (const task of tasks) {
    const key = blokKey(task);
    if (prevBlok !== null && key !== prevBlok) ws.addRow([]); // blok separator
    prevBlok = key;

    const d = omschrijvingValue(task);
    const row = ws.addRow([
      task.step,
      task.blok,
      task.deliverable,
      d.text,
      task.r,
      task.a,
      task.s,
      task.c,
      task.iCol,
      task.opm,
    ]);
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      applyFont(
        cell,
        task.status === 'NA'
          ? { strike: true, color: { argb: EXCEL_THEME.naFont.color } }
          : undefined,
      );
      if (EXCEL_THEME.wrapColumns.includes(col)) {
        cell.alignment = { wrapText: true, vertical: 'top' };
      }
      const fill = EXCEL_THEME.fills[task.status];
      if (fill) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
      }
    });
    if (d.hyperlink) {
      const cell = row.getCell(4);
      cell.value = { text: d.text, hyperlink: d.hyperlink };
      applyFont(cell, { color: { argb: EXCEL_THEME.linkColor }, underline: true });
      cell.alignment = { wrapText: true, vertical: 'top' };
    }
  }

  // Rows a submit-with-move carried to the next phase: struck through under
  // their origin sheet, so the reviewer sees what left this phase and why the
  // count changed (Ernest's export ask).
  if (movedOut.length > 0) {
    ws.addRow([]);
    const head = ws.addRow([t('reviewMoved', 'nl')]);
    applyFont(head.getCell(1), { bold: true, color: { argb: EXCEL_THEME.movedFont.color } });
    for (const task of movedOut) {
      const d = omschrijvingValue(task);
      const row = ws.addRow([
        task.step,
        task.blok,
        task.deliverable,
        d.text,
        task.r,
        task.a,
        task.s,
        task.c,
        task.iCol,
        task.opm,
      ]);
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        applyFont(cell, { strike: true, color: { argb: EXCEL_THEME.movedFont.color } });
        if (EXCEL_THEME.wrapColumns.includes(col)) {
          cell.alignment = { wrapText: true, vertical: 'top' };
        }
      });
    }
  }
}

function phaseStatusLine(label: string, phase: Phase): string {
  const status = phase.approved ? 'Goedgekeurd' : phase.submitted ? 'Ingediend' : 'Open';
  const pct = Math.round(progressOf(phase.tasks, 'all') * 100);
  return `${label} — ${status} — ${pct}%`;
}

function addOverviewSheet(wb: ExcelJS.Workbook, lines: string[]): void {
  const ws = wb.addWorksheet('Overzicht');
  ws.columns = [{ width: 90 }];
  const title = ws.addRow(['Fasedocument Tracker — Export']);
  applyFont(title.getCell(1), { bold: true, size: 14 });
  ws.addRow([]);
  for (const line of lines) applyFont(ws.addRow([line]).getCell(1));
  ws.addRow([]);
  applyFont(ws.addRow([t('exportLegendDone', 'nl')]).getCell(1));
  applyFont(ws.addRow([t('exportLegendNa', 'nl')]).getCell(1));
  applyFont(ws.addRow([t('exportLegendMoved', 'nl')]).getCell(1));
}

/** Excel tab-name rules: ≤31 chars, no \\ / ? * [ ] :, no leading/trailing
 *  apostrophe (ExcelJS throws — think 's-Gravenhage), not the reserved "History". */
function sanitizeSheetName(raw: string): string {
  let name = raw.replace(/[\\/?*[\]:]/g, '_').slice(0, 31).trim();
  name = name.replace(/^'+/, '').replace(/'+$/, '').trim();
  if (name.length === 0 || name.toLowerCase() === 'history') name = `Blad_${name}`.slice(0, 31);
  return name;
}

function makeSheetNamer(): (raw: string) => string {
  const used = new Set<string>();
  return (raw: string): string => {
    const base = sanitizeSheetName(raw);
    let name = base;
    let n = 2;
    while (used.has(name.toLowerCase())) {
      const suffix = ` ${n++}`;
      name = sanitizeSheetName(base.slice(0, 31 - suffix.length) + suffix);
    }
    used.add(name.toLowerCase());
    return name;
  };
}

/** Portfolio tab names keep the PHASE identity intact and truncate the project
 *  part instead — "Pieterskwart — Ontwikkelfase VO", never "…Ontwikkelfa 2". */
function projectPhaseTabName(projectName: string, phaseSheet: string): string {
  const suffix = ` — ${phaseSheet}`;
  const room = Math.max(31 - suffix.length, 4);
  return `${sanitizeSheetName(projectName).slice(0, room).trim()}${suffix}`;
}

function cityFor(world: World, cityId: string): City | undefined {
  return world.cities.find((c) => c.id === cityId);
}

export async function exportWorkbook(
  db: Db,
  filePath: string,
  scope: ExportScope = {},
): Promise<void> {
  const world = getWorld(db);
  const wb = new ExcelJS.Workbook();
  const today = new Date().toISOString().slice(0, 10);

  if (scope.projectId) {
    // Original per-project format: Overzicht + Gemeenteontwikkeling + the 9 phases,
    // sheet names identical to the source workbook.
    const project = world.projects.find((p) => p.id === scope.projectId);
    if (!project) throw new Error('Project niet gevonden');
    const city = cityFor(world, project.cityId);

    addOverviewSheet(wb, [
      `Project: ${project.name}${city ? ` (${city.name})` : ''}`,
      `Export: ${today}`,
      ...(city
        ? [
            `Gemeenteontwikkeling — ${city.approved ? 'Goedgekeurd' : city.submitted ? 'Ingediend' : 'Open'} — ${Math.round(progressOf(city.tasks, 'all') * 100)}%`,
          ]
        : []),
      ...project.phases.map((ph) => phaseStatusLine(`Fase ${ph.idx + 1}: ${ph.sheet}`, ph)),
    ]);
    if (city) addPhaseSheet(wb, 'Gemeenteontwikkeling', city.tasks, 'Gemeenteontwikkeling');
    for (const phase of project.phases) {
      addPhaseSheet(wb, phase.sheet, phase.tasks, phase.sheet, movedOutTasks(project, phase.id));
    }
  } else {
    // Portfolio: everything in one workbook, same per-sheet styling.
    const sheetName = makeSheetNamer();
    sheetName('overzicht'); // reserve
    addOverviewSheet(wb, [
      `Export: ${today}`,
      `Steden: ${world.cities.map((c) => c.name).join(', ')}`,
      `Projecten: ${world.projects.map((p) => p.name).join(', ')}`,
    ]);
    for (const city of world.cities) {
      addPhaseSheet(
        wb,
        sheetName(projectPhaseTabName('Gemeenteontw.', city.name)),
        city.tasks,
        'Gemeenteontwikkeling',
      );
    }
    for (const project of world.projects) {
      for (const phase of project.phases) {
        addPhaseSheet(
          wb,
          sheetName(projectPhaseTabName(project.name, phase.sheet)),
          phase.tasks,
          phase.sheet,
          movedOutTasks(project, phase.id),
        );
      }
    }
  }

  await wb.xlsx.writeFile(filePath);
}
