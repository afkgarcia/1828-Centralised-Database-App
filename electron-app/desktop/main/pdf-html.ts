import type { City, Phase, Task } from '@shared/types';
import { movedOutTasks, progressOf } from '@shared/business-logic';
import { t, type Lang } from '@shared/i18n';
import type { World } from './db/queries';
import type { ExportScope } from './export';

/**
 * PDF export: a print-designed HTML report rendered through Chromium's
 * printToPDF (no extra dependencies, full CSS control). The HTML builder is a
 * pure function so its content is unit-testable without Electron.
 *
 * Design: the app's own language — brand navy band, Workspace neutrals, status
 * pills, thin progress bars. Every phase starts on a fresh page; rows never
 * split across pages. Self-contained: no scripts, no external resources.
 */

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function statusPill(status: Task['status'], lang: Lang): string {
  const cls = status === 'DONE' ? 'done' : status === 'NA' ? 'na' : 'open';
  const label =
    status === 'DONE' ? t('statDone', lang) : status === 'NA' ? t('statNa', lang) : t('statOpen', lang);
  return `<span class="pill ${cls}">${esc(label)}</span>`;
}

function docsCell(task: Task): string {
  if (task.attachments.length === 0) {
    return task.linkHint ? `<span class="hint">${esc(task.linkHint)}</span>` : '';
  }
  return task.attachments
    .map((a) =>
      // Same scheme gate as the app's open-external IPC: only web URLs get a link.
      /^https?:\/\//i.test(a.url)
        ? `<a href="${esc(a.url)}">${esc(a.name)}</a>`
        : `<span>${esc(a.name)}</span>`,
    )
    .join('<br/>');
}

function taskTable(tasks: Task[], lang: Lang, movedOut: Task[] = []): string {
  const rows = tasks
    .map((task) => {
      const rasci = [task.r && `R:${task.r}`, task.a && `A:${task.a}`, task.s && `S:${task.s}`, task.c && `C:${task.c}`]
        .filter(Boolean)
        .join(' · ');
      return `<tr class="${task.status.toLowerCase()}">
        <td class="step">${esc(task.step)}</td>
        <td class="deliv">${esc(task.deliverable)}<div class="rasci">${esc(rasci)}</div></td>
        <td class="status">${statusPill(task.status, lang)}</td>
        <td class="docs">${docsCell(task)}</td>
      </tr>`;
    })
    .join('\n');
  const movedRows = movedOut
    .map(
      (task) => `<tr class="moved">
        <td class="step">${esc(task.step)}</td>
        <td class="deliv">${esc(task.deliverable)}</td>
        <td class="status"><span class="pill moved">${esc(t('reviewMoved', lang))}</span></td>
        <td class="docs">${docsCell(task)}</td>
      </tr>`,
    )
    .join('\n');
  return `<table>
    <thead><tr>
      <th class="step">${esc(t('pdfColStep', lang))}</th>
      <th class="deliv">${esc(t('pdfColDeliverable', lang))}</th>
      <th class="status">${esc(t('pdfColStatus', lang))}</th>
      <th class="docs">${esc(t('mailDocs', lang))}</th>
    </tr></thead>
    <tbody>${rows}${movedRows}</tbody>
  </table>`;
}

function sectionHeader(title: string, flags: { submitted: boolean; approved: boolean }, tasks: Task[], lang: Lang): string {
  const pct = Math.round(progressOf(tasks, 'all') * 100);
  const statusKey = flags.approved
    ? 'pdfStatusApproved'
    : flags.submitted
      ? 'pdfStatusSubmitted'
      : 'pdfStatusInProgress';
  const cls = flags.approved ? 'done' : flags.submitted ? 'submitted' : 'open';
  return `<div class="section-head">
    <h2>${esc(title)}</h2>
    <span class="pill ${cls}">${esc(t(statusKey, lang))}</span>
    <span class="pct">${esc(t('pdfProgress', lang))}: ${pct}%</span>
    <div class="bar"><div style="width:${pct}%"></div></div>
  </div>`;
}

function citySection(city: City, lang: Lang, first: boolean): string {
  return `<section class="${first ? 'first' : ''}">
    ${sectionHeader(`Gemeenteontwikkeling — ${city.name}`, city, city.tasks, lang)}
    ${taskTable(city.tasks, lang)}
  </section>`;
}

