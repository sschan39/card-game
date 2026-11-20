import { useEffect, useState } from 'react';
import { DeckListResponseSchema, type SavedDeck, type SessionInfo } from '@card-game/protocol';
import { publicSession, verifyRoomResume } from '@card-game/browser-session';
import { usePageEntrance, useT, type MessageKey } from '@card-game/ui';
import { getStoredAuth, getStoredRoomId } from '../session';
import homeHero from '../assets/home-hero.webp';

/* The deck endpoint returns at most five rows, so the skeleton reserves exactly
   that many: the list takes the same box whether it ends up with one deck or five
   and the page never reflows when the response lands. */
const DECK_ROWS = 5;

export default function Home({ identity, decksUrl }: { identity: SessionInfo | null; decksUrl?: string }) {
  const t = useT();
  /* The failure is stored as a message key rather than a sentence, so switching
     language re-renders it without re-running the request that failed. */
  const [decks, setDecks] = useState<SavedDeck[]>([]), [loaded, setLoaded] = useState(false), [error, setError] = useState<MessageKey | ''>(''), [resume, setResume] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController(); setDecks([]); setLoaded(false); setError(''); setResume(null);
    if (identity) void publicSession.request('/api/decks?offset=0&limit=5', { signal: controller.signal }).then(value => {
      const parsed = DeckListResponseSchema.parse(value); if (!controller.signal.aborted) setDecks(parsed.decks);
    }).catch(() => { if (!controller.signal.aborted) setError('home.deckError'); })
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
      <h1>{t('home.title')}</h1>
      <p>{t('home.subtitle')}</p>
      <nav aria-label={t('home.shortcuts')}>
        <a className="home-cta home-cta-primary" href="/play">{t('home.createRoom')}</a>
        {decksUrl && <a className="home-cta" href={decksUrl}>{t('home.buildDecks')}</a>}
      </nav>
      {resume && <p className="home-resume"><a href={'/play/rooms/' + encodeURIComponent(resume)}>{t('home.resume', { roomId: resume })}</a></p>}
      {!identity && <p className="home-note">{t('home.note')}</p>}
    </section>
    <section className="home-decks">
      <h2>{t('home.decks')}</h2>{error && <p role="alert">{t(error)}</p>}
      <div className="page-stage-layer">
        <div className="home-decks-skeleton" data-page-skeleton data-entered={entered} aria-hidden="true">
          {Array.from({ length: DECK_ROWS }, (_, index) => <span key={index} className="skeleton-block" />)}
        </div>
        <div data-page-stage data-entered={entered}>
          {!loaded ? <p className="home-loading">{t('home.loadingDecks')}</p> : decks.length ? <ul>{decks.map(deck => <li key={deck.id}>
            <strong>{deck.name}</strong>
            <span className="home-deck-meta">·{t('home.cardCount', { count: deck.cards.reduce((total, entry) => total + entry.quantity, 0) })}</span>
            <a className="home-deck-play" href={'/play?deckId=' + encodeURIComponent(deck.id)} target="_blank" rel="noopener noreferrer"
              aria-label={t('home.playDeckLabel', { deck: deck.name })} title={t('home.playDeckTitle')}>
              {t('home.playDeck')}
            </a>
          </li>)}</ul> : <p className="home-empty">{t('home.empty')}{decksUrl && <> <a href={decksUrl}>{t('home.buildFirst')}</a>.</>}</p>}
        </div>
      </div>
      <p className="home-note">{t('home.activeGames')}</p>
    </section>
  </main>;
}
