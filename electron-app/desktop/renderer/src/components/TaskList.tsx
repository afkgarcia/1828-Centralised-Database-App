import { useMemo, useState } from 'react';
import type { Attachment, RoleFilter, Task, TaskStatus, UserRole } from '@shared/types';
import { blokKey, relevantTasks } from '@shared/business-logic';
import { t, type Lang } from '@shared/i18n';
import { api, isWeb } from '../services/api';
import { NamePromptDialog } from './ListActions';
import type { ListActions } from './ListActions';

/** The subset of ListActions the admin-mode structure controls need. */
type StructureActions = Pick<
  ListActions,
  'addCustomRow' | 'deleteCustomRow' | 'moveBlok' | 'moveTask'
>;

const ROLE_CHIPS: UserRole[] = ['OM', 'PO', 'PM', 'PPM', 'MT'];

const KIND_ICON: Record<Attachment['kind'], string> = {
  GOOGLE_DOC: '📄',
  GOOGLE_SHEET: '📊',
  GOOGLE_SLIDES: '📽',
  GOOGLE_FORM: '📝',
  DRIVE_FOLDER: '📁',
  DRIVE_FILE: '🗂',
  WEB_LINK: '🔗',
  FILE_UPLOAD: '📎',
};

/** Kotlin AttachmentUi.kindLabel: Google kinds are literal, Drive/web via i18n. */
function kindLabel(kind: Attachment['kind'], lang: Lang): string {
  switch (kind) {
    case 'GOOGLE_DOC':
      return 'Google Doc';
    case 'GOOGLE_SHEET':
      return 'Google Sheet';
    case 'GOOGLE_SLIDES':
      return 'Google Slides';
    case 'GOOGLE_FORM':
      return 'Google Form';
    case 'DRIVE_FOLDER':
      return t('kindFolder', lang);
    case 'DRIVE_FILE':
      return t('kindFile', lang);
    case 'FILE_UPLOAD':
      return t('kindUpload', lang);
    default:
      return t('kindLink', lang);
  }
}

export function DocChip({
  att,
  lang = 'nl',
  onOpen,
  onRemove,
}: {
  att: Attachment;
  lang?: Lang;
  onOpen: (url: string) => void;
  onRemove?: (attachmentId: string) => void;
}): JSX.Element {
  return (
    <span className="doc-chip" title={`${kindLabel(att.kind, lang)} · ${att.url}\n${att.addedByLabel}`}>
      <button
        type="button"
        className="link-btn"
        style={{ color: 'inherit', fontWeight: 400 }}
        onClick={() =>
          att.kind === 'FILE_UPLOAD' ? void api.openUploadedAttachment(att.id) : onOpen(att.url)
        }
      >
        <span aria-hidden>{KIND_ICON[att.kind]}</span> {att.name}
      </button>
      {onRemove && (
        <button
          type="button"
          className="link-btn"
          aria-label="remove"
          data-testid="remove-attachment"
          style={{ color: '#5f6368' }}
          onClick={() => onRemove(att.id)}
        >
          ✕
        </button>
      )}
    </span>
  );
}

/** Interactive tri-state check: click cycles open ↔ done; from N/A it clears back to open. */
function StatusBox({
  status,
  disabled,
  onSet,
}: {
  status: TaskStatus;
  disabled: boolean;
  onSet?: (status: TaskStatus) => void;
}): JSX.Element {
  const cls =
    status === 'DONE' ? 'status-box done' : status === 'NA' ? 'status-box na' : 'status-box';
  const glyph = status === 'DONE' ? '✓' : status === 'NA' ? '⊘' : '';
  const next: TaskStatus = status === 'OPEN' ? 'DONE' : 'OPEN';
  return (
    <button
      type="button"
      className={cls}
      aria-label={status}
      data-testid="status-box"
      disabled={disabled || !onSet}
      onClick={() => onSet?.(next)}
    >
      {glyph}
    </button>
  );
}

