import { useEffect, useState } from 'react';
import { DeckListResponseSchema, type SavedDeck, type SessionInfo } from '@card-game/protocol';
import { publicSession, verifyRoomResume } from '@card-game/browser-session';
import { openAccountMenu, usePageEntrance } from '@card-game/ui';
import { getStoredAuth, getStoredRoomId } from '../session';
import homeHero from '../assets/home-hero.webp';

/* The deck endpoint returns at most five rows, so the skeleton reserves exactly
   that many: the list takes the same box whether it ends up with one deck or five
   and the page never reflows when the response lands. */
const DECK_ROWS = 5;

export default function Home({ identity, decksUrl }: { identity: SessionInfo | null; decksUrl?: string }) {
  const [reload, setReload] = useState(0);
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
  }, [identity?.sessionId, reload]);
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
      <ol className="setup-steps" aria-label="Getting started">
        <li>Sign in or create an account to save decks and play.</li>
        <li>Build a valid deck with 60–250 cards and save it.</li>
        <li>Select your saved deck in Play, then create or join a room.</li>
      </ol>
      <nav aria-label="Home shortcuts">
        {!identity ? <button className="home-cta home-cta-primary" onClick={openAccountMenu}>Sign in / Create account</button>
          : loaded && !error && !decks.length && decksUrl ? <a className="home-cta home-cta-primary" href={decksUrl}>Build your first deck</a>
          : <a className="home-cta home-cta-primary" href="/play">Create or join a room</a>}
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
            <a className="home-deck-play" href={'/play?deckId=' + encodeURIComponent(deck.id)}
              aria-label={`Play ${deck.name}`} title="Play this deck">
              Play
            </a>
          </li>)}</ul> : error ? <button onClick={() => setReload(value => value + 1)}>Retry loading decks</button> : !identity ? <p className="home-empty">Sign in to see your saved decks. You can browse and draft freely.</p> : <p className="home-empty">No saved decks yet.{decksUrl && <> <a href={decksUrl}>Build your first deck</a>.</>}</p>}
        </div>
      </div>
      <p className="home-note">Active games stay in their own tabs. Only a room owned by this game tab can be resumed here.</p>
    </section>
  </main>;
}
