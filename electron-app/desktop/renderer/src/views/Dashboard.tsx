import { useEffect, useState } from 'react';
import type { City, Project } from '@shared/types';
import { openTaskCountAcross, pendingCitySubmissions, pendingPhaseSubmissions, progressOf } from '@shared/business-logic';
import { t, type Lang } from '@shared/i18n';
import { api, isWeb, type OutboxItem } from '../services/api';
import { NamePromptDialog } from '../components/ListActions';

/** Drive-style landing page: stats strip, owner approval queue, city tile grid. */
export function Dashboard({
  cities,
  projects,
  lang,
  canApprove = false,
  onOpenCity,
  onOpenProject,
  onCreateCity,
  emptyNotice,
  viewerUserId,
  onOpenOutbox,
}: {
  cities: City[];
  projects: Project[];
  lang: Lang;
  canApprove?: boolean;
  onOpenCity: (cityId: string) => void;
  onOpenProject?: (projectId: string, phaseIdx: number) => void;
  /** Present only for owners (Kotlin: `+ Stad` is owner-only). */
  onCreateCity?: (name: string) => void;
  /** Kotlin DashboardView empty states: no cities at all vs none accessible. */
  emptyNotice?: 'noCities' | 'noAccessibleCities';
  /** Enables the Kotlin recent-notifications feed (5 latest, viewer-scoped). */
  viewerUserId?: string;
  onOpenOutbox?: () => void;
}): JSX.Element {
  const [showExport, setShowExport] = useState(false);
  const [askCityName, setAskCityName] = useState(false);
  const [recentMail, setRecentMail] = useState<OutboxItem[]>([]);
  useEffect(() => {
    if (!viewerUserId) return;
    api
      .listOutbox(viewerUserId)
      .then((items) => setRecentMail(items.slice(0, 5)))
      .catch(() => setRecentMail([]));
  }, [viewerUserId]);
  const allLists = [
    ...cities.map((c) => c.tasks),
    ...projects.flatMap((p) => p.phases.map((ph) => ph.tasks)),
  ];
  const openCount = openTaskCountAcross(allLists, 'all');
  const pendingCities = pendingCitySubmissions(cities);
  const pendingPhases = pendingPhaseSubmissions(projects);
  const pendingCount = pendingCities.length + pendingPhases.length;

  return (
    <div className="page">
      <h2 className="page-title">
        {t('dashboardTitle', lang)}
        {onCreateCity && (
          <button
            type="button"
            className="btn-quiet"
            style={{ marginLeft: 12, verticalAlign: 'middle' }}
            data-testid="add-city"
            onClick={() => setAskCityName(true)}
          >
            {t('addCity', lang)}
          </button>
        )}
      </h2>
      <p className="page-sub">{t('dashboardSub', lang)}</p>

      <div className="stats">
        <Stat value={cities.length} label={t('cities', lang)} />
        <Stat value={projects.length} label={t('projects', lang)} />
        <Stat value={openCount} label={t('statOpenTasks', lang)} />
        {canApprove && <Stat value={pendingCount} label={t('statPendingApprovals', lang)} />}
        <Stat
          value={allLists.flat().filter((task) => task.attachments.length > 0).length}
          label={t('statLink', lang)}
        />
        <div className="stat-tile" style={{ display: 'flex', alignItems: 'center' }}>
          <button
            type="button"
            className="btn-primary"
            style={{ marginTop: 0 }}
            data-testid="export-open"
            onClick={() => setShowExport(true)}
          >
            {t('exportTitle', lang)}
          </button>
        </div>
      </div>

      {askCityName && onCreateCity && (
        <NamePromptDialog
          label={t('namePromptCity', lang)}
          lang={lang}
          onSubmit={(name) => {
            setAskCityName(false);
            onCreateCity(name);
          }}
          onCancel={() => setAskCityName(false)}
        />
      )}

      {showExport && (
        <ExportDialog
          projects={projects}
          lang={lang}
          allowPortfolio={!isWeb || canApprove}
          isOwner={canApprove}
          onClose={() => setShowExport(false)}
        />
      )}

      {canApprove && pendingCount > 0 && (
        <>
          <h3 className="section-heading">{t('dashApprovalsHeading', lang)}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pendingCities.map((city) => (
              <div key={city.id} className="card" style={{ padding: '10px 14px' }} data-testid="queue-row">
                🏙️ <strong>{city.name}</strong> · Gemeenteontwikkeling{' '}
                <button
                  type="button"
                  className="btn-quiet"
                  onClick={() => onOpenCity(city.id)}
                >
                  {t('openProject', lang)}
                </button>
              </div>
            ))}
            {pendingPhases.map(({ project, phaseIdx, phase }) => (
              <div
                key={phase.id}
                className="card"
                style={{ padding: '10px 14px' }}
                data-testid="queue-row"
              >
                🏗️ <strong>{project.name}</strong> · {t('fase', lang)} {phaseIdx + 1}:{' '}
                {phase.sheet}{' '}
                <button
                  type="button"
                  className="btn-quiet"
                  onClick={() => onOpenProject?.(project.id, phaseIdx)}
                >
                  {t('openProject', lang)}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {recentMail.length > 0 && (
        <>
          <h3 className="section-heading">{t('dashActivityHeading', lang)}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {recentMail.map((m) => (
              <div key={m.id} className="muted" data-testid="activity-row">
                {m.subject} · {new Date(m.createdAt).toLocaleString()}
              </div>
            ))}
            {onOpenOutbox && (
              <button
                type="button"
                className="link-btn"
                style={{ alignSelf: 'flex-start' }}
                onClick={onOpenOutbox}
              >
                {t('viewAll', lang)}
              </button>
            )}
          </div>
        </>
      )}

      <h3 className="section-heading">{t('cities', lang)}</h3>
      {cities.length === 0 && emptyNotice && (
        <p className="muted" data-testid="empty-notice">
          {t(emptyNotice, lang)}
        </p>
      )}
      <div className="tile-grid">
        {cities.map((city) => {
          const cityProjects = projects.filter((p) => p.cityId === city.id);
          const applicable = city.tasks.filter((task) => task.status !== 'NA');
          const done = applicable.filter((task) => task.status === 'DONE').length;
          const icon = city.approved ? '✅' : city.submitted ? '🟡' : '🏙️';
          const word =
            cityProjects.length === 1 ? t('projectCountOne', lang) : t('projectCount', lang);
          return (
            <button
              key={city.id}
              type="button"
              className="tile"
              data-testid="city-tile"
              onClick={() => onOpenCity(city.id)}
            >
              <div className="icon" aria-hidden>
                {icon}
              </div>
              <div className="title">{city.name}</div>
              <div className="meta">
                {cityProjects.length} {word}
              </div>
              <div className="meta">
                Gemeenteontwikkeling · {done}/{applicable.length}
              </div>
              <div className="progress city">
                <div style={{ width: `${progressOf(city.tasks, 'all') * 100}%` }} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }): JSX.Element {
  return (
    <div className="stat-tile">
      <div className="stat-val">{value}</div>
      <div className="stat-lbl">{label}</div>
    </div>
  );
}

/** Format (Excel/PDF) + scope (portfolio or one project) picker. A per-project
 *  Excel export reproduces Ernest's original workbook sheet-for-sheet. */
function ExportDialog({
  projects,
  lang,
  allowPortfolio = true,
  isOwner = false,
  onClose,
}: {
  projects: Project[];
  lang: Lang;
  /** Web: the server only serves the portfolio export to owner/all-access users. */
  allowPortfolio?: boolean;
  /** Drive connect/upload is owner-only (files land in the connected account). */
  isOwner?: boolean;
  onClose: () => void;
}): JSX.Element {
  const [scope, setScope] = useState<string>(allowPortfolio ? 'all' : (projects[0]?.id ?? ''));
  const [drive, setDrive] = useState<'unconfigured' | 'disconnected' | 'connected'>('unconfigured');
  useEffect(() => {
    if (!isOwner) return;
    api
      .driveStatus()
      .then((s) => setDrive(s.status))
      .catch(() => setDrive('unconfigured'));
  }, [isOwner]);

  const runDrive = (): void => {
    if (scope === 'all') return; // Drive export is per project
    void api
      .exportDrive(scope)
      .then((result) => {
        if (result.ok) {
          window.alert(`${t('driveExportDone', lang)} ${result.fileName ?? ''}`);
          if (result.link) void api.openExternal(result.link);
          onClose();
        } else if (result.error === 'NOT_CONNECTED') {
          window.alert(t('driveNotConnected', lang));
          setDrive('disconnected');
        } else {
          window.alert(`${t('exportFailed', lang)} ${result.error ?? ''}`);
        }
      })
      .catch((e: unknown) => {
        window.alert(`${t('exportFailed', lang)} ${e instanceof Error ? e.message : String(e)}`);
      });
  };

  const run = (format: 'xlsx' | 'pdf'): void => {
    const exportScope = scope === 'all' ? {} : { projectId: scope };
    const call =
      format === 'xlsx' ? api.exportExcel(exportScope) : api.exportPdf(exportScope, lang);
    void call
      .then((result) => {
        if (result.ok && result.path) {
          window.alert(`${t('exportSuccess', lang)} ${result.path}`);
          onClose();
        } else if (result.error) {
          window.alert(`${t('exportFailed', lang)} ${result.error}`);
        }
        // canceled → keep the dialog open
      })
      .catch((e: unknown) => {
        window.alert(`${t('exportFailed', lang)} ${e instanceof Error ? e.message : String(e)}`);
      });
  };

  return (
    <div className="modal-bg" role="dialog" aria-modal="true">
      <div className="modal" data-testid="export-dialog">
        <h3>{t('exportTitle', lang)}</h3>
        <p className="muted">{t('exportDesc', lang)}</p>
        <label className="field-label">
          {t('exportScopeLabel', lang)}
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            {allowPortfolio && <option value="all">{t('exportScopeAll', lang)}</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <div className="modal-actions">
          <button type="button" className="btn-quiet" onClick={onClose}>
            {t('cancel', lang)}
          </button>
          {!isWeb && (
            <button
              type="button"
              className="btn-quiet"
              data-testid="export-pdf"
              onClick={() => run('pdf')}
            >
              {t('exportPdfBtn', lang)}
            </button>
          )}
          {isOwner && drive === 'disconnected' && (
            <button
              type="button"
              className="btn-quiet"
              data-testid="drive-connect"
              onClick={() => void api.driveConnect().then(() => api.driveStatus().then((s) => setDrive(s.status)))}
            >
              {t('driveConnectBtn', lang)}
            </button>
          )}
          {isOwner && drive === 'connected' && scope !== 'all' && (
            <button
              type="button"
              className="btn-quiet"
              data-testid="drive-export"
              onClick={runDrive}
            >
              {t('driveExportBtn', lang)}
            </button>
          )}
          <button
            type="button"
            className="btn-primary"
            style={{ marginTop: 0 }}
            data-testid="export-excel"
            onClick={() => run('xlsx')}
          >
            {t('exportBtn', lang)}
          </button>
        </div>
      </div>
    </div>
  );
}