function TaskRow({
  task,
  lang,
  locked,
  onSetStatus,
  onOpen,
  onAddAttachment,
  onRemoveAttachment,
  onMove,
  moveUpDisabled = true,
  moveDownDisabled = true,
  onDelete,
}: {
  task: Task;
  lang: Lang;
  locked: boolean;
  onSetStatus?: (taskId: string, status: TaskStatus) => void;
  onOpen: (url: string) => void;
  onAddAttachment?: (taskId: string) => void;
  onRemoveAttachment?: (attachmentId: string) => void;
  /** Admin mode: reorder within the blok (Kotlin: boundary buttons disabled). */
  onMove?: (dir: -1 | 1) => void;
  moveUpDisabled?: boolean;
  moveDownDisabled?: boolean;
  /** Admin mode: delete, custom rows only — and unlike Kotlin, never when locked. */
  onDelete?: () => void;
}): JSX.Element {
  const rowCls = `task-row${task.status === 'DONE' ? ' done' : task.status === 'NA' ? ' na' : ''}`;
  return (
    <div className={rowCls} data-testid="task-row">
      <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
        <StatusBox
          status={task.status}
          disabled={locked}
          onSet={onSetStatus ? (s) => onSetStatus(task.id, s) : undefined}
        />
        <button
          type="button"
          className={`role-chip${task.status === 'NA' ? ' active' : ''}`}
          style={{ fontSize: '0.77rem', padding: '1px 7px' }}
          disabled={locked || !onSetStatus}
          data-testid="na-toggle"
          onClick={() => onSetStatus?.(task.id, task.status === 'NA' ? 'OPEN' : 'NA')}
        >
          {t('naLabel', lang)}
        </button>
      </span>
      <div className="task-main">
        <div className="name">
          {task.deliverable}
          {task.custom && <span className="rasci c"> {t('customTag', lang)}</span>}
          {task.movedFromPhaseId && (
            <span className="rasci a" data-testid="wip-badge" title={t('reviewMoved', lang)}>
              {' '}WIP
            </span>
          )}
        </div>
        <div className="chips">
          {task.r && <span className="rasci r">R: {task.r}</span>}
          {task.a && <span className="rasci a">A: {task.a}</span>}
          {task.s && <span className="rasci s">S: {task.s}</span>}
          {task.c && <span className="rasci c">C: {task.c}</span>}
        </div>
        {task.linkHint && <div className="link-hint">{task.linkHint}</div>}
        {(task.attachments.length > 0 || (!locked && onAddAttachment)) && (
          <div className="chips">
            {task.attachments.map((att) => (
              <DocChip
                key={att.id}
                att={att}
                lang={lang}
                onOpen={onOpen}
                onRemove={!locked && onRemoveAttachment ? onRemoveAttachment : undefined}
              />
            ))}
            {!locked && onAddAttachment && (
              <button
                type="button"
                className="role-chip"
                data-testid="add-attachment"
                onClick={() => onAddAttachment(task.id)}
              >
                {t('addDocument', lang)}
              </button>
            )}
          </div>
        )}
      </div>
      {(onMove || onDelete) && (
        <span className="task-aside">
          {onMove && (
            <span style={{ display: 'inline-flex', flexDirection: 'column' }}>
              <button
                type="button"
                className="reorder-btn"
                data-testid="task-up"
                disabled={moveUpDisabled}
                onClick={() => onMove(-1)}
              >
                ▲
              </button>
              <button
                type="button"
                className="reorder-btn"
                data-testid="task-down"
                disabled={moveDownDisabled}
                onClick={() => onMove(1)}
              >
                ▼
              </button>
            </span>
          )}
          {onDelete && (
            <button
              type="button"
              className="reorder-btn"
              data-testid="task-delete"
              aria-label="delete"
              onClick={onDelete}
            >
              🗑
            </button>
          )}
        </span>
      )}
    </div>
  );
}

