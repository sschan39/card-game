import { useEffect, useState, type FormEvent } from 'react';
import { PublicApiError, publicSession } from '@card-game/browser-session';
import { OperatorTestRoomsSchema, PlaytestCredentialsSchema, PLAYTEST_SESSION_KEY,
  type BrowserIdentity, type PlatformInfo } from '@card-game/protocol';
import { WorkspaceHeader, useConfirmation } from '@card-game/ui';
import './playtest.css';

const roomsPath = '/api/lab/operator/rooms';

export default function OperatorTestRooms() {
  const [platform, setPlatform] = useState<PlatformInfo>();
  const [identity, setIdentity] = useState<BrowserIdentity>();
  const [rooms, setRooms] = useState<ReturnType<typeof OperatorTestRoomsSchema.parse>['rooms']>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const { confirm, dialog } = useConfirmation();

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    setLoading(true);
    void (async () => {
      const config = await publicSession.platform(signal);
      if (signal.aborted) return;
      setPlatform(config);
      if (!config.capabilities.operatorTestRooms) return;
      const current = await publicSession.me(signal);
      if (signal.aborted) return;
      setIdentity(current);
      if (current.labOperator) {
        const listing = OperatorTestRoomsSchema.parse(await publicSession.request(roomsPath, { signal }));
        if (!signal.aborted) setRooms(listing.rooms);
      } else setRooms([]);
    })().catch(cause => {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load Test Rooms.');
    }).finally(() => { if (!signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [refresh]);

  const perform = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try { await work(); }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The Test Room request failed.');
      if (cause instanceof PublicApiError && (cause.status === 401 || cause.status === 403))
        setRefresh(value => value + 1);
    } finally { setBusy(false); }
  };
  const signIn = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget, input = new FormData(form);
    void perform(async () => {
      try { await publicSession.authenticate('login', String(input.get('username')), String(input.get('password'))); }
      finally { form.reset(); }
      setRefresh(value => value + 1);
    });
  };
  const open = (id?: string) => perform(async () => {
    const access = PlaytestCredentialsSchema.parse(await publicSession.request(id ? roomsPath + '/' + id + '/resume' : roomsPath, { method: 'POST' }));
    sessionStorage.setItem(PLAYTEST_SESSION_KEY + ':' + access.run.roomId, JSON.stringify(access));
    window.location.assign('/play/test/' + access.run.roomId);
  });
  const close = async (id: string, name: string) => {
    if (!await confirm({ title: 'Close ' + name + '?', message: 'Closing this room discards its board and checkpoints.', confirmLabel: 'Close room' })) return;
    await perform(async () => {
      await publicSession.request(roomsPath + '/' + id, { method: 'DELETE' });
      setRooms(current => current.filter(room => room.roomId !== id));
      try { sessionStorage.removeItem(PLAYTEST_SESSION_KEY + ':' + id); } catch { /* The server already closed the room. */ }
    });
  };

  return <>
    <WorkspaceHeader key={identity?.session?.sessionId ?? 'guest'} navigation={platform?.navigation ?? null} current="play" breadcrumb="Play / Test Rooms"
      account={identity?.session?.account ?? null} accountMenu={identity?.session && <button className="account-menu-action" type="button" disabled={busy} onClick={() => void perform(async () => {
        await publicSession.logout();
        setRefresh(value => value + 1);
      })}>Sign out this browser</button>} />
    <main className="playtest-header operator-rooms">
      <h1>Test Rooms</h1>
      {loading && <p role="status">Loading Test Rooms…</p>}
      {error && <div role="alert" className="playtest-error"><p>{error}</p><button onClick={() => { setError(''); setRefresh(value => value + 1); }}>Retry</button></div>}
      {!loading && !!platform && !platform.capabilities.operatorTestRooms && <p>Test Rooms are unavailable on this instance.</p>}
      {!loading && platform?.capabilities.operatorTestRooms && identity && (!identity.session ?
        <form className="account-form" onSubmit={signIn}>
          <p>Sign in with your Tester or Admin account to open a Test Room.</p>
          <label>Username<input name="username" autoComplete="username" required maxLength={32} /></label>
          <label>Password<input type="password" name="password" autoComplete="current-password" required maxLength={512} /></label>
          <button type="submit" disabled={busy}>Sign in</button>
        </form> : identity.authorityUnavailable ? <p role="status">Account service unavailable.{' '}
          <button type="button" onClick={() => setRefresh(value => value + 1)}>Retry</button>
        </p> : !identity.labOperator ? <p>This account needs Tester or Admin access to operate Test Rooms.</p> : <>
          <button type="button" disabled={busy} onClick={() => void open()}>New combat practice room</button>
          {rooms.length ? <ul>{rooms.map(room => <li key={room.roomId}>
            <div><strong>{room.name}</strong>
              <small>{room.retainedUntil ? 'Retained until ' + new Date(room.retainedUntil).toLocaleString() : 'Created ' + new Date(room.createdAt).toLocaleString()}</small>
            </div>
            <button type="button" disabled={busy} onClick={() => void open(room.roomId)}>Resume</button>
            <button type="button" disabled={busy} aria-label={'Close ' + room.name} onClick={() => void close(room.roomId, room.name)}>Close</button>
          </li>)}</ul> : <p>You have no Test Rooms.</p>}
        </>)}
      {dialog}
    </main>
  </>;
}
