import { useEffect, useState } from 'react';
import { DeckListResponseSchema, type SavedDeck, type SessionInfo } from '@card-game/protocol';
import { publicSession, verifyRoomResume } from '@card-game/browser-session';
import { getStoredAuth, getStoredRoomId } from '../session';

export default function Home({ identity, decksUrl }: { identity: SessionInfo | null; decksUrl?: string }) {
  const [decks, setDecks] = useState<SavedDeck[]>([]), [error, setError] = useState(''), [resume, setResume] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController(); setDecks([]); setError(''); setResume(null);
    if (identity) void publicSession.request('/api/decks?offset=0&limit=5', { signal: controller.signal }).then(value => {
      const parsed = DeckListResponseSchema.parse(value); if (!controller.signal.aborted) setDecks(parsed.decks);
    }).catch(() => { if (!controller.signal.aborted) setError('Unable to load your decks. Open Decks or retry sign-in.'); });
    const room = getStoredRoomId(), session = getStoredAuth();
    if (room && session) void verifyRoomResume(room, session, controller.signal).then(() => {
      if (!controller.signal.aborted) setResume(room);
    }).catch(() => { /* A stale/unavailable room never becomes a resume link. */ });
    return () => controller.abort();
  }, [identity?.sessionId]);
  return <main className="home-screen"><h1>Welcome to Card Game</h1><p>Build a deck, join a table, or continue your game.</p>
    <nav aria-label="Home shortcuts"><a href="/play">Play / create or join a room</a>{decksUrl && <> · <a href={decksUrl}>Build or edit decks</a></>}</nav>
    {resume && <p><a href={'/play/rooms/' + encodeURIComponent(resume)}>Resume room {resume}</a></p>}
    {!identity && <p>Use the account menu to sign in once for Home, Play and Decks. Browsing and drafting are public.</p>}
    <h2>Your decks</h2>{error && <p role="alert">{error}</p>}
    {decks.length ? <ul>{decks.map(deck => <li key={deck.id}><strong>{deck.name}</strong> · <a href={'/play?deckId=' + encodeURIComponent(deck.id)} target="_blank" rel="noopener noreferrer">Play this deck in a new tab</a></li>)}</ul> : <p>No saved decks loaded yet. Open Decks to get started.</p>}
    <p>Active games stay in their own tabs. Only a room owned by this game tab can be resumed here.</p>
  </main>;
}
