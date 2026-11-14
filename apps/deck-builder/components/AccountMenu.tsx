import { useRef } from 'react';
import { PASSWORD_LIMITS, type SessionInfo } from '@card-game/protocol';

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
  const action = useRef<'login' | 'register'>('login');
  if (session) {
    return (
      <div className="account-menu">
        <p className="account-menu-note">Account saves are private to you.</p>
        <div className="account-menu-list">
          <button type="button" className="account-menu-action" disabled={busy} onClick={() => onLogout()}>
            Sign out this browser
          </button>
          <button type="button" className="account-menu-action" disabled={busy} onClick={() => onLogout(true)}>
            Sign out all public sessions
          </button>
        </div>
      </div>
    );
  }
  return (
    <form className="account-menu" onSubmit={(event) => { event.preventDefault(); onAuthenticate(action.current); }}>
      <label>Username
        <input autoComplete="username" required minLength={3} maxLength={32} value={username} disabled={busy}
          onChange={(event) => onUsername(event.target.value)} />
      </label>
      <label>Password
        <input type="password" autoComplete="current-password" required maxLength={128}
          value={password} disabled={busy} onChange={(event) => onPassword(event.target.value)} />
      </label>
      <div className="account-menu-actions">
        <button type="submit" className="account-menu-action account-menu-primary" disabled={busy}
          onClick={() => { action.current = 'login'; }}>
          {busy ? 'Please wait…' : 'Sign in'}
        </button>
        <button type="submit" className="account-menu-action" disabled={busy}
          onClick={() => { action.current = 'register'; }}>
          Create account
        </button>
      </div>
      <small className="account-menu-note">
        Browse and draft freely. Sign in once for Home, Play and Decks. New passwords need at least {PASSWORD_LIMITS.min} characters.
      </small>
    </form>
  );
}
