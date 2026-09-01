import { useState, type FormEvent } from 'react';
import type { User, UserRole } from '@shared/types';
import { t, type Lang } from '@shared/i18n';
import { api } from '../services/api';

type Mode = 'login' | 'signup' | 'signup-done' | 'reset-email' | 'reset-code';

const SIGNUP_ROLES: UserRole[] = ['PM', 'OM', 'PO', 'PPM', 'MT'];

/** Kotlin signup ChoiceBox labels (LoginView.kt): full role names, not codes. */
const ROLE_LABEL_KEY: Partial<Record<UserRole, string>> = {
  PM: 'rolePM',
  OM: 'roleOM',
  PO: 'rolePO',
  PPM: 'rolePPM',
  MT: 'roleMT',
};

const LOGIN_ERROR_KEY: Record<string, string> = {
  UNKNOWN_EMAIL: 'loginFailUnknown',
  BAD_PASSWORD: 'loginFailPassword',
  PENDING: 'loginFailPending',
  REJECTED: 'loginFailRejected',
};

const SIGNUP_ERROR_KEY: Record<string, string> = {
  INVALID_EMAIL: 'signupFailEmail',
  WEAK_PASSWORD: 'signupFailWeak',
  ALREADY_EXISTS: 'signupFailExists',
};

const RESET_ERROR_KEY: Record<string, string> = {
  UNKNOWN_EMAIL: 'loginFailUnknown',
  BAD_CODE: 'resetFailBadCode',
  WEAK_PASSWORD: 'signupFailWeak',
};