function phaseSection(projectName: string, phase: Phase, lang: Lang, movedOut: Task[]): string {
  return `<section>
    ${sectionHeader(`${projectName} — ${t('fase', lang)} ${phase.idx + 1}: ${phase.sheet}`, phase, phase.tasks, lang)}
    ${taskTable(phase.tasks, lang, movedOut)}
  </section>`;
}

const CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 9.5pt; color: #202124; }
  .band { background: #1A1A2E; color: #fff; padding: 14pt 18pt; border-radius: 4pt; }
  .band h1 { font-size: 16pt; }
  .band .meta { color: rgba(255,255,255,.75); font-size: 9pt; margin-top: 3pt; }
  section { break-before: page; padding-top: 10pt; }
  section.first, section:first-of-type { break-before: auto; }
  .section-head { margin: 8pt 0 6pt; }
  .section-head h2 { font-size: 12pt; display: inline; margin-right: 8pt; }
  .pct { color: #5F6368; font-size: 8.5pt; margin-left: 8pt; }
  .bar { height: 4pt; background: #E8EAED; border-radius: 2pt; margin-top: 5pt; }
  .bar > div { height: 100%; background: #2A9D8F; border-radius: 2pt; }
  table { width: 100%; border-collapse: collapse; margin-top: 4pt; }
  th { text-align: left; font-size: 8pt; text-transform: uppercase; letter-spacing: .04em;
       color: #5F6368; border-bottom: 1.2pt solid #1A1A2E; padding: 3pt 5pt; }
  td { border-bottom: 0.6pt solid #E8EAED; padding: 4pt 5pt; vertical-align: top; }
  tr { break-inside: avoid; }
  tr.done td { background: #F2FAF5; }
  tr.na td { background: #F5F6F7; color: #80868B; }
  tr.na .deliv { text-decoration: line-through; }
  tr.moved td { color: #9AA0A6; background: #FAFAFA; }
  tr.moved .deliv { text-decoration: line-through; font-weight: 400; }
  .pill.moved { background: #F1F3F4; color: #5F6368; }
  .step { width: 8%; font-variant-numeric: tabular-nums; }
  .status { width: 12%; }
  .docs { width: 26%; font-size: 8.5pt; }
  .deliv { font-weight: 600; }
  .rasci { font-weight: 400; color: #5F6368; font-size: 8pt; margin-top: 1pt; }
  .pill { display: inline-block; border-radius: 8pt; padding: 1pt 6pt; font-size: 8pt; font-weight: 700; }
  .pill.done { background: #E6F4EA; color: #188038; }
  .pill.na { background: #E8EAED; color: #3C4043; }
  .pill.open { background: #FEF7E0; color: #B06000; }
  .pill.submitted { background: #FEF3C7; color: #92400E; }
  a { color: #1967D2; text-decoration: none; }
  .hint { color: #80868B; font-style: italic; }
`;

export function buildPdfHtml(world: World, scope: ExportScope, lang: Lang): string {
  const today = new Date().toISOString().slice(0, 10);
  let subtitle: string;
  let body: string;

  if (scope.projectId) {
    const project = world.projects.find((p) => p.id === scope.projectId);
    if (!project) throw new Error('Project niet gevonden');
    const city = world.cities.find((c) => c.id === project.cityId);
    subtitle = `${project.name}${city ? ` (${city.name})` : ''}`;
    body = [
      ...(city ? [citySection(city, lang, true)] : []),
      ...project.phases.map((phase) => phaseSection(project.name, phase, lang, movedOutTasks(project, phase.id))),
    ].join('\n');
  } else {
    subtitle = t('exportScopeAll', lang);
    body = [
      ...world.cities.map((city, i) => citySection(city, lang, i === 0)),
      ...world.projects.flatMap((project) =>
        project.phases.map((phase) =>
          phaseSection(project.name, phase, lang, movedOutTasks(project, phase.id)),
        ),
      ),
    ].join('\n');
  }

  return `<!doctype html>
<html lang="${lang}">
<head><meta charset="utf-8"><style>${CSS}</style></head>
<body>
  <div class="band">
    <h1>1828 · ${esc(t('pdfReportTitle', lang))}</h1>
    <div class="meta">${esc(subtitle)} — ${esc(t('pdfGeneratedOn', lang))} ${today}</div>
  </div>
  ${body}
</body>
</html>`;
}

