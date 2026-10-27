import { useEffect, useState } from 'react';
import type { SavedDeck } from '@card-game/protocol';
import { useAuthStore } from '../auth-state';
import { loadSavedDecks } from '../decks';
import { useGameActions } from '../hooks/useGameActions';
import { useGameStore } from '../store/gameStore';

export default function StartScreen() {
  const { createRoom, joinRoom } = useGameActions();
  const roomId = useGameStore((s) => s.roomId);
  const [joinId, setJoinId] = useState('');
  const session = useAuthStore(state => state.session);
  const [decks, setDecks] = useState<SavedDeck[]>([]), [deckId, setDeckId] = useState('');
  const [deckError, setDeckError] = useState<string | null>(null), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    setDecks([]); setDeckId(''); setDeckError(null);
    if (!session?.account) return;
    const controller = new AbortController();
    void loadSavedDecks(session.token, controller.signal).then(value => { if (!controller.signal.aborted) setDecks(value); })
      .catch(() => { if (!controller.signal.aborted) setDeckError('Unable to load saved decks. Retry or sign in again.'); });
    return () => controller.abort();
  }, [session?.token, session?.account?.id, refresh]);

  return (
    <div className="start-screen">
      <h1>Multiplayer Card Game</h1>
      {session?.account && <div className="deck-selection">
        <label>Deck <select value={deckId} onChange={event => setDeckId(event.target.value)}>
          <option value="">No saved deck selected</option>
          {decks.map(deck => <option key={deck.id} value={deck.id}>{deck.name}</option>)}
        </select></label>
        <button onClick={() => setRefresh(value => value + 1)}>Refresh decks</button>
        {deckError && <p role="alert">{deckError}</p>}
      </div>}
      <button onClick={() => createRoom(deckId || undefined)}>Create New Room</button>
      <div>
        <input
          type="text"
          placeholder="Enter Room ID to join"
          value={joinId}
          onChange={(e) => setJoinId(e.target.value)}
        />
        <button onClick={() => joinRoom(joinId.trim(), deckId || undefined)} disabled={!joinId.trim()}>
          Join Room
        </button>
      </div>
      {roomId && <p>Your Room ID: <strong>{roomId}</strong></p>}
    </div>
  );
}
