import { useState } from 'react';
import { PASSWORD_LIMITS } from '@card-game/protocol';
import { useAuthStore } from '../auth-state';
import { useGameStore } from '../store/gameStore';
import socket, { connectWithSession } from '../socket';

export default function AccountControls() {
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
    } catch { /* A safe message is held in the auth store. */ }
    finally { setPassword(''); }
  };
  const signOut = async () => {
    try { await logout(); } catch { /* The local credential is cleared even if HTTP failed. */ }
    socket.disconnect(); useGameStore.getState().clearSession();
    try { await connectWithSession(); } catch { useGameStore.getState().setError('Sign in or reload to establish a new guest session.'); }
  };
  return <section className="account-controls" aria-label="Account">
    <span>{session?.account ? `Signed in as ${session.account.username}` : 'Guest player'}</span>
    {session?.account ? <button disabled={busy} onClick={() => void signOut()}>Sign out</button> : <>
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
