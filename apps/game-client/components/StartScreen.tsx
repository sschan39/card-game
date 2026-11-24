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
import LobbyDeckPicker from './LobbyDeckPicker';
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
  const [loading, setLoading] = useState(!!session?.account);
  const [deckError, setDeckError] = useState(false), [refresh, setRefresh] = useState(0);
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
    setDecks([]); setDeckError(false);
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
        if (selected) { setDeckId(selected.id); setHandoff({ kind: 'none' }); consumeDeckHandoff(); }
      }
    }).catch(() => { if (!controller.signal.aborted) setDeckError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [session?.token, session?.account?.id, refresh]);

  const selected = decks.find(deck => deck.id === deckId);
  const blockReason = accountHasRoom ? 'An active room is open in another tab.' : lobbyBlockReason({ signedIn: !!session?.account, loading, failed: deckError, hasDecks: !!decks.length,
    selectedDeck: !!selected, handoffPending: handoff.kind !== 'none', connected, pending });
  const showHandoff = !deckError && !accountHasRoom && handoff.kind !== 'none';
  const status = !showHandoff ? blockReason : handoff.kind === 'invalid' ? 'This deck link is invalid.'
    : !session?.account ? 'Sign in with the account that saved this deck.'
    : loading ? 'Checking the linked deck…' : 'This deck is unavailable for this account.';
  const needsDeck = session?.account && !loading && !deckError && !decks.length && handoff.kind === 'none';
  const retryConnection = session?.account && !!selected && !loading && !deckError && !connected &&
    handoff.kind === 'none' && !accountHasRoom;
  const refreshDecks = () => setRefresh(value => value + 1);
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
        <h1>Play a match</h1>
      </section>

      <section className="lobby-actions">
        {session?.account && <section className="lobby-deck-selection" aria-labelledby="selected-deck-heading">
          <div className="lobby-deck-heading">
            <h2 id="selected-deck-heading">Selected deck</h2>
            {decksUrl && <a href={decksUrl}>{needsDeck ? 'Build a deck' : 'Manage decks'}</a>}
          </div>
          {(loading || selected) && <div className="page-stage-layer">
            <div className="deck-selection-skeleton" data-page-skeleton data-entered={entered} aria-hidden="true">
              <span className="skeleton-block" />
            </div>
            <div data-page-stage data-entered={entered}>
              {selected && <LobbyDeckPicker decks={decks} selected={selected}
                disabled={loading || pending || handoff.kind !== 'none'} onSelect={setDeckId} onRefresh={refreshDecks} />}
            </div>
          </div>}
        </section>}
        {status && <div className="lobby-status">
          <p id="room-setup-reason" role={deckError ? 'alert' : 'status'}>{status}</p>
          <div className="lobby-status-actions">
            {!session?.account && <button type="button" onClick={openAccountMenu}>Sign in / Create account</button>}
            {(deckError || needsDeck) && <button type="button" onClick={refreshDecks}>{deckError ? 'Retry decks' : 'Refresh decks'}</button>}
            {retryConnection && <button type="button" disabled={pending} onClick={() => void connectWithSession().catch(() => useGameStore.getState().setError('Unable to connect. Try again.'))}>Retry connection</button>}
            {handoff.kind !== 'none' && <button type="button" onClick={() => { setHandoff({ kind: 'none' }); consumeDeckHandoff(); }}>Dismiss deck link</button>}
          </div>
        </div>}
        <div className="lobby-room-actions" data-page-stage data-entered={entered}>
          <button type="button" className="lobby-create" disabled={!!blockReason || !!roomId}
            aria-describedby={status ? 'room-setup-reason' : undefined} onClick={() => submitRoom('create')}>Create New Room</button>
          <form className="join-row" onSubmit={event => { event.preventDefault(); submitRoom('join'); }}>
            <input
              type="text"
              placeholder="Room code"
              aria-label="Room code" maxLength={128} disabled={pending}
              value={joinId}
              onChange={(e) => setJoinId(e.target.value)}
            />
            <button type="submit" aria-describedby={status ? 'room-setup-reason' : undefined} disabled={!joinId.trim() || !!blockReason || !!roomId}>
              Join Room
            </button>
          </form>
        </div>

        {roomId && <p className="lobby-room">Your Room ID: <strong>{roomId}</strong></p>}
      </section>
    </div>
  );
}
