import { useEffect, useState } from 'react';
import { t, type Lang } from '@shared/i18n';
import { api, isWeb, type OutboxItem } from '../services/api';

const EVENT_LABEL_KEY: Record<string, string> = {
  DELIVERABLE_SUBMITTED: 'evSubmitted',
  APPROVAL_REQUESTED: 'evApprovalRequested',
  PHASE_APPROVED: 'evApproved',
  PHASE_REJECTED: 'evRejected',
  PASSWORD_RESET: 'evReset',
};

/** Sent notifications (Kotlin OutboxView parity): owner sees all workflow mail,
 *  colleagues only mail addressed to them; reset codes only to their own account. */
export function Outbox({
  viewerUserId,
  lang,
  onBack,
}: {
  viewerUserId: string;
  lang: Lang;
  onBack: () => void;
}): JSX.Element {
  const [items, setItems] = useState<OutboxItem[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    void api.listOutbox(viewerUserId).then(setItems).catch(() => setItems([]));
  }, [viewerUserId]);

  return (
    <div className="page">
      <div className="crumbs">
        <button type="button" onClick={onBack}>
          {t('dashboardTitle', lang)}
        </button>{' '}
        / {t('outboxTitle', lang)}
      </div>
      <h2 className="page-title">✉ {t('outboxTitle', lang)}</h2>
      <p className="page-sub">
        {t('outboxSub', lang)}
        {!isWeb && (
          <>
            {' '}
            <button
              type="button"
              className="btn-quiet"
              onClick={() => void api.openOutboxFolder()}
            >
              {t('openOutboxFolder', lang)}
            </button>
          </>
        )}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
        {items === null && <p className="muted">Loading…</p>}
        {items?.length === 0 && <p className="muted">{t('outboxEmpty', lang)}</p>}
        {items?.map((m) => (
          <div key={m.id} className="card" style={{ padding: '10px 14px' }} data-testid="mail-row">
            <button
              type="button"
              className="link-btn"
              style={{ color: 'inherit', textAlign: 'left', width: '100%' }}
              onClick={() => setExpanded(expanded === m.id ? null : m.id)}
            >
              <span className="rasci a" style={{ marginRight: 8 }}>
                {t(EVENT_LABEL_KEY[m.event] ?? m.event, lang)}
              </span>
              <strong>{m.subject}</strong>
              <div className="muted">
                {t('toLabel', lang)}: {m.to.join(', ')} · {t('fromLabel', lang)}: {m.from} ·{' '}
                {new Date(m.createdAt).toLocaleString()} · {t('viaLabel', lang)} {m.deliveredVia}
              </div>
            </button>
            {expanded === m.id && (
              <pre
                data-testid="mail-body"
                style={{
                  background: '#f8f9fa',
                  borderRadius: 6,
                  padding: 10,
                  whiteSpace: 'pre-wrap',
                  fontSize: '0.85rem',
                  marginTop: 8,
                }}
              >
                {m.body}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