/** URL + optional-name dialog for linking a document (Kotlin promptAttach parity). */
function AttachDialog({
  lang,
  onSubmit,
  onAttachFile,
  onCancel,
}: {
  lang: Lang;
  onSubmit: (url: string, name: string | null) => void;
  /** Ernest: attach from the computer like an email attachment. */
  onAttachFile?: (file?: File) => void;
  onCancel: () => void;
}): JSX.Element {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  return (
    <div className="modal-bg" role="dialog" aria-modal="true">
      <div className="modal" data-testid="attach-dialog">
        <h3>{t('attachDialogTitle', lang)}</h3>
        {onAttachFile &&
          (isWeb ? (
            <label className="btn-quiet" style={{ display: 'inline-block', cursor: 'pointer' }}>
              {t('attachFileBtn', lang)}
              <input
                type="file"
                data-testid="attach-file-input"
                style={{ display: 'none' }}
                onChange={(e) => onAttachFile(e.target.files?.[0] ?? undefined)}
              />
            </label>
          ) : (
            <button
              type="button"
              className="btn-quiet"
              data-testid="attach-file-native"
              onClick={() => onAttachFile()}
            >
              {t('attachFileBtn', lang)}
            </button>
          ))}
        <label className="field-label">
          {t('attachUrlLabel', lang)}
          <input
            value={url}
            placeholder="https://docs.google.com/…"
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <label className="field-label">
          {t('attachNameLabel', lang)}
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="modal-actions">
          <button type="button" className="btn-quiet" onClick={onCancel}>
            {t('cancel', lang)}
          </button>
          <button
            type="button"
            className="btn-primary"
            style={{ marginTop: 0 }}
            onClick={() => {
              // Kotlin AttachmentUi parity: blank or dot-less input is refused.
              if (url.trim().length === 0 || !url.includes('.')) {
                window.alert(t('attachInvalidUrl', lang));
                return;
              }
              onSubmit(url, name.trim().length > 0 ? name : null);
            }}
          >
            {t('confirm', lang)}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Blok-grouped, role-filterable, read-only task list (Kotlin TaskListView parity).
 *  The filter is controlled by the app shell: it defaults from the signed-in
 *  user's role and persists across views, like the Kotlin role chips. */
export function TaskList({
  tasks,
  lang,
  filter,
  onFilterChange,
  onOpen,
  locked = false,
  onSetStatus,
  onAddAttachment,
  onAttachFile,
  onRemoveAttachment,
  adminMode = false,
  structureActions,
}: {
  tasks: Task[];
  lang: Lang;
  filter: RoleFilter;
  onFilterChange: (f: RoleFilter) => void;
  onOpen: (url: string) => void;
  /** Submitted/approved lists are frozen; the main process enforces this too. */
  locked?: boolean;
  onSetStatus?: (taskId: string, status: TaskStatus) => void;
  onAddAttachment?: (taskId: string, url: string, name: string | null) => void;
  onAttachFile?: (taskId: string, file?: File) => void;
  onRemoveAttachment?: (attachmentId: string) => void;
  /** Owner admin mode (Kotlin v0.9): blok/task reorder + custom rows. */
  adminMode?: boolean;
  structureActions?: StructureActions;
}): JSX.Element {
  const [attachFor, setAttachFor] = useState<string | null>(null);
  const [addRowFor, setAddRowFor] = useState<string | null>(null);
  const groups = useMemo(() => {
    const filtered = relevantTasks(tasks, filter);
    const seen: string[] = [];
    const byKey = new Map<string, Task[]>();
    for (const task of filtered) {
      const key = blokKey(task);
      if (!byKey.has(key)) {
        seen.push(key);
        byKey.set(key, []);
      }
      byKey.get(key)!.push(task);
    }
    return seen.map((key) => ({ key, tasks: byKey.get(key)! }));
  }, [tasks, filter]);

  // Kotlin parity: blok order and row neighbours come from the UNFILTERED list,
  // so under an active role filter a move can jump over invisible rows/groups.
  const allKeys = useMemo(() => {
    const keys: string[] = [];
    for (const task of tasks) {
      const key = blokKey(task);
      if (!keys.includes(key)) keys.push(key);
    }
    return keys;
  }, [tasks]);
  const admin = adminMode && !locked && structureActions ? structureActions : undefined;
  // Ernest: adding a row is for everyone, not just admin mode — any user who
  // can edit the list may append their own deliverables. Reorder/delete stay admin.
  const canAddRow = !locked && structureActions ? structureActions : undefined;

  return (
    <div>
      <div className="role-bar">
        <span className="muted">{t('filterLabel', lang)}</span>
        <button
          type="button"
          className={`role-chip${filter === 'all' ? ' active' : ''}`}
          onClick={() => onFilterChange('all')}
        >
          {t('filterAll', lang)}
        </button>
        {ROLE_CHIPS.map((role) => (
          <button
            key={role}
            type="button"
            className={`role-chip${filter === role ? ' active' : ''}`}
            onClick={() => onFilterChange(role)}
          >
            {role}
          </button>
        ))}
      </div>
      {groups.map(({ key, tasks: groupTasks }) => {
        const [step, blok] = key.split('||');
        const keyIdx = allKeys.indexOf(key);
        return (
          <section key={key}>
            <div className="blok-header">
              <span className="blok-step">{step}</span>
              {blok}
              {(admin || canAddRow) && (
                <span className="blok-tools">
                  {admin && keyIdx > 0 && (
                    <button
                      type="button"
                      className="reorder-btn"
                      data-testid="blok-up"
                      onClick={() => admin.moveBlok(key, -1)}
                    >
                      ▲
                    </button>
                  )}
                  {admin && keyIdx < allKeys.length - 1 && (
                    <button
                      type="button"
                      className="reorder-btn"
                      data-testid="blok-down"
                      onClick={() => admin.moveBlok(key, 1)}
                    >
                      ▼
                    </button>
                  )}
                  {canAddRow && (
                    <button
                      type="button"
                      className="add-row-btn"
                      data-testid="add-row"
                      onClick={() => setAddRowFor(key)}
                    >
                      {t('addRow', lang)}
                    </button>
                  )}
                </span>
              )}
            </div>
            {groupTasks.map((task) => {
              const allIdx = tasks.indexOf(task);
              return (
                <TaskRow
                  key={task.id}
                  task={task}
                  lang={lang}
                  locked={locked}
                  onSetStatus={onSetStatus}
                  onOpen={onOpen}
                  onAddAttachment={onAddAttachment ? (taskId) => setAttachFor(taskId) : undefined}
                  onRemoveAttachment={onRemoveAttachment}
                  onMove={admin ? (dir) => admin.moveTask(task.id, dir) : undefined}
                  moveUpDisabled={allIdx <= 0 || blokKey(tasks[allIdx - 1]!) !== key}
                  moveDownDisabled={
                    allIdx >= tasks.length - 1 || blokKey(tasks[allIdx + 1]!) !== key
                  }
                  onDelete={
                    admin && task.custom
                      ? () => {
                          if (window.confirm(t('deleteRowConfirm', lang)))
                            admin.deleteCustomRow(task.id);
                        }
                      : undefined
                  }
                />
              );
            })}
          </section>
        );
      })}
      {addRowFor !== null && canAddRow && (
        <NamePromptDialog
          label={t('addRowPrompt', lang)}
          lang={lang}
          onSubmit={(name) => {
            setAddRowFor(null);
            canAddRow.addCustomRow(addRowFor, name);
          }}
          onCancel={() => setAddRowFor(null)}
        />
      )}
      {attachFor && onAddAttachment && (
        <AttachDialog
          lang={lang}
          onSubmit={(url, name) => {
            setAttachFor(null);
            onAddAttachment(attachFor, url, name);
          }}
          onAttachFile={
            onAttachFile
              ? (file) => {
                  setAttachFor(null);
                  onAttachFile(attachFor, file);
                }
              : undefined
          }
          onCancel={() => setAttachFor(null)}
        />
      )}
    </div>
  );
}
