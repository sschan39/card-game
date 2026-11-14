import { useEffect, useRef, useState } from 'react';
import type { SavedDeck } from '@card-game/protocol';
import { usePageEntrance } from '@card-game/ui';
import { useAuthStore } from '../auth-state';
import { loadSavedDecks } from '../decks';
import { useGameActions } from '../hooks/useGameActions';
import { useGameStore } from '../store/gameStore';
import { consumeDeckHandoff, ownedHandoffDeck, readDeckHandoff, type DeckHandoff } from '../deck-handoff';
import playHero from '../assets/play-hero.webp';

export default function StartScreen({ decksUrl, leaving = false }: { decksUrl?: string; leaving?: boolean } = {}) {
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
  const [decks, setDecks] = useState<SavedDeck[]>([]), [deckId, setDeckId] = useState('');
  const [handoff, setHandoff] = useState<DeckHandoff>(() => readDeckHandoff(typeof window === 'undefined' ? '' : window.location.search));
  const handoffRef = useRef(handoff); handoffRef.current = handoff;
  const [loading, setLoading] = useState(false), [handoffNotice, setHandoffNotice] = useState('');
  const [deckError, setDeckError] = useState<string | null>(null), [refresh, setRefresh] = useState(0);
  /* The lobby fades in once the play artwork has decoded and the saved-deck page has
     landed. The skeleton inside the deck picker covers the wait; a signed-out visitor
     has no deck request to wait for and needs no picker at all. */
  const entered = usePageEntrance({ ready: !loading, images: [playHero] });
  useEffect(() => {
    const selectedBefore = deckId;
    setDecks([]); setDeckId(''); setDeckError(null); setHandoffNotice('');
    if (!session?.account) { setLoading(false); return; }
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
        <div className="lobby-block" data-page-stage data-entered={entered}>
          <div className="lobby-head">
            <div>
              <h2>Open a table</h2>
              <p>Start a room and send the code to your opponent.</p>
            </div>
            <button disabled={loading || handoff.kind !== 'none'} onClick={() => createRoom(deckId || undefined)}>Create New Room</button>
          </div>
        </div>

        <div className="lobby-block" data-page-stage data-entered={entered}>
          <h2>Join a table</h2>
          <p>Enter the room code your opponent shared.</p>
          <div className="join-row">
            <input
              type="text"
              placeholder="Enter Room ID to join"
              value={joinId}
              onChange={(e) => setJoinId(e.target.value)}
            />
            <button onClick={() => joinRoom(joinId.trim(), deckId || undefined)} disabled={!joinId.trim() || loading || handoff.kind !== 'none'}>
              Join
            </button>
          </div>
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
