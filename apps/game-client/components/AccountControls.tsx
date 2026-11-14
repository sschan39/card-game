import { useRef, useState } from 'react';
import { PASSWORD_LIMITS, type PublicAccount } from '@card-game/protocol';
import { useAuthStore } from '../auth-state';
import { useGameStore } from '../store/gameStore';
import socket, { connectWithSession } from '../socket';
import { publicSession, safeReturnPath } from '@card-game/browser-session';

export default function AccountControls({ browserAccount }: { browserAccount?: PublicAccount | null } = {}) {
  const { session, busy, error, authenticate, logout } = useAuthStore();
  const [username, setUsername] = useState(''), [password, setPassword] = useState('');
  /* The clicked button carries the action. A mode held in state would still read the
     previous value by the time the submit handler runs. */
  const action = useRef<'login' | 'register'>('login');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy) return;
    try {
      const next = await authenticate(action.current, username, password);
      socket.disconnect();
      const game = useGameStore.getState();
      if (next.roomId) game.setRoomId(next.roomId); else game.clearSession();
      game.setMyPlayerId(next.playerId); await connectWithSession();
      if (typeof window !== 'undefined' && !next.roomId) {
        const url = new URL(window.location.href);
        if (url.searchParams.has('returnTo')) {
          const destination = safeReturnPath(url.searchParams.get('returnTo'));
          if (destination.startsWith('/deck-builder')) { const platform = await publicSession.platform(); window.location.assign(new URL(platform.navigation.decks, window.location.origin).href); }
          else { window.history.replaceState(null, '', destination); window.dispatchEvent(new PopStateEvent('popstate')); }
        }
      }
    } catch { /* A safe message is held in the auth store. */ }
    finally { setPassword(''); }
  };
  const signOut = async (mode: 'tab' | 'browser' | 'all') => {
    try { await logout(mode); } catch { /* The local credential is cleared even if HTTP failed. */ }
    socket.disconnect(); useGameStore.getState().clearSession();
  };
  return <section className="account-controls" aria-label="Account">
    {session?.account && browserAccount && session.account.id !== browserAccount.id && <p>Game account: {session.account.username}. Browser account: {browserAccount.username}.</p>}
    {session?.account || browserAccount ? <>
      {session?.account
        ? <button className="account-menu-action" disabled={busy} onClick={() => void signOut('tab')}>End this game session</button>
        : <button className="account-menu-action" disabled={busy} onClick={() => { void connectWithSession(true).catch(() => useGameStore.getState().setError('Unable to use browser sign-in. Retry or end the current game session.')); }}>Use browser sign-in for this game</button>}
      <button className="account-menu-action" disabled={busy} onClick={() => void signOut('browser')}>Sign out this browser</button>
      <button className="account-menu-action" disabled={busy} onClick={() => void signOut('all')}>Sign out all public sessions</button>
    </> : <form className="account-form" onSubmit={event => void submit(event)}>
      <label>Username
        <input autoComplete="username" value={username} minLength={3} maxLength={32} required onChange={event => setUsername(event.target.value)} />
      </label>
      <label>Password
        <input type="password" autoComplete="current-password" value={password} maxLength={256} required onChange={event => setPassword(event.target.value)} />
      </label>
      <p className="account-form-note">New passwords need at least {PASSWORD_LIMITS.min} characters.</p>
      <div className="account-form-actions">
        <button type="submit" className="account-menu-action" disabled={busy} onClick={() => { action.current = 'login'; }}>Sign in</button>
        <button type="submit" className="account-menu-action" disabled={busy} onClick={() => { action.current = 'register'; }}>Create account</button>
      </div>
    </form>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
