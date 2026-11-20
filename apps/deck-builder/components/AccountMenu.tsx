import { useRef } from 'react';
import { PASSWORD_LIMITS, type SessionInfo } from '@card-game/protocol';
import { useT } from '@card-game/ui';

export interface AccountMenuProps {
  session: SessionInfo | null;
  busy: boolean;
  username: string;
  onUsername: (value: string) => void;
  password: string;
  onPassword: (value: string) => void;
  /** The clicked button carries the action, so the form needs no separate mode control. */
  onAuthenticate: (action: 'login' | 'register') => void;
  onLogout: (all?: boolean) => void;
}

/**
 * The deck builder's account panel.
 *
 * It renders inside the shared workspace header pop-over, so the deck page no longer
 * needs its own account block: signing in, creating an account and ending a session
 * all live in the one menu that is reachable from every workspace.
 */
export function AccountMenu({ session, busy, username, onUsername, password, onPassword, onAuthenticate, onLogout }: AccountMenuProps) {
  const t = useT();
  const action = useRef<'login' | 'register'>('login');
  if (session) {
    return (
      <div className="account-menu">
        <p className="account-menu-note">{t('account.private')}</p>
        <div className="account-menu-list">
          <button type="button" className="account-menu-action" disabled={busy} onClick={() => onLogout()}>
            {t('account.signOutBrowser')}
          </button>
          <button type="button" className="account-menu-action" disabled={busy} onClick={() => onLogout(true)}>
            {t('account.signOutAll')}
          </button>
        </div>
      </div>
    );
  }
  return (
    <form className="account-menu" onSubmit={(event) => { event.preventDefault(); onAuthenticate(action.current); }}>
      <label>{t('account.username')}
        <input autoComplete="username" required minLength={3} maxLength={32} value={username} disabled={busy}
          onChange={(event) => onUsername(event.target.value)} />
      </label>
      <label>{t('account.password')}
        <input type="password" autoComplete="current-password" required maxLength={128}
          value={password} disabled={busy} onChange={(event) => onPassword(event.target.value)} />
      </label>
      <div className="account-menu-actions">
        <button type="submit" className="account-menu-action account-menu-primary" disabled={busy}
          onClick={() => { action.current = 'login'; }}>
          {busy ? t('account.pleaseWait') : t('account.signIn')}
        </button>
        <button type="submit" className="account-menu-action" disabled={busy}
          onClick={() => { action.current = 'register'; }}>
          {t('account.createAccount')}
        </button>
      </div>
      <small className="account-menu-note">
        {t('account.note', { min: PASSWORD_LIMITS.min })}
      </small>
    </form>
  );
}
