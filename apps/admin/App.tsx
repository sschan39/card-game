import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AdminIdentityResponseSchema, type AuthResponse } from '@card-game/protocol';
import { AdminApi } from './api';
import { browserStorage, readAdminSession, saveAdminSession } from './session';
import { useAdminRoute } from './hooks';
import Rooms from './pages/Rooms';
import Logs from './pages/Logs';
import Accounts from './pages/Accounts';
import Configuration from './pages/Configuration';
import { Notice } from './components/common';
import { WorkspaceHeader } from '@card-game/ui';
import '@card-game/ui/style.css';
import { publicSession } from '@card-game/browser-session';
import type { PlatformInfo } from '@card-game/protocol';

function Login({ login }: { login: (username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState(''), [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (busy) return; setBusy(true); setError(null);
    try { await login(username, password); } catch (error) { setError(error instanceof Error ? error.message : 'Sign-in failed.'); } finally { setPassword(''); setBusy(false); }
  };
  return <main className="login-screen"><section className="login-card"><div className="brand-mark" aria-hidden="true">C</div><p className="eyebrow">Card Game · Administration</p><h1>Welcome back</h1><p>Sign in to inspect matches and manage access.</p>
    <form onSubmit={event => void submit(event)}><label>Username<input autoComplete="username" required value={username} maxLength={32} onChange={event => setUsername(event.target.value)} /></label>
      <label>Password<input type="password" autoComplete="current-password" required value={password} maxLength={256} onChange={event => setPassword(event.target.value)} /></label>
      {error && <Notice message={error} error />}<button className="primary" disabled={busy} type="submit">{busy ? 'Signing in…' : 'Sign in'}</button></form>
    <p className="login-note">Administrator access only. Use your administrator credentials.</p></section></main>;
}
const navigation = [{ id: 'rooms', label: 'Rooms', symbol: '▦' }, { id: 'logs', label: 'Game logs', symbol: '≡' }, { id: 'accounts', label: 'Accounts', symbol: '○' }, { id: 'config', label: 'Configuration', symbol: '⚙' }];
export default function App() {
  const [platform, setPlatform] = useState<PlatformInfo | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void publicSession.platform(controller.signal).then(value => { if (!controller.signal.aborted) setPlatform(value); }).catch(() => { /* Privileged access remains independent of public navigation availability. */ });
    return () => controller.abort();
  }, []);
  const [session, setSession] = useState<AuthResponse | null>(() => readAdminSession(browserStorage())), current = useRef(session);
  const [clock, setClock] = useState(Date.now()), [error, setError] = useState<string | null>(null);
  current.current = session;
  const ended = useCallback(() => { current.current = null; saveAdminSession(browserStorage(), null); setSession(null); }, []);
  const api = useMemo(() => new AdminApi(() => current.current, ended), [ended]);
  const route = useAdminRoute();
  useEffect(() => {
    if (!session) return;
    const timeout = setTimeout(() => { if (current.current?.sessionId === session.sessionId) ended(); }, Math.max(0, session.expiresAt - Date.now()));
    const tick = setInterval(() => setClock(Date.now()), 1000), controller = new AbortController();
    void api.get('/api/admin/me', AdminIdentityResponseSchema, controller.signal).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Unable to verify access.'); });
    return () => { clearTimeout(timeout); clearInterval(tick); controller.abort(); };
  }, [session?.sessionId, api, ended]);
  const login = async (username: string, password: string) => {
    const next = await api.login(username, password); saveAdminSession(browserStorage(), next); current.current = next; setSession(next); setClock(Date.now()); setError(null);
  };
  if (!session) return <><WorkspaceHeader navigation={platform?.navigation ?? null} current="admin" account={null} breadcrumb="Administration / Sign in" /><Login login={login} /></>;
  const seconds = Math.max(0, Math.ceil((session.expiresAt - clock) / 1000)), remaining = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return <div className="admin-layout"><a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>Skip to content</a><aside className="sidebar"><div className="brand"><span className="brand-mark" aria-hidden="true">C</span><div><strong>Card Game</strong><small>Administration</small></div></div>
    <p className="nav-label">Workspace</p><nav aria-label="Administration">{navigation.map(item => <a key={item.id} href={'#' + item.id} aria-current={route === item.id ? 'page' : undefined}><span aria-hidden="true">{item.symbol}</span>{item.label}</a>)}</nav><div className="sidebar-note">Private operational workspace</div></aside>
    <div className="workspace"><WorkspaceHeader navigation={platform?.navigation ?? null} current="admin" account={session.account} breadcrumb={'Administration / ' + navigation.find(item => item.id === route)?.label} accountMenu={<><span>Admin session {remaining}</span><button onClick={() => { void api.logout().catch(() => setError('Server sign-out could not be confirmed. Local access was cleared.')); }}>Sign out administration</button></>} />
      <main id="main-content" tabIndex={-1}>{error && <Notice message={error} error />}{route === 'rooms' ? <Rooms api={api} /> : route === 'logs' ? <Logs api={api} /> : route === 'accounts' ? <Accounts api={api} actorId={session.account!.id} ended={ended} /> : <Configuration api={api} />}</main></div></div>;
}
