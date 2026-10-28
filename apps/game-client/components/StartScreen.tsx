import { useEffect, useRef, useState } from 'react';
import type { SavedDeck } from '@card-game/protocol';
import { useAuthStore } from '../auth-state';
import { loadSavedDecks } from '../decks';
import { useGameActions } from '../hooks/useGameActions';
import { useGameStore } from '../store/gameStore';
import { consumeDeckHandoff, ownedHandoffDeck, readDeckHandoff, type DeckHandoff } from '../deck-handoff';
import { clientUi } from '../config';

export default function StartScreen() {
  const { createRoom, joinRoom } = useGameActions();
  const roomId = useGameStore((s) => s.roomId);
  const [joinId, setJoinId] = useState('');
  const session = useAuthStore(state => state.session);
  const [decks, setDecks] = useState<SavedDeck[]>([]), [deckId, setDeckId] = useState('');
  const [handoff, setHandoff] = useState<DeckHandoff>(() => readDeckHandoff(typeof window === 'undefined' ? '' : window.location.search));
  const handoffRef = useRef(handoff); handoffRef.current = handoff;
  const [loading, setLoading] = useState(false), [handoffNotice, setHandoffNotice] = useState('');
  const [deckError, setDeckError] = useState<string | null>(null), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const selectedBefore = deckId;
    setDecks([]); setDeckId(''); setDeckError(null); setHandoffNotice('');
    if (!session?.account) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    void loadSavedDecks(session.token, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      setDecks(value);
      if (value.some(deck => deck.id === selectedBefore)) setDeckId(selectedBefore);
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
    <div className="start-screen">
      <h1>Multiplayer Card Game</h1>
      <a href={import.meta.env.DEV ? clientUi.developmentBuilderUrl : '/deck-builder/'}>Build or edit a deck</a>
      {handoff.kind !== 'none' && <div role="status">
        <p>{handoff.kind === 'invalid' ? 'The deck link is invalid.' : !session?.account ? 'Sign in with the account that saved this deck. It will be selected after ownership is checked.' : deckError ? 'The requested deck could not be selected. See the error below.' : 'Checking the requested deck against your saved decks.'}</p>
        <button onClick={() => { setHandoff({ kind: 'none' }); consumeDeckHandoff(); setDeckError(null); }}>Dismiss deck link</button>
      </div>}
      {handoffNotice && <p role="status">{handoffNotice}</p>}
      {session?.account && <div className="deck-selection">
        <label>Deck <select disabled={loading || handoff.kind !== 'none'} value={deckId} onChange={event => { setDeckId(event.target.value); setHandoffNotice(''); }}>
          <option value="">No saved deck selected</option>
          {decks.map(deck => <option key={deck.id} value={deck.id}>{deck.name}</option>)}
        </select></label>
        <button onClick={() => setRefresh(value => value + 1)}>Refresh decks</button>
        {loading && <p role="status">Loading saved decks…</p>}
        {deckError && <p role="alert">{deckError}</p>}
      </div>}
      <button disabled={loading || handoff.kind !== 'none'} onClick={() => createRoom(deckId || undefined)}>Create New Room</button>
      <div>
        <input
          type="text"
          placeholder="Enter Room ID to join"
          value={joinId}
          onChange={(e) => setJoinId(e.target.value)}
        />
        <button onClick={() => joinRoom(joinId.trim(), deckId || undefined)} disabled={!joinId.trim() || loading || handoff.kind !== 'none'}>
          Join Room
        </button>
      </div>
      {roomId && <p>Your Room ID: <strong>{roomId}</strong></p>}
    </div>
  );
}
