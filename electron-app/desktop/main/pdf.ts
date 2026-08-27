import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserWindow } from 'electron';
import type { Lang } from '@shared/i18n';
import type { Db } from './db/client';
import { getWorld } from './db/queries';
import type { ExportScope } from './export';
import { buildPdfHtml } from './pdf-html';

/** Electron half of the PDF export: renders the pure HTML report through an
 *  offscreen window's printToPDF. The HTML itself lives in pdf-html.ts. */
export async function exportPdf(

  db: Db,
  filePath: string,
  scope: ExportScope,
  lang: Lang,
): Promise<void> {
  const html = buildPdfHtml(getWorld(db), scope, lang);
  const tempDir = mkdtempSync(join(tmpdir(), 'tracker-pdf-'));
  const tempHtml = join(tempDir, 'report.html');
  writeFileSync(tempHtml, html, 'utf8');

  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  try {
    await win.loadFile(tempHtml);
    const buffer = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.5, bottom: 0.6, left: 0.5, right: 0.5 },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="width:100%;text-align:center;font-size:7pt;color:#5F6368;">' +
        '<span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    });
    writeFileSync(filePath, buffer);
  } finally {
    win.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  }
}
