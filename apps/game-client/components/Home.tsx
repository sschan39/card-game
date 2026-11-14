import { useEffect, useState } from 'react';
import { DeckListResponseSchema, type SavedDeck, type SessionInfo } from '@card-game/protocol';
import { publicSession, verifyRoomResume } from '@card-game/browser-session';
import { usePageEntrance } from '@card-game/ui';
import { getStoredAuth, getStoredRoomId } from '../session';
import homeHero from '../assets/home-hero.webp';

/* The deck endpoint returns at most five rows, so the skeleton reserves exactly
   that many: the list takes the same box whether it ends up with one deck or five
   and the page never reflows when the response lands. */
const DECK_ROWS = 5;

export default function Home({ identity, decksUrl }: { identity: SessionInfo | null; decksUrl?: string }) {
  const [decks, setDecks] = useState<SavedDeck[]>([]), [loaded, setLoaded] = useState(false), [error, setError] = useState(''), [resume, setResume] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController(); setDecks([]); setLoaded(false); setError(''); setResume(null);
    if (identity) void publicSession.request('/api/decks?offset=0&limit=5', { signal: controller.signal }).then(value => {
      const parsed = DeckListResponseSchema.parse(value); if (!controller.signal.aborted) setDecks(parsed.decks);
    }).catch(() => { if (!controller.signal.aborted) setError('Unable to load your decks. Open Decks or retry sign-in.'); })
      .finally(() => { if (!controller.signal.aborted) setLoaded(true); });
    else setLoaded(true);
    const room = getStoredRoomId(), session = getStoredAuth();
    if (room && session) void verifyRoomResume(room, session, controller.signal).then(() => {
      if (!controller.signal.aborted) setResume(room);
    }).catch(() => { /* A stale/unavailable room never becomes a resume link. */ });
    return () => controller.abort();
  }, [identity?.sessionId]);
  /* The entrance waits for the artwork and the first deck page, then runs once over
     the complete content. The skeleton next to it covers the wait, so the page is
     never blank and the fade never plays over half-filled markup. */
  const entered = usePageEntrance({ ready: loaded, images: [homeHero] });
  return <main className="home-screen">
    <section className="home-hero" data-page-stage data-entered={entered}>
      <div className="lobby-backs" aria-hidden="true">
        <span className="card-back" /><span className="card-back" /><span className="card-back" />
      </div>
      <h1>Welcome to Card Game</h1>
      <p>Build a deck, join a table, or continue your game.</p>
      <nav aria-label="Home shortcuts">
        <a className="home-cta home-cta-primary" href="/play">Create or join a room</a>
        {decksUrl && <a className="home-cta" href={decksUrl}>Build or edit decks</a>}
      </nav>
      {resume && <p className="home-resume"><a href={'/play/rooms/' + encodeURIComponent(resume)}>Resume room {resume}</a></p>}
      {!identity && <p className="home-note">Use the account menu to sign in once for Home, Play and Decks. Browsing and drafting are public.</p>}
    </section>
    <section className="home-decks">
      <h2>Your decks</h2>{error && <p role="alert">{error}</p>}
      <div className="page-stage-layer">
        <div className="home-decks-skeleton" data-page-skeleton data-entered={entered} aria-hidden="true">
          {Array.from({ length: DECK_ROWS }, (_, index) => <span key={index} className="skeleton-block" />)}
        </div>
        <div data-page-stage data-entered={entered}>
          {!loaded ? <p className="home-loading">Loading your decks…</p> : decks.length ? <ul>{decks.map(deck => <li key={deck.id}>
            <strong>{deck.name}</strong>
            <span className="home-deck-meta">·{deck.cards.reduce((total, entry) => total + entry.quantity, 0)} cards</span>
            <a className="home-deck-play" href={'/play?deckId=' + encodeURIComponent(deck.id)} target="_blank" rel="noopener noreferrer"
              aria-label={`Play ${deck.name} in a new tab`} title="Play this deck in a new tab">
              Play
            </a>
          </li>)}</ul> : <p className="home-empty">No saved decks yet.{decksUrl && <> <a href={decksUrl}>Build your first deck</a>.</>}</p>}
        </div>
      </div>
      <p className="home-note">Active games stay in their own tabs. Only a room owned by this game tab can be resumed here.</p>
    </section>
  </main>;
}
