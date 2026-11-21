import { useEffect, useRef, useState } from 'react';
import { Toast, useConfirmation } from '@card-game/ui';
import { AuthErrorSchema, declarationPlayer, PlaytestStateSchema, PROTOCOL_VERSION, type PlaytestCommand, type PlaytestCredentials, type PlaytestEdit, type PlaytestRecipe, type PlaytestState } from '@card-game/protocol';
import GameScreen from '../components/GameScreen';
import { MatchConnectionContext } from '../match-connection';
import { useGameStore } from '../store/gameStore';
import Editor from './Editor';
import { connectPlaytest, readPlaytest } from './session';
import './playtest.css';

type Command = PlaytestCommand | { edit: PlaytestEdit } | { recipe: PlaytestRecipe };

async function playtestRequest(access: PlaytestCredentials, signal: AbortSignal, body?: Command & { expectedRevision: number }): Promise<PlaytestState> {
  const response = await fetch(`/api/lab/playtest/${access.run.roomId}`, {
    signal, method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${access.editor}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, ...body }) } : {}),
  });
  const data: unknown = await response.json();
  if (!response.ok) {
    const error = AuthErrorSchema.safeParse(data);
    throw new Error(error.success ? error.data.message : 'Could not load the playtest position.');
  }
  return PlaytestStateSchema.parse(data);
}

export default function PlaytestScreen({ roomId }: { roomId: string }) {
  const [access] = useState(() => readPlaytest(roomId));
  if (!access) return <main className="playtest-header"><h1>Playtest sign-in required</h1>
    <p>Open or resume the room to get fresh controls in this tab.</p>
    <a href="/play/test-rooms">Test Rooms</a> · <a href="/admin/#test-rooms">Scenario Lab</a>
  </main>;
  return <ActivePlaytest access={access} />;
}

