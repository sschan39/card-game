import { useEffect, useRef, useState } from 'react';
import type { SavedDeck } from '@card-game/protocol';
import { usePageEntrance, useT, type MessageKey } from '@card-game/ui';
import { useAuthStore } from '../auth-state';
import { loadSavedDecks } from '../decks';
import { useGameActions } from '../hooks/useGameActions';
import { useGameStore } from '../store/gameStore';
import { consumeDeckHandoff, ownedHandoffDeck, readDeckHandoff, type DeckHandoff } from '../deck-handoff';
import playHero from '../assets/play-hero.webp';

export default function StartScreen({ decksUrl, leaving = false }: { decksUrl?: string; leaving?: boolean } = {}) {
  const t = useT();
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
  /* Both notices are stored as data, not sentences: the deck name and the failure key
     re-render in the active language without re-running the request that produced them. */
  const [loading, setLoading] = useState(false), [handoffNotice, setHandoffNotice] = useState('');
  const [deckError, setDeckError] = useState<MessageKey | null>(null), [refresh, setRefresh] = useState(0);
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
        if (selected) { setDeckId(selected.id); setHandoffNotice(selected.name); setHandoff({ kind: 'none' }); consumeDeckHandoff(); }
        else setDeckError('play.deckUnavailable');
      }
    }).catch(() => { if (!controller.signal.aborted) setDeckError('play.loadDecksFailed'); })
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
        <h1>{t('play.title')}</h1>
        <p className="lobby-lede">{t('play.lede')}</p>
        {decksUrl ? <a href={decksUrl}>{t('play.buildDeck')}</a> : <p>{t('play.workspaceMissing')}</p>}
      </section>

      <section className="lobby-actions">
        <div className="lobby-block" data-page-stage data-entered={entered}>
          <div className="lobby-head">
            <div>
              <h2>{t('play.openTable')}</h2>
              <p>{t('play.openTableHint')}</p>
            </div>
            <button disabled={loading || handoff.kind !== 'none'} onClick={() => createRoom(deckId || undefined)}>{t('play.createRoom')}</button>
          </div>
        </div>

        <div className="lobby-block" data-page-stage data-entered={entered}>
          <h2>{t('play.joinTable')}</h2>
          <p>{t('play.joinHint')}</p>
          <div className="join-row">
            <input
              type="text"
              placeholder={t('play.joinPlaceholder')}
              value={joinId}
              onChange={(e) => setJoinId(e.target.value)}
            />
            <button onClick={() => joinRoom(joinId.trim(), deckId || undefined)} disabled={!joinId.trim() || loading || handoff.kind !== 'none'}>
              {t('play.join')}
            </button>
          </div>
        </div>

        {handoff.kind !== 'none' && <div className="lobby-block lobby-notice" role="status">
          <p>{handoff.kind === 'invalid' ? t('play.handoffInvalid') : !session?.account ? t('play.handoffSignIn') : deckError ? t('play.handoffFailed') : t('play.handoffChecking')}</p>
          <button onClick={() => { setHandoff({ kind: 'none' }); consumeDeckHandoff(); setDeckError(null); }}>{t('play.dismissHandoff')}</button>
        </div>}
        {handoffNotice && <p role="status">{t('play.selectedDeck', { deck: handoffNotice })}</p>}

        {session?.account && <div className="deck-selection page-stage-layer">
          <div className="deck-selection-skeleton" data-page-skeleton data-entered={entered} aria-hidden="true">
            <span className="skeleton-block" />
          </div>
          <div className="deck-selection-body" data-page-stage data-entered={entered}>
            <label>{t('play.deck')} <select disabled={loading || handoff.kind !== 'none'} value={deckId} onChange={event => { setDeckId(event.target.value); setHandoffNotice(''); }}>
              <option value="">{t('play.noDeck')}</option>
              {decks.map(deck => <option key={deck.id} value={deck.id}>{deck.name}</option>)}
            </select></label>
            <button onClick={() => setRefresh(value => value + 1)}>{t('play.refreshDecks')}</button>
            {loading && <p role="status">{t('play.loadingDecks')}</p>}
            {deckError && <p role="alert">{t(deckError)}</p>}
          </div>
        </div>}

        {roomId && <p className="lobby-room">{t('play.yourRoom')} <strong>{roomId}</strong></p>}
      </section>
    </div>
  );
}
