import { useState } from 'react';
import { PASSWORD_LIMITS, type PublicAccount } from '@card-game/protocol';
import { useAuthStore } from '../auth-state';
import { useGameStore } from '../store/gameStore';
import socket, { connectWithSession } from '../socket';
import { publicSession, safeReturnPath } from '@card-game/browser-session';

export default function AccountControls({ browserAccount }: { browserAccount?: PublicAccount | null } = {}) {
  const { session, busy, error, authenticate, logout } = useAuthStore();
  const [mode, setMode] = useState<'login' | 'register' | null>(null);
  const [username, setUsername] = useState(''), [password, setPassword] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (!mode || busy) return;
    try {
      const next = await authenticate(mode, username, password);
      socket.disconnect();
      const game = useGameStore.getState();
      if (next.roomId) game.setRoomId(next.roomId); else game.clearSession();
      game.setMyPlayerId(next.playerId); await connectWithSession(); setMode(null);
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
    <span>{session?.account || browserAccount ? `Signed in as ${(session?.account ?? browserAccount)!.username}` : 'Guest player'}</span>
    {session?.account && browserAccount && session.account.id !== browserAccount.id && <p>Game account: {session.account.username}. Browser account: {browserAccount.username}.</p>}
    {session?.account || browserAccount ? <>
      {session?.account ? <button disabled={busy} onClick={() => void signOut('tab')}>End this game session</button> : <button disabled={busy} onClick={() => { void connectWithSession(true).catch(() => useGameStore.getState().setError('Unable to use browser sign-in. Retry or end the current game session.')); }}>Use browser sign-in for this game</button>}
      <button disabled={busy} onClick={() => void signOut('browser')}>Sign out this browser</button>
      <button disabled={busy} onClick={() => void signOut('all')}>Sign out all public sessions for {(session?.account ?? browserAccount)!.username}</button>
    </> : <>
      <button disabled={busy} onClick={() => { void connectWithSession(true).catch(() => useGameStore.getState().setError('Unable to establish a game session. Retry or sign in.')); }}>Use browser sign-in / start guest</button>
      <button disabled={busy} onClick={() => setMode('login')}>Sign in</button>
      <button disabled={busy} onClick={() => setMode('register')}>Create account</button>
    </>}
    {error && <p role="alert">{error}</p>}
    {mode && <form onSubmit={event => void submit(event)}>
      <label>Username<input autoComplete="username" value={username} minLength={3} maxLength={32} required onChange={event => setUsername(event.target.value)} /></label>
      <label>Password<input type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password}
        minLength={mode === 'register' ? PASSWORD_LIMITS.min : undefined} maxLength={256} required onChange={event => setPassword(event.target.value)} /></label>
      {mode === 'register' && <p>Use 15–128 characters. Your current guest seat will stay with your account.</p>}
      <button type="submit" disabled={busy}>{mode === 'register' ? 'Create account' : 'Sign in'}</button>
      <button type="button" disabled={busy} onClick={() => { setMode(null); setPassword(''); }}>Cancel</button>
    </form>}
  </section>;
}