/** Login / signup-request / password-reset card (Kotlin LoginView parity). */
export function Login({
  lang,
  onLoggedIn,
}: {
  lang: Lang;
  onLoggedIn: (user: User) => void;
}): JSX.Element {
  const [mode, setMode] = useState<Mode>('login');
  const [error, setError] = useState<string | null>(null);
  const [resetEmail, setResetEmail] = useState('');

  const switchMode = (m: Mode): void => {
    setMode(m);
    setError(null);
  };

  async function handleLogin(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const result = await api.login(String(data.get('email')), String(data.get('password')));
    if (result.outcome === 'OK') onLoggedIn(result.user);
    else if ((result as { error?: string }).error === 'RATE_LIMITED')
      setError(t('loginFailRateLimited', lang));
    else setError(t(LOGIN_ERROR_KEY[result.outcome] ?? 'loginFailPassword', lang));
  }

  async function handleSignup(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const outcome = await api.signup(
      String(data.get('email')),
      String(data.get('password')),
      String(data.get('name')),
      String(data.get('role')) as UserRole,
    );
    if (outcome === 'OK') switchMode('signup-done');
    else setError(t(SIGNUP_ERROR_KEY[outcome] ?? 'signupFailEmail', lang));
  }

  async function handleResetEmail(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const email = String(data.get('email'));
    const known = await api.resetRequest(email);
    if (!known) {
      setError(t('loginFailUnknown', lang));
      return;
    }
    setResetEmail(email);
    switchMode('reset-code');
  }

  async function handleResetComplete(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const pw = String(data.get('password'));
    if (pw !== String(data.get('confirm'))) {
      setError(t('pwMismatch', lang));
      return;
    }
    const outcome = await api.resetComplete(resetEmail, String(data.get('code')), pw);
    if (outcome === 'OK') {
      switchMode('login');
      setError(null);
      window.alert(t('resetSuccess', lang));
    } else setError(t(RESET_ERROR_KEY[outcome] ?? 'resetFailBadCode', lang));
  }

  return (
    <div className="page" style={{ maxWidth: 460 }}>
      <div className="card" style={{ padding: 28, marginTop: 40 }}>
        {error && (
          <div className="error-banner" role="alert" style={{ marginBottom: 14 }}>
            {error}
          </div>
        )}

        {mode === 'login' && (
          <form onSubmit={handleLogin} data-testid="login-form">
            <h2 className="page-title" style={{ fontSize: '1.38rem' }}>
              {t('loginTitle', lang)}
            </h2>
            <p className="page-sub">{t('loginSub', lang)}</p>
            <Field label={t('labelEmail', lang)} name="email" type="email" />
            <Field label={t('labelPassword', lang)} name="password" type="password" />
            <button type="submit" className="btn-primary">
              {t('btnLogin', lang)}
            </button>
            <p style={{ marginTop: 12 }}>
              <LinkBtn onClick={() => switchMode('reset-email')}>
                {t('forgotPassword', lang)}
              </LinkBtn>
            </p>
            <p className="muted" style={{ marginTop: 8 }}>
              {t('noAccount', lang)}{' '}
              <LinkBtn onClick={() => switchMode('signup')}>{t('createAccount', lang)}</LinkBtn>
            </p>
            <p className="muted" style={{ marginTop: 12 }}>
              {t('demoHint', lang)}
            </p>
          </form>
        )}

        {mode === 'signup' && (
          <form onSubmit={handleSignup} data-testid="signup-form">
            <h2 className="page-title" style={{ fontSize: '1.38rem' }}>
              {t('signupTitle', lang)}
            </h2>
            <p className="page-sub">{t('signupSub', lang)}</p>
            <Field label={t('labelName', lang)} name="name" type="text" />
            <Field label={t('labelEmail', lang)} name="email" type="email" />
            <Field label={t('labelPassword', lang)} name="password" type="password" />
            <label className="field-label">
              {t('labelRequestedRole', lang)}
              <select name="role" defaultValue="PM">
                {SIGNUP_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(ROLE_LABEL_KEY[r] ?? r, lang)}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn-primary">
              {t('btnSignup', lang)}
            </button>
            <p className="muted" style={{ marginTop: 8 }}>
              {t('haveAccount', lang)}{' '}
              <LinkBtn onClick={() => switchMode('login')}>{t('backToLogin', lang)}</LinkBtn>
            </p>
          </form>
        )}

        {mode === 'signup-done' && (
          <div data-testid="signup-done">
            <h2 className="page-title" style={{ fontSize: '1.38rem' }}>
              ✅ {t('signupSubmitted', lang)}
            </h2>
            <p className="page-sub">{t('signupSubmittedDesc', lang)}</p>
            <button type="button" className="btn-primary" onClick={() => switchMode('login')}>
              {t('backToLogin', lang)}
            </button>
          </div>
        )}

        {mode === 'reset-email' && (
          <form onSubmit={handleResetEmail} data-testid="reset-email-form">
            <h2 className="page-title" style={{ fontSize: '1.38rem' }}>
              {t('resetTitle', lang)}
            </h2>
            <p className="page-sub">{t('resetSub', lang)}</p>
            <Field label={t('labelEmail', lang)} name="email" type="email" />
            <button type="submit" className="btn-primary">
              {t('btnSendCode', lang)}
            </button>
            <p style={{ marginTop: 8 }}>
              <LinkBtn onClick={() => switchMode('login')}>{t('backToLogin', lang)}</LinkBtn>
            </p>
          </form>
        )}

        {mode === 'reset-code' && (
          <form onSubmit={handleResetComplete} data-testid="reset-code-form">
            <h2 className="page-title" style={{ fontSize: '1.38rem' }}>
              {t('resetTitle', lang)}
            </h2>
            <p className="page-sub">{t('resetCodeSent', lang)}</p>
            <Field label={t('labelCode', lang)} name="code" type="text" />
            <Field label={t('labelNewPassword', lang)} name="password" type="password" />
            <Field label={t('labelConfirmPassword', lang)} name="confirm" type="password" />
            <button type="submit" className="btn-primary">
              {t('btnResetPassword', lang)}
            </button>
            <p style={{ marginTop: 8 }}>
              <LinkBtn onClick={() => switchMode('login')}>{t('backToLogin', lang)}</LinkBtn>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  name,
  type,
}: {
  label: string;
  name: string;
  type: string;
}): JSX.Element {
  return (
    <label className="field-label">
      {label}
      <input name={name} type={type} required />
    </label>
  );
}

function LinkBtn({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button type="button" className="link-btn" onClick={onClick}>
      {children}
    </button>
  );
}
