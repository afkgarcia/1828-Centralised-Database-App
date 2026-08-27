import { useState } from 'react';
import type { ApprovalFlags, TaskStatus } from '@shared/types';
import { t, type Lang } from '@shared/i18n';
import type { DecideAction } from '../services/api';

/** Callbacks a task list (city Gemeenteontwikkeling or project phase) exposes to views. */
export interface ListActions {
  setTaskStatus(taskId: string, status: TaskStatus): void;
  markAll(target: 'DONE' | 'OPEN'): void;
  submit(choice?: 'na' | 'move'): void;
  decide(action: DecideAction): void;
  addAttachment(taskId: string, url: string, name: string | null): void;
  attachFile(taskId: string, file?: File): void;
  removeAttachment(attachmentId: string): void;
  /** Admin mode (owner): custom rows + reorder — guarded again in the main process. */
  addCustomRow(blokKey: string, deliverable: string): void;
  deleteCustomRow(taskId: string): void;
  moveBlok(blokKey: string, dir: -1 | 1): void;
  moveTask(taskId: string, dir: -1 | 1): void;
}

/**
 * Single-field name dialog (Kotlin TextInputDialog parity). Electron has no
 * window.prompt — calling it throws — so every name entry goes through this.
 * Blank input confirms to a silent abort, like the Kotlin dialogs.
 */
export function NamePromptDialog({
  label,
  lang,
  onSubmit,
  onCancel,
}: {
  label: string;
  lang: Lang;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}): JSX.Element {
  const [name, setName] = useState('');
  const confirm = (): void => {
    const trimmed = name.trim();
    if (trimmed.length === 0) onCancel();
    else onSubmit(trimmed);
  };
  return (
    <div className="modal-bg" role="dialog" aria-modal="true">
      <form
        className="modal"
        data-testid="name-prompt"
        onSubmit={(e) => {
          e.preventDefault();
          confirm();
        }}
      >
        <label className="field-label">
          {label}
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="modal-actions">
          <button type="button" className="btn-quiet" onClick={onCancel}>
            {t('cancel', lang)}
          </button>
          <button type="submit" className="btn-primary" style={{ marginTop: 0 }}>
            {t('confirm', lang)}
          </button>
        </div>
      </form>
    </div>
  );
}

export function MarkAllButtons({
  lang,
  onMarkAll,
}: {
  lang: Lang;
  onMarkAll: (target: 'DONE' | 'OPEN') => void;
}): JSX.Element {
  return (
    <span style={{ display: 'inline-flex', gap: 8 }}>
      <button type="button" className="btn-quiet" onClick={() => onMarkAll('DONE')}>
        {t('btnMarkAll', lang)}
      </button>
      <button type="button" className="btn-quiet" onClick={() => onMarkAll('OPEN')}>
        {t('btnUnmarkAll', lang)}
      </button>
    </span>
  );
}

/**
 * Approval banner with actions (Kotlin buildApprovalBanner / buildCityBanner parity):
 * submit always visible on an active list; owner sees approve/reject on submitted
 * and reopen on approved; the submitter can withdraw.
 */
export function ApprovalBanner({
  flags,
  openCount,
  lang,
  canApprove,
  kind,
  onSubmitClick,
  onDecide,
}: {
  flags: ApprovalFlags;
  openCount: number;
  lang: Lang;
  canApprove: boolean;
  /** Cities announce "Gemeenteontwikkeling goedgekeurd"; phases "Fase goedgekeurd". */
  kind: 'city' | 'phase';
  onSubmitClick: () => void;
  onDecide: (action: DecideAction) => void;
}): JSX.Element {
  const approvedTitleKey = kind === 'city' ? 'cityApprovedTitle' : 'approvedTitle';
  const approvedDescKey = kind === 'city' ? 'cityApprovedDesc' : 'approvedDesc';
  if (flags.approved) {
    return (
      <div className="banner approved" data-testid="approval-banner">
        ✅ {t(approvedTitleKey, lang)}. {t(approvedDescKey, lang)}{' '}
        {canApprove && (
          <button type="button" className="btn-quiet" onClick={() => onDecide('reopen')}>
            {t('reopenPhase', lang)}
          </button>
        )}
      </div>
    );
  }
  if (flags.submitted) {
    return (
      <div className="banner submitted" data-testid="approval-banner">
        🟡 {t('submittedTitle', lang)}. {t('submittedDesc', lang)}{' '}
        {canApprove ? (
          <>
            <button
              type="button"
              className="btn-primary"
              style={{ marginTop: 0 }}
              onClick={() => onDecide('approve')}
            >
              {t('approvePhase', lang)}
            </button>{' '}
            <button type="button" className="btn-quiet" onClick={() => onDecide('reject')}>
              {t('rejectPhase', lang)}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn-quiet" onClick={() => onDecide('withdraw')}>
              {t('withdraw', lang)}
            </button>{' '}
            <span className="muted">{t('needsApprover', lang)}</span>
          </>
        )}
      </div>
    );
  }
  const ready = openCount === 0;
  return (
    <div className={`banner ${ready ? 'ready' : 'open'}`} data-testid="approval-banner">
      {ready
        ? `${t('readyTitle', lang)} ${t('readyDesc', lang)}`
        : t('notReadyBanner', lang).replace('{n}', String(openCount))}{' '}
      <button
        type="button"
        className="btn-primary"
        style={{ marginTop: 0 }}
        onClick={onSubmitClick}
      >
        {t('submitForApproval', lang)}
      </button>
    </div>
  );
}

/**
 * Two-step unfinished-task dialog: proceed confirmation, then the N/A-or-move
 * choice (move only when a next phase exists — never on cities or the last phase).
 */
export function SubmitDialog({
  openCount,
  allowMove,
  lang,
  onChoose,
  onCancel,
}: {
  openCount: number;
  allowMove: boolean;
  lang: Lang;
  onChoose: (choice: 'na' | 'move') => void;
  onCancel: () => void;
}): JSX.Element {
  const [step, setStep] = useState<1 | 2>(1);
  return (
    <div className="modal-bg" role="dialog" aria-modal="true">
      <div className="modal" data-testid="submit-dialog">
        {step === 1 ? (
          <>
            <p>{t('unfinishedPrompt', lang).replace('{n}', String(openCount))}</p>
            <div className="modal-actions">
              <button type="button" className="btn-quiet" onClick={onCancel}>
                {t('cancel', lang)}
              </button>
              <button
                type="button"
                className="btn-primary"
                style={{ marginTop: 0 }}
                onClick={() => setStep(2)}
              >
                {t('btnProceed', lang)}
              </button>
            </div>
          </>
        ) : (
          <>
            <p>{t('unfinishedChoice', lang).replace('{n}', String(openCount))}</p>
            <div className="modal-actions">
              <button type="button" className="btn-quiet" onClick={onCancel}>
                {t('cancel', lang)}
              </button>
              <button type="button" className="btn-quiet" onClick={() => onChoose('na')}>
                {t('optMarkNa', lang)}
              </button>
              {allowMove && (
                <button
                  type="button"
                  className="btn-primary"
                  style={{ marginTop: 0 }}
                  onClick={() => onChoose('move')}
                >
                  {t('optMoveNext', lang)}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
