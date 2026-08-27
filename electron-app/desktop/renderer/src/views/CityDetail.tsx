import { useState } from 'react';
import type { City, Project, RoleFilter } from '@shared/types';
import { isEditLocked, openTasks } from '@shared/business-logic';
import { t, type Lang } from '@shared/i18n';
import { TaskList } from '../components/TaskList';
import { ReviewPanel } from '../components/ReviewPanel';
import {
  ApprovalBanner,
  MarkAllButtons,
  SubmitDialog,
  type ListActions,
  NamePromptDialog,
} from '../components/ListActions';

/** City page: Gemeenteontwikkeling with the full approval lifecycle + projects grid.
 *  The city gate: projects stay locked until this list is approved. */
export function CityDetail({
  city,
  projects,
  lang,
  filter,
  onFilterChange,
  onOpenProject,
  onOpenUrl,
  onBack,
  actions,
  canApprove = false,
  adminMode = false,
  onCreateProject,
}: {
  city: City;
  projects: Project[];
  lang: Lang;
  filter: RoleFilter;
  onFilterChange: (f: RoleFilter) => void;
  onOpenProject: (projectId: string) => void;
  onOpenUrl: (url: string) => void;
  onBack: () => void;
  actions?: ListActions;
  canApprove?: boolean;
  adminMode?: boolean;
  /** Kotlin parity: every user who can open the city page may add a project. */
  onCreateProject?: (name: string) => void;
}): JSX.Element {
  const [showDialog, setShowDialog] = useState(false);
  const [askProjectName, setAskProjectName] = useState(false);
  const locked = isEditLocked(city);
  const applicable = city.tasks.filter((task) => task.status !== 'NA');
  const done = applicable.filter((task) => task.status === 'DONE').length;
  const naCount = city.tasks.length - applicable.length;
  const openCount = openTasks(city.tasks).length;

  const handleSubmitClick = (): void => {
    if (!actions) return;
    if (openCount === 0) actions.submit();
    else setShowDialog(true);
  };

  return (
    <div className="page">
      <div className="crumbs">
        <button type="button" onClick={onBack}>
          {t('dashboardTitle', lang)}
        </button>{' '}
        / {city.name}
      </div>
      <h2 className="page-title">🏙️ {city.name}</h2>
      <p className="page-sub">
        Gemeenteontwikkeling · {done} {t('of', lang)} {applicable.length} {t('applicable', lang)}{' '}
        · {naCount} {t('statNa', lang)}
        {!locked && actions && (
          <span style={{ marginLeft: 12 }}>
            <MarkAllButtons lang={lang} onMarkAll={(target) => actions.markAll(target)} />
          </span>
        )}
      </p>

      <div className="card" style={{ marginTop: 14 }}>
        <ApprovalBanner
          flags={city}
          openCount={openCount}
          lang={lang}
          canApprove={canApprove}
          kind="city"
          onSubmitClick={handleSubmitClick}
          onDecide={(action) => actions?.decide(action)}
        />
        {city.submitted || city.approved ? (
          /* Reviewer's screen for a submitted Gemeenteontwikkeling (no moved
             rows — cities have no next phase). */
          <ReviewPanel tasks={city.tasks} lang={lang} onOpen={onOpenUrl} />
        ) : (
        <TaskList
          tasks={city.tasks}
          lang={lang}
          filter={filter}
          onFilterChange={onFilterChange}
          onOpen={onOpenUrl}
          locked={locked}
          onSetStatus={actions ? (id, s) => actions.setTaskStatus(id, s) : undefined}
          onAddAttachment={
            actions ? (taskId, url, name) => actions.addAttachment(taskId, url, name) : undefined
          }
          onAttachFile={actions ? (taskId, file) => actions.attachFile(taskId, file) : undefined}
          onRemoveAttachment={actions ? (id) => actions.removeAttachment(id) : undefined}
          adminMode={adminMode}
          structureActions={actions}
        />
        )}
      </div>

      <h3 className="section-heading">
        {t('projectsInCity', lang)} {city.name}
        {onCreateProject && (
          <button
            type="button"
            className="btn-quiet"
            style={{ marginLeft: 12 }}
            data-testid="add-project"
            onClick={() => setAskProjectName(true)}
          >
            {t('addProject', lang)}
          </button>
        )}
        {!city.approved && <span className="muted"> — 🔒 {t('cityGateHint', lang)}</span>}
      </h3>
      <div className="tile-grid">
        {projects.length === 0 && <p className="muted">{t('noProjectsInCity', lang)}</p>}
        {projects.map((project) => {
          const approvedCount = project.phases.filter((ph) => ph.approved).length;
          const allTasks = project.phases.flatMap((ph) => ph.tasks);
          const applicableP = allTasks.filter((task) => task.status !== 'NA');
          const doneP = applicableP.filter((task) => task.status === 'DONE').length;
          const icon = !city.approved
            ? '🔒'
            : approvedCount === project.phases.length
              ? '🏁'
              : approvedCount > 0
                ? '🔵'
                : '🏗️';
          return (
            <button
              key={project.id}
              type="button"
              className="tile"
              data-testid="project-tile"
              title={
                city.approved ? undefined : t('cityLockedMsg', lang).replace('{city}', city.name)
              }
              onClick={() => onOpenProject(project.id)}
            >
              <div className="icon" aria-hidden>
                {icon}
              </div>
              <div className="title">{project.name}</div>
              <div className="meta">
                {approvedCount}/{project.phases.length} {t('phaseLabel', lang)}n · {doneP}/
                {applicableP.length} {t('tasks', lang)}
              </div>
              <div className="progress">
                <div
                  style={{
                    width: `${applicableP.length === 0 ? 0 : (doneP / applicableP.length) * 100}%`,
                  }}
                />
              </div>
            </button>
          );
        })}
      </div>

      {askProjectName && onCreateProject && (
        <NamePromptDialog
          label={t('namePromptProject', lang)}
          lang={lang}
          onSubmit={(name) => {
            setAskProjectName(false);
            onCreateProject(name);
          }}
          onCancel={() => setAskProjectName(false)}
        />
      )}

      {showDialog && (
        <SubmitDialog
          openCount={openCount}
          allowMove={false}
          lang={lang}
          onChoose={(choice) => {
            setShowDialog(false);
            actions?.submit(choice);
          }}
          onCancel={() => setShowDialog(false)}
        />
      )}
    </div>
  );
}