function ActivePlaytest({ access }: { access: PlaytestCredentials }) {
  const [connection, setConnection] = useState<ReturnType<typeof connectPlaytest>>();
  const [seat, setSeat] = useState<0 | 1>(0);
  const [follow, setFollow] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [visibleHands, setVisibleHands] = useState<PlaytestState['cards']>([]);
  const [state, setState] = useState<PlaytestState>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const pending = useRef<AbortController | null>(null);
  const playButton = useRef<HTMLButtonElement>(null);
  const board = useRef<HTMLDivElement>(null);
  const { confirm, dialog } = useConfirmation();
  const room = useGameStore(value => value.room);
  const sync = useGameStore(value => value.roomSync);
  const revision = useGameStore(value => value.lastSeq);
  const roomError = useGameStore(value => value.error);
  const owner = room?.pendingChoice?.playerId ?? (room && declarationPlayer(room)) ?? room?.priorityPlayerId;
  const currentSeat = room && owner ? owner === room.player1Id ? 0 : 1 : null;
  const turn = room ? room.activeTurnPlayerId === room.player1Id ? 'Seat A' : 'Seat B' : '';
  const editing = state?.editing ?? false;

  useEffect(() => {
    const handle = connectPlaytest(access);
    setConnection(handle);
    const controller = new AbortController();
    void playtestRequest(access, controller.signal).then(value => { if (!controller.signal.aborted) setState(value); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Playtest unavailable.'); });
    return () => { handle.dispose(); controller.abort(); pending.current?.abort(); pending.current = null; };
  }, [access]);

  useEffect(() => {
    if (follow && !editing && !busy && sync === 'live' && currentSeat !== null && currentSeat !== seat) {
      if (board.current?.contains(document.activeElement)) board.current.focus();
      connection?.select(currentSeat);
      setSeat(currentSeat);
    }
  }, [follow, editing, busy, sync, currentSeat, seat, connection]);

  useEffect(() => {
    if (!reveal) return;
    const controller = new AbortController();
    void playtestRequest(access, controller.signal).then(value => {
      if (!controller.signal.aborted) setVisibleHands(value.cards.filter(card => card.zone === 'hand'));
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load both hands.');
    });
    return () => controller.abort();
  }, [access, reveal, revision]);

  async function submit(command: Command) {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const current = 'kind' in command && command.kind === 'edit' ? await playtestRequest(access, controller.signal) : state;
      if (!current) throw new Error('Could not read the current position.');
      const result = await playtestRequest(access, controller.signal, { ...command, expectedRevision: current.revision });
      if (controller.signal.aborted) return;
      setState(result);
      setNotice(result.message);
      if (!result.editing) requestAnimationFrame(() => playButton.current?.focus());
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : 'The edit could not be applied.');
      try { const latest = await playtestRequest(access, controller.signal); if (!controller.signal.aborted) setState(latest); }
      catch { /* Keep the error from the failed operation. */ }
    } finally {
      if (pending.current === controller) { pending.current = null; setBusy(false); }
    }
  }

  return <>
    <header className="playtest-header">
      <div className="playtest-title"><a href={access.retained ? '/play/test-rooms' : '/admin/#test-rooms'}>Back to Test Rooms</a><h1>Playtest · {access.run.snapshot.name}</h1></div>
      <div className="playtest-toolbar" aria-label="Playtest controls">
        <fieldset className="playtest-seats" disabled={!connection || editing || busy}>
          <legend>Controlled seat</legend>
          {([0, 1] as const).map(index => <label key={index}><input type="radio" name="playtest-seat" checked={seat === index} onChange={() => {
            setFollow(false);
            connection?.select(index);
            setSeat(index);
          }} /> Seat {index === 0 ? 'A' : 'B'}</label>)}
        </fieldset>
        <label><input type="checkbox" checked={follow} disabled={editing || busy} onChange={event => setFollow(event.target.checked)} /> Follow action</label>
        <label><input type="checkbox" checked={reveal} onChange={event => { setVisibleHands([]); setReveal(event.target.checked); }} /> Reveal both hands</label>
        <button type="button" ref={playButton} aria-expanded={editing} disabled={!state || busy} onClick={() => void submit({ kind: editing ? 'play' : 'edit' })}>{editing ? 'Resume play' : 'Edit board'}</button>
      </div>
      <p role="status" aria-atomic="true">{`Controlling Seat ${seat === 0 ? 'A' : 'B'}. `}{editing ? 'Play paused for editing.' : sync !== 'live' ? 'Waiting for the selected seat’s board.' : `${turn}’s turn. ${currentSeat === null ? 'No player input needed.' : `Seat ${currentSeat === 0 ? 'A' : 'B'} to act.`}`}</p>
      <p role="status" aria-atomic="true">{notice}</p>
      {error && <p role="alert" className="playtest-error">{error}</p>}
      {roomError && <Toast message={roomError} tone="error" onDismiss={() => useGameStore.getState().setError(null)} />}
    </header>
    {dialog}
    {reveal && <section className="playtest-hands" aria-label="Revealed hands">
      {([0, 1] as const).map(index => <div key={index}><h2>Seat {index === 0 ? 'A' : 'B'} hand</h2><ul>
        {visibleHands.filter(card => card.seat === index).map(card => <li key={card.uuid}>{card.name}</li>)}
      </ul>{!visibleHands.some(card => card.seat === index) && <p>No cards shown.</p>}</div>)}
    </section>}
    {editing && state && <Editor state={state} busy={busy} onApply={edit => void submit({ edit })} onRecipe={recipe => void submit({ recipe })} onCommand={command => void submit(command)} onUndo={() => void submit({ kind: 'undo' })} onReset={async () => {
      if (await confirm({ title: 'Reset this playtest?', message: 'This restores the starting scenario and clears the undo history for this run.', confirmLabel: 'Reset scenario' })) void submit({ kind: 'reset' });
    }} />}
    {connection && <MatchConnectionContext.Provider value={{ socket: connection.sockets[seat], recover: connection.recover, playtest: true }}>
      <div className="playtest-board" ref={board} tabIndex={-1} aria-label="Match board" inert={editing || busy}><GameScreen key={seat} /></div>
    </MatchConnectionContext.Provider>}
  </>;
}
