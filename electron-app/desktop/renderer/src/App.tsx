import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { RoleFilter, User } from '@shared/types';
import {
  accessibleProjects,
  isApprover,
  projectsForCity,
  roleToFilter,
  userCanAccessCity,
} from '@shared/business-logic';
import { t, type Lang } from '@shared/i18n';
import { api, isWeb, SessionExpiredError, type ListRef, type MutationResult, type World } from './services/api';
import { Login } from './views/Login';
import { Dashboard } from './views/Dashboard';
import { CityDetail } from './views/CityDetail';
import { ProjectDetail } from './views/ProjectDetail';
import { Outbox } from './views/Outbox';
import { Admin } from './views/Admin';
import type { ListActions } from './components/ListActions';

type Nav =
  | { view: 'dashboard' }
  | { view: 'city'; cityId: string }
  | { view: 'project'; projectId: string; phaseIdx: number }
  | { view: 'outbox' }
  | { view: 'admin' };

/**
 * App shell (step 4): session + role-based access. Views receive only the
 * cities/projects the signed-in user may see (shared access rules); the RASCI
 * filter defaults from the user's role and persists across views.
 */
export function App(): JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  const [world, setWorld] = useState<World | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nav, setNav] = useState<Nav>({ view: 'dashboard' });
  const [lang, setLang] = useState<Lang>('nl');
  const [filter, setFilter] = useState<RoleFilter>('all');
  const [showPwDialog, setShowPwDialog] = useState(false);
  const [zoom, setZoom] = useState(1);
  // Kotlin parity: admin mode is owner-only, never persisted, off at session start.
  const [adminMode, setAdminMode] = useState(false);

  // Magnifier (Kotlin v0.9 parity): every size is rem-based, so scaling the root
  // font size rescales the whole UI.
  useEffect(() => {
    document.documentElement.style.fontSize = `${13 * zoom}px`;
  }, [zoom]);

  const handleLogout = useCallback(() => {
    void api.logout();
    setUser(null);
    setWorld(null);
    setAdminMode(false);
    setNav({ view: 'dashboard' });
  }, []);

  const userRef = useRef<User | null>(null);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // Web sessions can expire out from under an open tab (server restart, TTL).
  // Any adapter call then rejects with SessionExpiredError; without this,
  // mutations become silent no-ops. One alert, then back to the login screen.
  const handleSessionExpired = useCallback(
    (e: unknown): boolean => {
      if (!(e instanceof SessionExpiredError)) return false;
      if (userRef.current) {
        window.alert(e.message);
        handleLogout();
      }
      return true;
    },
    [handleLogout],
  );

  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent): void => {
      if (handleSessionExpired(event.reason)) event.preventDefault();
    };
    window.addEventListener('unhandledrejection', onRejection);
    return () => window.removeEventListener('unhandledrejection', onRejection);
  }, [handleSessionExpired]);

  const load = useCallback(
    (): Promise<void> =>
      api
        .getWorld()
        .then(setWorld)
        .catch((e: unknown) => {
          if (!handleSessionExpired(e)) setError(e instanceof Error ? e.message : String(e));
        }),
    [handleSessionExpired],
  );

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  const openUrl = useCallback((url: string) => {
    void api.openExternal(url);
  }, []);

  const goHome = useCallback(() => setNav({ view: 'dashboard' }), []);

  // Web: re-adopt a live cookie session on reload. Desktop resolves null
  // (no session persistence, Kotlin parity).
  useEffect(() => {
    void api.restoreSession().then((restored) => {
      if (restored && !userRef.current) {
        setUser(restored);
        setFilter(roleToFilter(restored.role));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogin = useCallback((u: User) => {
    setUser(u);
    setFilter(roleToFilter(u.role));
    setAdminMode(false);
    setNav({ view: 'dashboard' });
  }, []);

  /** Runs a mutation, surfaces errors, and refreshes the world snapshot. */
  const runMutation = useCallback(
    async (op: () => Promise<MutationResult>): Promise<void> => {
      const result = await op();
      if (!result.ok && result.error !== 'NEEDS_CHOICE' && result.error !== 'CANCELED') {
        window.alert(
          result.error === 'LOCKED' || result.error === 'ALREADY_SUBMITTED'
            ? t('lockedTitle', lang)
            : result.error === 'NOT_APPROVER'
              ? t('needsApprover', lang)
              : result.error === 'TOO_LARGE'
                ? t('attachTooLarge', lang)
                : result.error,
        );
      }
      load();
    },
    [lang, load],
  );

  const actionsFor = useCallback(
    (ref: ListRef): ListActions => ({
      setTaskStatus: (taskId, status) =>
        void runMutation(() => api.setTaskStatus(taskId, status, user?.id, lang)),
      markAll: (target) =>
        void runMutation(() => api.markAll(ref, target, filter, user?.id, lang)),
      submit: (choice) => void runMutation(() => api.submitList(ref, choice, user?.id, lang)),
      decide: (action) =>
        void runMutation(() => api.decideList(ref, action, user?.id ?? '', lang)),
      addAttachment: (taskId, url, name) =>
        void runMutation(() => api.addAttachment(taskId, url, name, user?.id ?? '')),
      attachFile: (taskId, file) =>
        void runMutation(() => api.attachFile(taskId, user?.id ?? '', file)),
      removeAttachment: (attachmentId) =>
        void runMutation(() => api.removeAttachment(attachmentId)),
      addCustomRow: (blokKey, deliverable) =>
        void runMutation(() => api.addCustomRow(ref, blokKey, deliverable, user?.id ?? '')),
      deleteCustomRow: (taskId) =>
        void runMutation(() => api.deleteCustomRow(taskId, user?.id ?? '')),
      moveBlok: (blokKey, dir) =>
        void runMutation(() => api.moveBlok(ref, blokKey, dir, user?.id ?? '')),
      moveTask: (taskId, dir) => void runMutation(() => api.moveTask(taskId, dir, user?.id ?? '')),
    }),
    [filter, lang, runMutation, user],
  );

  /** Kotlin promptAddCity: create, warn on duplicates, then jump into the city. */
  const handleCreateCity = useCallback(
    async (name: string): Promise<void> => {
      const result = await api.createCity(name, user?.id ?? '');
      if (!result.ok) {
        window.alert(result.error === 'DUPLICATE' ? t('duplicateName', lang) : result.error);
        return;
      }
      await load();
      if (result.id) setNav({ view: 'city', cityId: result.id });
    },
    [lang, load, user],
  );

  /** Kotlin promptAddProject: parent city comes from the page you're on. */
  const handleCreateProject = useCallback(
    async (cityId: string, name: string): Promise<void> => {
      const result = await api.createProject(name, cityId, user?.id ?? '');
      if (!result.ok) {
        window.alert(result.error === 'DUPLICATE' ? t('duplicateName', lang) : result.error);
        return;
      }
      await load();
      if (result.id) setNav({ view: 'project', projectId: result.id, phaseIdx: 0 });
    },
    [lang, load, user],
  );

  if (!user) {
    return (
      <>
        <Header lang={lang} onLang={setLang} zoom={zoom} onZoom={setZoom} />
        <Login lang={lang} onLoggedIn={handleLogin} />
      </>
    );
  }

  // Role-based scoping via shared access rules — same trust model as the Kotlin
  // app (enforced at the API layer once the web backend exists).
  const visibleCities = world
    ? world.cities.filter((c) => userCanAccessCity(user, c.id, world.projects))
    : [];
  const visibleProjects = world ? accessibleProjects(user, world.projects) : [];

  let content: JSX.Element;
  if (error) {
    content = (
      <div className="page">
        <div className="error-banner">{error}</div>
      </div>
    );
  } else if (!world) {
    content = (
      <div className="page">
        <p className="muted">Loading…</p>
      </div>
    );
  } else if (nav.view === 'city') {
    const city = visibleCities.find((c) => c.id === nav.cityId);
    content = city ? (
      <CityDetail
        city={city}
        projects={projectsForCity(user, city.id, world.projects)}
        lang={lang}
        filter={filter}
        onFilterChange={setFilter}
        onOpenProject={(projectId) => setNav({ view: 'project', projectId, phaseIdx: 0 })}
        onOpenUrl={openUrl}
        onBack={goHome}
        actions={actionsFor({ cityId: city.id })}
        canApprove={isApprover(user)}
        adminMode={adminMode}
        onCreateProject={(name) => void handleCreateProject(city.id, name)}
      />
    ) : (
      <div className="page">
        <div className="error-banner">{t('cityNotFound', lang)}</div>
      </div>
    );
  } else if (nav.view === 'project') {
    const project = visibleProjects.find((p) => p.id === nav.projectId);
    const city = project ? world.cities.find((c) => c.id === project.cityId) : undefined;
    content =
      project && city ? (
        <ProjectDetail
          project={project}
          city={city}
          phaseIdx={nav.phaseIdx}
          lang={lang}
          filter={filter}
          onFilterChange={setFilter}
          onSelectPhase={(phaseIdx) =>
            setNav({ view: 'project', projectId: project.id, phaseIdx })
          }
          onOpenUrl={openUrl}
          onBack={goHome}
          onBackToCity={() => setNav({ view: 'city', cityId: city.id })}
          actions={actionsFor({
            phaseId: project.phases[Math.min(nav.phaseIdx, project.phases.length - 1)]!.id,
          })}
          canApprove={isApprover(user)}
          adminMode={adminMode}
        />
      ) : (
        <div className="page">
          <div className="error-banner">{t('projectNotFound', lang)}</div>
        </div>
      );
  } else if (nav.view === 'outbox') {
    content = <Outbox viewerUserId={user.id} lang={lang} onBack={goHome} />;
  } else if (nav.view === 'admin' && isApprover(user)) {
    content = (
      <Admin actor={user} cities={world.cities} lang={lang} onBack={goHome} onChanged={load} />
    );
  } else {
    content = (
      <Dashboard
        cities={visibleCities}
        projects={visibleProjects}
        lang={lang}
        canApprove={isApprover(user)}
        onOpenCity={(cityId) => setNav({ view: 'city', cityId })}
        onOpenProject={(projectId, phaseIdx) => setNav({ view: 'project', projectId, phaseIdx })}
        viewerUserId={user.id}
        onOpenOutbox={() => setNav({ view: 'outbox' })}
        onCreateCity={user.role === 'OWNER' ? (name) => void handleCreateCity(name) : undefined}
        emptyNotice={
          visibleCities.length > 0
            ? undefined
            : world.cities.length === 0 || user.role === 'OWNER'
              ? 'noCities'
              : 'noAccessibleCities'
        }
      />
    );
  }

  return (
    <>
      <Header
        lang={lang}
        onLang={setLang}
        zoom={zoom}
        onZoom={setZoom}
        user={user}
        onHome={nav.view !== 'dashboard' ? goHome : undefined}
        onLogout={handleLogout}
        onChangePassword={() => setShowPwDialog(true)}
        onOutbox={() => setNav({ view: 'outbox' })}
        onAdmin={isApprover(user) ? () => setNav({ view: 'admin' }) : undefined}
        adminMode={adminMode}
        onToggleAdminMode={
          user.role === 'OWNER' ? () => setAdminMode((current) => !current) : undefined
        }
      />
      {content}
      {showPwDialog && (
        <ChangePasswordDialog
          lang={lang}
          email={user.email}
          onClose={() => setShowPwDialog(false)}
        />
      )}
    </>
  );
}

const ZOOM_LEVELS = [0.9, 1, 1.15, 1.3, 1.5];

function Header({
  lang,
  onLang,
  zoom,
  onZoom,
  user,
  onHome,
  onLogout,
  onChangePassword,
  onOutbox,
  onAdmin,
  adminMode = false,
  onToggleAdminMode,
}: {
  lang: Lang;
  onLang: (l: Lang) => void;
  zoom: number;
  onZoom: (z: number) => void;
  user?: User;
  onHome?: () => void;
  onLogout?: () => void;
  onChangePassword?: () => void;
  onOutbox?: () => void;
  onAdmin?: () => void;
  adminMode?: boolean;
  /** Present only for owners (Kotlin HeaderBar: adminMode toggle is owner-only). */
  onToggleAdminMode?: () => void;
}): JSX.Element {
  const zoomIdx = ZOOM_LEVELS.indexOf(zoom);
  return (
    <header className="header-bar">
      <h1>{t('appTitle', lang)}</h1>
      <span className="v-badge">{isWeb ? 'Web' : 'Electron'} · v1.0</span>
      {user && (
        <span className="user-chip" data-testid="user-chip">
          {t('loggedInAs', lang)}: {user.displayName} ({user.role})
        </span>
      )}
      {user && isApprover(user) && <span className="approver-chip">{t('approver', lang)}</span>}
      {adminMode && (
        <span className="admin-badge" data-testid="admin-badge">
          {t('adminBadge', lang)}
        </span>
      )}
      <span className="header-spacer" />
      {onHome && (
        <button type="button" className="header-btn" onClick={onHome}>
          {t('btnDashboard', lang)}
        </button>
      )}
      {user && onOutbox && (
        <button type="button" className="header-btn" onClick={onOutbox}>
          {t('btnOutbox', lang)}
        </button>
      )}
      {user && onAdmin && (
        <button type="button" className="header-btn" onClick={onAdmin}>
          {t('btnUserAdmin', lang)}
        </button>
      )}
      {user && onToggleAdminMode && (
        <button
          type="button"
          className="header-btn"
          data-testid="admin-toggle"
          onClick={onToggleAdminMode}
        >
          {t(adminMode ? 'btnAdminOff' : 'btnAdminOn', lang)}
        </button>
      )}
      {user && onChangePassword && (
        <button
          type="button"
          className="header-btn"
          title={t('changePwTitle', lang)}
          onClick={onChangePassword}
        >
          🔑
        </button>
      )}
      {user && onLogout && (
        <button type="button" className="header-btn" onClick={onLogout}>
          {t('btnLogout', lang)}
        </button>
      )}
      <div className="lang-toggle" title={t('zoomTooltip', lang)} data-testid="zoom-control">
        <span className="lang-btn" aria-hidden>
          🔍
        </span>
        <button
          type="button"
          className="lang-btn"
          disabled={zoomIdx <= 0}
          onClick={() => onZoom(ZOOM_LEVELS[Math.max(zoomIdx - 1, 0)]!)}
        >
          −
        </button>
        <button type="button" className="lang-btn" onClick={() => onZoom(1)}>
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          className="lang-btn"
          disabled={zoomIdx >= ZOOM_LEVELS.length - 1}
          onClick={() => onZoom(ZOOM_LEVELS[Math.min(zoomIdx + 1, ZOOM_LEVELS.length - 1)]!)}
        >
          +
        </button>
      </div>
      <div className="lang-toggle">
        {(['nl', 'en'] as const).map((l) => (
          <button
            key={l}
            type="button"
            className={`lang-btn${lang === l ? ' active' : ''}`}
            onClick={() => onLang(l)}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>
    </header>
  );
}

function ChangePasswordDialog({
  lang,
  email,
  onClose,
}: {
  lang: Lang;
  email: string;
  onClose: () => void;
}): JSX.Element {
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const next = String(data.get('next'));
    if (next !== String(data.get('confirm'))) {
      setMessage(t('pwMismatch', lang));
      return;
    }
    const outcome = await api.changePassword(email, String(data.get('current')), next);
    if (outcome === 'OK') {
      window.alert(t('changePwSuccess', lang));
      onClose();
    } else {
      setMessage(
        t(outcome === 'BAD_CURRENT' ? 'changePwFailCurrent' : 'signupFailWeak', lang),
      );
    }
  }

  return (
    <div className="modal-bg" role="dialog" aria-modal="true">
      <form className="modal" onSubmit={handleSubmit} data-testid="pw-dialog">
        <h3>{t('changePwTitle', lang)}</h3>
        {message && <div className="error-banner">{message}</div>}
        <label className="field-label">
          {t('labelCurrentPassword', lang)}
          <input name="current" type="password" required />
        </label>
        <label className="field-label">
          {t('labelNewPassword', lang)}
          <input name="next" type="password" required />
        </label>
        <label className="field-label">
          {t('labelConfirmPassword', lang)}
          <input name="confirm" type="password" required />
        </label>
        <div className="modal-actions">
          <button type="button" className="btn-quiet" onClick={onClose}>
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
