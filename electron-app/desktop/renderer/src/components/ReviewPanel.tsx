import type { Task } from '@shared/types';
import { blokKey } from '@shared/business-logic';
import { t, type Lang } from '@shared/i18n';
import { DocChip } from './TaskList';

/**
 * The reviewer's screen for a submitted (or approved) list — Ernest's ask:
 * row by row, completed items green with their documents clickable, N.v.t.
 * items greyed, and rows a submit-with-move carried to the next phase shown
 * struck-through at the bottom. Replaces the locked task list; read-only.
 */
export function ReviewPanel({
  tasks,
  movedOut = [],
  lang,
  onOpen,
}: {
  tasks: Task[];
  /** Rows that left this list via "move to next phase" (project phases only). */
  movedOut?: Task[];
  lang: Lang;
  onOpen: (url: string) => void;
}): JSX.Element {
  const groups: { key: string; tasks: Task[] }[] = [];
  for (const task of tasks) {
    const key = blokKey(task);
    const last = groups.at(-1);
    if (last && last.key === key) last.tasks.push(task);
    else groups.push({ key, tasks: [task] });
  }

  return (
    <div data-testid="review-panel">
      {groups.map(({ key, tasks: groupTasks }) => {
        const [step, blok] = key.split('||');
        return (
          <section key={key}>
            <div className="blok-header">
              <span className="blok-step">{step}</span>
              {blok}
            </div>
            {groupTasks.map((task) => (
              <ReviewRow key={task.id} task={task} lang={lang} onOpen={onOpen} />
            ))}
          </section>
        );
      })}
      {movedOut.length > 0 && (
        <section data-testid="review-moved">
          <div className="blok-header" style={{ color: '#80868B' }}>
            <span className="blok-step" aria-hidden>
              →
            </span>
            {t('reviewMoved', lang)}
          </div>
          {movedOut.map((task) => (
            <ReviewRow key={task.id} task={task} lang={lang} onOpen={onOpen} moved />
          ))}
        </section>
      )}
    </div>
  );
}

function ReviewRow({
  task,
  lang,
  onOpen,
  moved = false,
}: {
  task: Task;
  lang: Lang;
  onOpen: (url: string) => void;
  moved?: boolean;
}): JSX.Element {
  const cls = moved
    ? 'task-row'
    : `task-row${task.status === 'DONE' ? ' done' : task.status === 'NA' ? ' na' : ''}`;
  const glyph =
    task.status === 'DONE' ? '✓' : task.status === 'NA' ? '⊘' : moved ? '→' : '○';
  const statusLabel =
    task.status === 'DONE'
      ? t('reviewDone', lang)
      : task.status === 'NA'
        ? t('reviewNa', lang)
        : t('reviewOpen', lang);
  return (
    <div
      className={cls}
      data-testid={moved ? 'review-moved-row' : 'review-row'}
      style={moved ? { opacity: 0.65 } : undefined}
    >
      <span
        className={`status-box${task.status === 'DONE' ? ' done' : task.status === 'NA' ? ' na' : ''}`}
        aria-label={moved ? 'moved' : task.status}
        style={{ cursor: 'default' }}
      >
        {glyph}
      </span>
      <div className="task-main">
        <div className="name" style={moved ? { textDecoration: 'line-through' } : undefined}>
          {task.deliverable}
          {task.custom && <span className="rasci c"> {t('customTag', lang)}</span>}
        </div>
        <div className="chips">
          <span className="rasci" style={{ color: '#5F6368' }}>
            {moved ? t('reviewMoved', lang) : statusLabel}
          </span>
          {task.r && <span className="rasci r">R: {task.r}</span>}
          {task.a && <span className="rasci a">A: {task.a}</span>}
        </div>
        {task.attachments.length > 0 && (
          <div className="chips">
            {task.attachments.map((att) => (
              <DocChip key={att.id} att={att} lang={lang} onOpen={onOpen} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
