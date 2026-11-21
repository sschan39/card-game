import { useEffect, useRef, useState } from 'react';
import type { SavedDeck } from '@card-game/protocol';
import { openAccountMenu, usePageEntrance } from '@card-game/ui';
import socket, { connectWithSession } from '../socket';
import { lobbyBlockReason } from '../lobby-readiness';
import { useAuthStore } from '../auth-state';
import { loadSavedDecks } from '../decks';
import { useGameActions } from '../hooks/useGameActions';
import { useGameStore } from '../store/gameStore';
import { consumeDeckHandoff, ownedHandoffDeck, readDeckHandoff, type DeckHandoff } from '../deck-handoff';
import playHero from '../assets/play-hero.webp';

export default function StartScreen({ decksUrl, leaving = false, accountHasRoom = false }: { decksUrl?: string; leaving?: boolean; accountHasRoom?: boolean } = {}) {
  const { createRoom, joinRoom } = useGameActions();
  /* Marks the lobby so the stylesheet can give this page the same full-bleed artwork the
     home page wears. The live board keeps its own dark furniture and sets nothing. */
  useEffect(() => {
    document.body.dataset.route = 'play';
    return () => {
      delete document.body.dataset.route;
    };
  }, []);
  const roomId = useGameStore((s) => s.roomId);
  const [joinId, setJoinId] = useState('');
  const session = useAuthStore(state => state.session);
  const [connected, setConnected] = useState(!!socket.connected);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [decks, setDecks] = useState<SavedDeck[]>([]), [deckId, setDeckId] = useState('');
  const [handoff, setHandoff] = useState<DeckHandoff>(() => readDeckHandoff(typeof window === 'undefined' ? '' : window.location.search));
  const handoffRef = useRef(handoff); handoffRef.current = handoff;
  const [loading, setLoading] = useState(!!session?.account), [handoffNotice, setHandoffNotice] = useState('');
  const [deckError, setDeckError] = useState<string | null>(null), [refresh, setRefresh] = useState(0);
  /* The lobby fades in once the play artwork has decoded and the saved-deck page has
     landed. The skeleton inside the deck picker covers the wait; a signed-out visitor
     has no deck request to wait for and needs no picker at all. */
  const entered = usePageEntrance({ ready: !loading, images: [playHero] });
  useEffect(() => {
    const reset = () => { pendingRef.current = false; setPending(false); };
    const connectedNow = () => { setConnected(true); };
    const disconnected = () => { setConnected(false); reset(); };
    socket.on('connect', connectedNow); socket.on('disconnect', disconnected);
    socket.on('error', reset); socket.on('roomFull', reset); socket.on('connect_error', reset);
    socket.on('roomCreated', reset); socket.on('roomJoined', reset); socket.on('rejoined', reset);
    return () => {
      socket.off('connect', connectedNow); socket.off('disconnect', disconnected);
      socket.off('error', reset); socket.off('roomFull', reset); socket.off('connect_error', reset);
      socket.off('roomCreated', reset); socket.off('roomJoined', reset); socket.off('rejoined', reset);
    };
  }, []);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => {
      pendingRef.current = false; setPending(false);
      useGameStore.getState().setError('Room setup was not confirmed. Reconnect to check for an existing room before retrying.');
      socket.disconnect();
      void connectWithSession().catch(() => useGameStore.getState().setError('Unable to reconnect. Reload before retrying room setup.'));
    }, 10000);
    return () => clearTimeout(timer);
  }, [pending]);
  useEffect(() => {
    setDecks([]); setDeckError(null); setHandoffNotice('');
    if (!session?.account) { setDeckId(''); setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    void loadSavedDecks(session.token, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      setDecks(value);
      /* Default the picker to a real deck, so "Create New Room" never silently starts a
         deckless table. An explicit ?deckId= handoff still overrides this below. */
      setDeckId(previous => (previous && value.some(deck => deck.id === previous) ? previous : value[0]?.id ?? ''));
      if (handoff.kind === 'requested' && handoffRef.current.kind === 'requested' && handoffRef.current.id === handoff.id) {
        const selected = ownedHandoffDeck(handoff, value);
        if (selected) { setDeckId(selected.id); setHandoffNotice('Selected deck: ' + selected.name); setHandoff({ kind: 'none' }); consumeDeckHandoff(); }
        else setDeckError('This deck is unavailable for this account. Sign in with the account that saved it, or dismiss the selection.');
      }
    }).catch(() => { if (!controller.signal.aborted) setDeckError('Unable to load saved decks. Retry or sign in again.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [session?.token, session?.account?.id, refresh]);

  const selected = decks.find(deck => deck.id === deckId);
  const blockReason = accountHasRoom ? 'A room is already open for this account. Switch to the existing match tab to resume or leave it.' : lobbyBlockReason({ signedIn: !!session?.account, loading, failed: !!deckError, hasDecks: !!decks.length,
    selectedDeck: !!selected, handoffPending: handoff.kind !== 'none', connected, pending });
  const submitRoom = (mode: 'create' | 'join') => {
    if (blockReason || pendingRef.current || roomId || (mode === 'join' && !joinId.trim())) return;
    pendingRef.current = true; setPending(true);
    if (mode === 'create') createRoom(deckId); else joinRoom(joinId.trim(), deckId);
  };
  return (
    <div className="start-screen" data-page-leaving={leaving}>
      <section className="lobby-hero" data-page-stage data-entered={entered}>
        <div className="lobby-backs" aria-hidden="true">
          <span className="card-back" />
          <span className="card-back" />
          <span className="card-back" />
        </div>
        <h1>Multiplayer Card Game</h1>
        <p className="lobby-lede">
          Two players, one table. Open a room and share the code, or join a table someone
          already opened.
        </p>
        {decksUrl ? <a href={decksUrl}>Build or edit a deck</a> : <p>Deck navigation needs the server's workspace settings.</p>}
      </section>

      <section className="lobby-actions">
        <section className="lobby-block setup-status" aria-label="Room setup" aria-live="polite">
          <h2>Get ready to play</h2>
          <p>1. Sign in · 2. Build and save a 60–250 card deck · 3. Select it below and create or join.</p>
          {blockReason ? <p id="room-setup-reason">{blockReason}</p> : <p id="room-setup-reason">Ready: {selected?.name} · {selected?.cards.reduce((total, card) => total + card.quantity, 0)} cards.</p>}
          {!session?.account && <button onClick={openAccountMenu}>Sign in / Create account</button>}
          {session?.account && !loading && !deckError && !decks.length && decksUrl && <a href={decksUrl}>Build your first deck</a>}
          {session?.account && !connected && <button disabled={pending} onClick={() => void connectWithSession().catch(() => useGameStore.getState().setError('Unable to connect. Retry when the server is available.'))}>Retry connection</button>}
        </section>
        <div className="lobby-block" data-page-stage data-entered={entered}>
          <div className="lobby-head">
            <div>
              <h2>Open a table</h2>
              <p>Start a room and send the code to your opponent.</p>
            </div>
            <button disabled={!!blockReason || !!roomId} aria-describedby="room-setup-reason" onClick={() => submitRoom('create')}>Create New Room</button>
          </div>
        </div>

        <div className="lobby-block" data-page-stage data-entered={entered}>
          <h2>Join a table</h2>
          <p>Enter the room code your opponent shared.</p>
          <form className="join-row" onSubmit={event => { event.preventDefault(); submitRoom('join'); }}>
            <input
              type="text"
              placeholder="Enter Room ID to join"
              aria-label="Room code" maxLength={128} disabled={pending}
              value={joinId}
              onChange={(e) => setJoinId(e.target.value)}
            />
            <button type="submit" aria-describedby="room-setup-reason" disabled={!joinId.trim() || !!blockReason || !!roomId}>
              Join
            </button>
          </form>
        </div>

        {handoff.kind !== 'none' && <div className="lobby-block lobby-notice" role="status">
          <p>{handoff.kind === 'invalid' ? 'The deck link is invalid.' : !session?.account ? 'Sign in with the account that saved this deck. It will be selected after ownership is checked.' : deckError ? 'The requested deck could not be selected. See the error below.' : 'Checking the requested deck against your saved decks.'}</p>
          <button onClick={() => { setHandoff({ kind: 'none' }); consumeDeckHandoff(); setDeckError(null); }}>Dismiss deck link</button>
        </div>}
        {handoffNotice && <p role="status">{handoffNotice}</p>}

        {session?.account && <div className="deck-selection page-stage-layer">
          <div className="deck-selection-skeleton" data-page-skeleton data-entered={entered} aria-hidden="true">
            <span className="skeleton-block" />
          </div>
          <div className="deck-selection-body" data-page-stage data-entered={entered}>
            <label>Deck <select disabled={loading || handoff.kind !== 'none'} value={deckId} onChange={event => { setDeckId(event.target.value); setHandoffNotice(''); }}>
              <option value="">No saved deck selected</option>
              {decks.map(deck => <option key={deck.id} value={deck.id}>{deck.name}</option>)}
            </select></label>
            <button onClick={() => setRefresh(value => value + 1)}>Refresh decks</button>
            {loading && <p role="status">Loading saved decks…</p>}
            {deckError && <p role="alert">{deckError}</p>}
          </div>
        </div>}

        {roomId && <p className="lobby-room">Your Room ID: <strong>{roomId}</strong></p>}
      </section>
    </div>
  );
}
