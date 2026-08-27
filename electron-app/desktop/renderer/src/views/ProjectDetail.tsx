import { useState } from 'react';
import type { City, Project, RoleFilter } from '@shared/types';
import {
  isEditLocked,
  isPhaseUnlocked,
  isReadyForSubmission,
  movedOutTasks,
  openTasks,
} from '@shared/business-logic';
import { t, type Lang } from '@shared/i18n';
import { TaskList } from '../components/TaskList';
import { ReviewPanel } from '../components/ReviewPanel';
import {
  ApprovalBanner,
  MarkAllButtons,
  SubmitDialog,
  type ListActions,
} from '../components/ListActions';

/** Project page: phase tabs + the interactive approval lifecycle per phase. */
export function ProjectDetail({
  project,
  city,
  phaseIdx,
  lang,
  filter,
  onFilterChange,
  onSelectPhase,
  onOpenUrl,
  onBack,
  onBackToCity,
  actions,
  canApprove = false,
  adminMode = false,
}: {
  project: Project;
  city: City;
  phaseIdx: number;
  lang: Lang;
  filter: RoleFilter;
  onFilterChange: (f: RoleFilter) => void;
  onSelectPhase: (idx: number) => void;
  onOpenUrl: (url: string) => void;
  onBack: () => void;
  onBackToCity: () => void;
  actions?: ListActions;
  canApprove?: boolean;
  adminMode?: boolean;
}): JSX.Element {
  const [showDialog, setShowDialog] = useState(false);
  const safeIdx = Math.min(Math.max(phaseIdx, 0), project.phases.length - 1);
  const phase = project.phases[safeIdx]!;
  const unlocked = isPhaseUnlocked(safeIdx, project.phases, city.approved);
  const locked = isEditLocked(phase);
  const openCount = openTasks(phase.tasks).length;
  const hasNextPhase = safeIdx + 1 < project.phases.length;

  const dotFor = (idx: number): string => {
    const ph = project.phases[idx]!;
    if (!isPhaseUnlocked(idx, project.phases, city.approved)) return '🔒';
    if (ph.approved) return '✅';
    if (ph.submitted) return '🟡';
    if (isReadyForSubmission(ph.tasks)) return '🟢';
    if (ph.tasks.some((task) => task.status === 'DONE')) return '🔵';
    return '⚪';
  };

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
        /{' '}
        <button type="button" onClick={onBackToCity}>
          {city.name}
        </button>{' '}
        / {project.name}
      </div>
      <h2 className="page-title">🏗️ {project.name}</h2>
      <p className="page-sub">
        {t('fase', lang)} {safeIdx + 1}: {phase.sheet}
        {unlocked && !locked && actions && (
          <span style={{ marginLeft: 12 }}>
            <MarkAllButtons lang={lang} onMarkAll={(target) => actions.markAll(target)} />
          </span>
        )}
      </p>

      <div className="card" style={{ marginTop: 14 }}>
        <div className="phase-tabs">
          {project.phases.map((ph, idx) => {
            const phUnlocked = isPhaseUnlocked(idx, project.phases, city.approved);
            const cls = `ptab${idx === safeIdx ? ' active' : ''}${ph.approved ? ' approved' : ''}`;
            return (
              <button
                key={ph.id}
                type="button"
                className={cls}
                disabled={!phUnlocked}
                data-testid="phase-tab"
                onClick={() => onSelectPhase(idx)}
              >
                {dotFor(idx)} {idx + 1}. {ph.sheet}
              </button>
            );
          })}
        </div>

        {!unlocked ? (
          <div className="lock-note" data-testid="lock-note">
            <div className="icon" aria-hidden>
              🔒
            </div>
            <p style={{ fontWeight: 700 }}>{t('lockedTitle', lang)}</p>
            <p className="muted">
              {safeIdx === 0
                ? t('cityLockedMsg', lang).replace('{city}', city.name)
                : t('lockedSub', lang)}
            </p>
          </div>
        ) : (
          <>
            <ApprovalBanner
              flags={phase}
              openCount={openCount}
              lang={lang}
              canApprove={canApprove}
              kind="phase"
              onSubmitClick={handleSubmitClick}
              onDecide={(action) => actions?.decide(action)}
            />
            {phase.submitted || phase.approved ? (
              /* Ernest's review screen: row-by-row status, clickable documents,
                 moved-to-next-phase rows struck through. */
              <ReviewPanel
                tasks={phase.tasks}
                movedOut={movedOutTasks(project, phase.id)}
                lang={lang}
                onOpen={onOpenUrl}
              />
            ) : (
              <TaskList
                tasks={phase.tasks}
                lang={lang}
                filter={filter}
                onFilterChange={onFilterChange}
                onOpen={onOpenUrl}
                locked={locked}
                onSetStatus={actions ? (id, s) => actions.setTaskStatus(id, s) : undefined}
                onAddAttachment={
                  actions
                    ? (taskId, url, name) => actions.addAttachment(taskId, url, name)
                    : undefined
                }
                onAttachFile={actions ? (taskId, file) => actions.attachFile(taskId, file) : undefined}
                onRemoveAttachment={actions ? (id) => actions.removeAttachment(id) : undefined}
                adminMode={adminMode}
                structureActions={actions}
              />
            )}
          </>
        )}
      </div>

      {showDialog && (
        <SubmitDialog
          openCount={openCount}
          allowMove={hasNextPhase}
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
