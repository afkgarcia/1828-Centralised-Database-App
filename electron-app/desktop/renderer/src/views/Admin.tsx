import { useCallback, useEffect, useState } from 'react';
import type { City, User, UserRole } from '@shared/types';
import { t, type Lang } from '@shared/i18n';
import { api } from '../services/api';

const ROLES: UserRole[] = ['OWNER', 'PM', 'OM', 'PO', 'PPM', 'MT'];

/** Owner-only user management (Kotlin UserAdminView parity): signup approvals,
 *  roles, per-city access chips, remove-with-handover. */
export function Admin({
  actor,
  cities,
  lang,
  onBack,
  onChanged,
}: {
  actor: User;
  cities: City[];
  lang: Lang;
  onBack: () => void;
  onChanged: () => void;
}): JSX.Element {
  const [users, setUsers] = useState<User[] | null>(null);
  const [removeTarget, setRemoveTarget] = useState<User | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(() => {
    void api.adminListUsers(actor.id).then((result) => {
      if (Array.isArray(result)) setUsers(result);
    });
  }, [actor.id]);

  useEffect(reload, [reload]);

  const run = useCallback(
    async (op: () => Promise<unknown>): Promise<void> => {
      await op();
      reload();
      onChanged();
    },
    [reload, onChanged],
  );

  return (
    <div className="page">
      <div className="crumbs">
        <button type="button" onClick={onBack}>
          {t('dashboardTitle', lang)}
        </button>{' '}
        / {t('userAdminTitle', lang)}
      </div>
      <h2 className="page-title">👥 {t('userAdminTitle', lang)}</h2>
      <p className="page-sub">
        {t('userAdminSub', lang)} {t('managerAccessHint', lang)}
      </p>
      {message && (
        <div className="banner approved" style={{ marginTop: 10, borderRadius: 8 }}>
          {message}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
        {users?.map((u) => (
          <div key={u.id} className="card" style={{ padding: '12px 16px' }} data-testid="user-row">
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <strong>{u.displayName}</strong>{' '}
                <span
                  className={`rasci ${u.status === 'ACTIVE' ? 's' : u.status === 'PENDING' ? 'c' : 'r'}`}
                >
                  {t(
                    u.status === 'ACTIVE'
                      ? 'statusActive'
                      : u.status === 'PENDING'
                        ? 'statusPending'
                        : 'statusRejected',
                    lang,
                  )}
                </span>
                <div className="muted">{u.email}</div>
              </div>

              <label className="muted">
                {t('colRole', lang)}{' '}
                <select
                  value={u.role}
                  disabled={u.id === actor.id}
                  onChange={(e) =>
                    void run(() => api.adminSetRole(actor.id, u.id, e.target.value as UserRole))
                  }
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>

              {u.status === 'PENDING' && (
                <>
                  <button
                    type="button"
                    className="btn-primary"
                    style={{ marginTop: 0 }}
                    data-testid="approve-user"
                    onClick={() => void run(() => api.adminSetStatus(actor.id, u.id, 'ACTIVE'))}
                  >
                    {t('btnApprove', lang)}
                  </button>
                  <button
                    type="button"
                    className="btn-quiet"
                    onClick={() => void run(() => api.adminSetStatus(actor.id, u.id, 'REJECTED'))}
                  >
                    {t('btnReject', lang)}
                  </button>
                </>
              )}
              {u.status === 'REJECTED' && (
                <button
                  type="button"
                  className="btn-quiet"
                  onClick={() => void run(() => api.adminSetStatus(actor.id, u.id, 'ACTIVE'))}
                >
                  {t('btnApprove', lang)}
                </button>
              )}
              {u.role !== 'OWNER' && u.id !== actor.id && (
                <button
                  type="button"
                  className="btn-quiet"
                  style={{ color: '#d93025' }}
                  data-testid="remove-user"
                  onClick={() => setRemoveTarget(u)}
                >
                  {t('btnRemoveUser', lang)}
                </button>
              )}
            </div>

            <div className="chips" style={{ marginTop: 8, alignItems: 'center' }}>
              <span className="muted">{t('colAccess', lang)}:</span>
              <button
                type="button"
                className={`role-chip${u.accessAllCities || u.role === 'OWNER' ? ' active' : ''}`}
                disabled={u.role === 'OWNER'}
                onClick={() =>
                  void run(() => api.adminSetAccessAll(actor.id, u.id, !u.accessAllCities))
                }
              >
                {t('accessAll', lang)}
              </button>
              {cities.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`role-chip${
                    u.accessAllCities || u.role === 'OWNER' || u.cityAccess.includes(c.id)
                      ? ' active'
                      : ''
                  }`}
                  disabled={u.accessAllCities || u.role === 'OWNER'}
                  onClick={() =>
                    void run(() =>
                      api.adminSetCityAccess(actor.id, u.id, c.id, !u.cityAccess.includes(c.id)),
                    )
                  }
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {removeTarget && (
        <RemoveDialog
          target={removeTarget}
          candidates={(users ?? []).filter(
            (u) => u.id !== removeTarget.id && u.status === 'ACTIVE',
          )}
          lang={lang}
          onConfirm={(replacementId) => {
            const target = removeTarget;
            setRemoveTarget(null);
            void api.adminRemoveUser(actor.id, target.id, replacementId).then((result) => {
              if (result.ok) {
                const replacement = users?.find((u) => u.id === replacementId);
                setMessage(
                  t('removedInfo', lang)
                    .replace('{user}', target.displayName)
                    .replace('{n}', String(result.movedDocs ?? 0))
                    .replace('{to}', replacement?.displayName ?? ''),
                );
              } else if (result.error === 'IS_OWNER') {
                // Kotlin UserAdminView parity: the owner can never be removed.
                window.alert(t('cannotRemoveOwner', lang));
              }
              reload();
              onChanged();
            });
          }}
          onCancel={() => setRemoveTarget(null)}
        />
      )}
    </div>
  );
}

function RemoveDialog({
  target,
  candidates,
  lang,
  onConfirm,
  onCancel,
}: {
  target: User;
  candidates: User[];
  lang: Lang;
  onConfirm: (replacementId: string) => void;
  onCancel: () => void;
}): JSX.Element {
  // Owner first, so Ernest is the default hand-over target (Kotlin parity).
  const sorted = [...candidates].sort((a, b) => Number(b.role === 'OWNER') - Number(a.role === 'OWNER'));
  const [replacement, setReplacement] = useState(sorted[0]?.id ?? '');
  return (
    <div className="modal-bg" role="dialog" aria-modal="true">
      <div className="modal" data-testid="remove-dialog">
        <h3>{t('removeUserTitle', lang)}</h3>
        <p>{t('removeUserPrompt', lang).replace('{user}', target.displayName)}</p>
        <select value={replacement} onChange={(e) => setReplacement(e.target.value)}>
          {sorted.map((u) => (
            <option key={u.id} value={u.id}>
              {u.displayName} ({u.role})
            </option>
          ))}
        </select>
        <div className="modal-actions">
          <button type="button" className="btn-quiet" onClick={onCancel}>
            {t('cancel', lang)}
          </button>
          <button
            type="button"
            className="btn-primary"
            style={{ marginTop: 0 }}
            disabled={replacement === ''}
            onClick={() => onConfirm(replacement)}
          >
            {t('removeUserConfirmBtn', lang)}
          </button>
        </div>
      </div>
    </div>
  );
}
