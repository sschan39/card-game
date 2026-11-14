import { useEffect, useMemo, useRef, useState } from 'react';
import { CardDetail, CardSurface, WorkspaceHeader, CardCountControls, CatalogTile, BuilderTransfer, Toast, cardArt, applyManaStyleFromUrl, applyCardFaceFromUrl, usePageEntrance } from '@card-game/ui';
import { publicSession, PublicApiError } from '@card-game/browser-session';
import { DECK_RULES, validateDeck, type SessionInfo, type PlatformInfo, type CatalogCard, type DeckInput, type SavedDeck } from '@card-game/protocol';
import { AccountMenu } from './components/AccountMenu';
import deckHeader from './assets/deck-header.webp';

/* Rune treatment is per page load, from `?mana=1..5`. The deck catalogue is where the
   most cards are on screen, so this page has to honour the switch too. */
applyManaStyleFromUrl();
/* `?card=original` puts the untouched card face back for comparison. */
applyCardFaceFromUrl();
import { BuilderApi, BuilderApiError } from './api';
import { builderConfig } from './config';
import { changeCopies, deckCount, editableDeck, exportDeck, filterCatalog, importDeck, newDraft, type CatalogFilter } from './model';
import { gameDeckUrl, gameDestination } from './handoff';
import { readDraft, tabStorage, writeDraft, writeSession } from './storage';

const api = new BuilderApi(undefined, publicSession);
const message = (error: unknown) => error instanceof Error ? error.message : 'Unable to complete this request.';
export function DeckPreview({ draft, cards }: { draft: DeckInput; cards: readonly CatalogCard[] }) {
  const catalog = new Map(cards.map(card => [card.id, card])), validation = validateDeck(draft, catalog);
  return <section aria-label="Deck validation" className="validation" aria-live="polite">
    <strong>{deckCount(draft)} cards · {draft.format}</strong>
    {validation.valid ? <p>Ready to save and play.</p> : <ul>{validation.issues.map((issue, index) => <li key={index}>{issue.cardId ? issue.cardId + ': ' : ''}{issue.message}</li>)}</ul>}
  </section>;
}

export default function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [platform, setPlatform] = useState<PlatformInfo | null>(null);
  const [draft, setDraft] = useState<DeckInput>(() => readDraft(tabStorage()));
  const [saved, setSaved] = useState<SavedDeck | null>(null), [decks, setDecks] = useState<SavedDeck[]>([]);
  const [cards, setCards] = useState<CatalogCard[]>([]), [catalogReady, setCatalogReady] = useState(false);
  const [catalogError, setCatalogError] = useState(''), [catalogRevision, setCatalogRevision] = useState(0);
  const [listBusy, setListBusy] = useState(false), [listRevision, setListRevision] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [storageWarning, setStorageWarning] = useState(false);
  const [tab, setTab] = useState<'create' | 'saved' | 'transfer'>('create');
  const [detail, setDetail] = useState<{ card: CatalogCard; rect: DOMRect } | null>(null);
  const [username, setUsername] = useState(''), [password, setPassword] = useState('');
  const [text, setText] = useState('');
  const [filter, setFilter] = useState<CatalogFilter>({ search: '', type: '', color: '', legalOnly: true });
  const epoch = useRef(0);
  /* The catalogue is what every panel on this page reads from, so the entrance waits
     for it (and for the header artwork) before it runs. The skeletons hold both boxes
     in the meantime; a request that outlives the 400ms ceiling leaves the loading text
     in place instead of an empty grid. */
  const entered = usePageEntrance({ ready: catalogReady, images: [deckHeader] });
  useEffect(() => () => { epoch.current++; }, []);
  const changeSession = (value: SessionInfo | null) => {
    epoch.current++; writeSession(tabStorage(), null); setSession(value);
    setSaved(null); setDecks([]); setBusy(false);
  };
  useEffect(() => { setStorageWarning(!writeDraft(tabStorage(), draft)); }, [draft]);
  useEffect(() => {
    if (busy) return;
    const refresh = () => { if (document.visibilityState === 'visible') setListRevision(value => value + 1); };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [busy]);
  useEffect(() => {
    const controller = new AbortController();
    writeSession(tabStorage(), null);
    void publicSession.platform(controller.signal).then(value => { if (!controller.signal.aborted) setPlatform(value); }).catch(() => { if (!controller.signal.aborted) setError('Navigation is unavailable. Reload or check server configuration.'); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setCatalogError(''); setCatalogReady(false);
    void api.catalog(controller.signal).then(value => {
      if (!controller.signal.aborted) { setCards(value); setCatalogReady(true); }
    }).catch(reason => { if (!controller.signal.aborted) setCatalogError(message(reason)); });
    return () => controller.abort();
  }, [catalogRevision]);
  useEffect(() => {
    if (busy) { setListBusy(false); return; }
    const controller = new AbortController(), currentEpoch = epoch.current;
    setListBusy(true);
    void publicSession.me(controller.signal).then(identity => {
      if (controller.signal.aborted || currentEpoch !== epoch.current) return null;
      if (!identity.session) { if (session) changeSession(null); return []; }
      if (identity.session.sessionId !== session?.sessionId) { setSession(identity.session); setSaved(null); setDecks([]); }
      return api.decks(undefined, controller.signal);
    }).then(value => {
      if (value && !controller.signal.aborted && currentEpoch === epoch.current) setDecks(value);
    }).catch(reason => {
      if (controller.signal.aborted || currentEpoch !== epoch.current) return;
      if ((reason instanceof BuilderApiError || reason instanceof PublicApiError) && (reason.status === 401 || reason.status === 403)) changeSession(null);
      setError(message(reason));
    }).finally(() => { if (!controller.signal.aborted && currentEpoch === epoch.current) setListBusy(false); });
    const timer = session ? setTimeout(() => {
      if (currentEpoch === epoch.current) { changeSession(null); setError('Your session expired. Sign in again; your draft is still here.'); }
    }, Math.max(0, session.expiresAt - Date.now())) : undefined;
    return () => { controller.abort(); clearTimeout(timer); };
  }, [session?.sessionId, listRevision, busy]);

  const catalog = useMemo(() => new Map(cards.map(card => [card.id, card])), [cards]);
  const filtered = useMemo(() => filterCatalog(cards, filter), [cards, filter]);
  const validation = validateDeck(draft, catalog);
  const dirty = !saved || JSON.stringify(draft) !== JSON.stringify(editableDeck(saved));
  const configuredGameBase = platform && typeof window !== 'undefined' ? new URL(platform.navigation.play, window.location.origin).href : null;
  let gameBase = '', playUrl = '', destinationError = '';
  try { if (configuredGameBase) { gameBase = gameDestination(configuredGameBase); if (saved && !dirty) playUrl = gameDeckUrl(gameBase, saved.id); } } catch { destinationError = 'The game destination is misconfigured. Contact the operator.'; }
  const safeDeckUrl = (id: string) => { try { return gameBase ? gameDeckUrl(gameBase, id) : ''; } catch { return ''; } };
  const locked = busy;
  const edit = (value: DeckInput) => { setDraft(value); setNotice(''); setError(''); };
  async function authenticate(action: 'login' | 'register') {
    const currentEpoch = epoch.current; setBusy(true); setError('');
    try {
      const value = await publicSession.authenticate(action, username, password);
      if (currentEpoch === epoch.current) { changeSession(value.session); setNotice('Signed in. Your draft is ready to save.'); }
    } catch (reason) { if (currentEpoch === epoch.current) setError(message(reason)); }
    finally { setPassword(''); if (currentEpoch === epoch.current) setBusy(false); }
  }
  async function logout(all = false) {
    if (!session) return;
    changeSession(null); const currentEpoch = epoch.current;
    setBusy(true);
    setError(''); setNotice('');
    try { await publicSession.logout(all); if (epoch.current === currentEpoch) setNotice(all ? 'All public sessions ended. Your draft remains here.' : 'Signed out this browser. Your draft remains here.'); } catch { if (epoch.current === currentEpoch) setError('Server sign-out failed. The browser session may remain valid. Retry sign-out before leaving a shared device.'); }
    finally { if (epoch.current === currentEpoch) setBusy(false); }
  }
  async function save(asNew = false) {
    if (!session || !catalogReady || !validation.valid || busy || listBusy) return;
    const currentEpoch = epoch.current; setBusy(true); setError(''); setNotice('');
    try {
      const value = await api.save(undefined, validation.deck, asNew ? undefined : saved?.id);
      if (currentEpoch !== epoch.current) return;
      setDraft(editableDeck(value)); setSaved(value);
      setDecks(previous => [...previous.filter(deck => deck.id !== value.id), value]);
      setNotice('Deck saved. Play it in the game, or keep editing.');
    } catch (reason) {
      if (currentEpoch !== epoch.current) return;
      if ((reason instanceof BuilderApiError || reason instanceof PublicApiError) && (reason.status === 401 || reason.status === 403)) changeSession(null);
      if (reason instanceof BuilderApiError && reason.status === 404) setSaved(null);
      setError(message(reason));
    } finally { if (currentEpoch === epoch.current) setBusy(false); }
  }
  function replaceDraft(value: DeckInput, record: SavedDeck | null) {
    if (deckCount(draft) > 0 && dirty && typeof window !== 'undefined' && !window.confirm('Replace the current draft? Unsaved changes will be lost.')) return;
    setSaved(record); edit(value);
  }

  return <>
    <WorkspaceHeader navigation={platform?.navigation ?? null} scenariosAvailable={!!platform?.capabilities.scenarios} current="decks" account={session?.account ?? null} breadcrumb="Decks / Builder" accountMenu={<AccountMenu session={session} busy={busy} username={username} onUsername={setUsername} password={password} onPassword={setPassword} onAuthenticate={(action) => void authenticate(action)} onLogout={(all) => void logout(all)} />} />
    <main>
    <header><div><p className="eyebrow">CARD GAME / DECK WORKSHOP</p><h1>Build your next game.</h1><p>Explore the cards, shape a deck, then take it to the table.</p></div></header>
    {error ? <Toast message={error} tone="error" onDismiss={() => setError('')} />
      : notice ? <Toast message={notice} tone="info" onDismiss={() => setNotice('')} /> : null}
    {storageWarning && <p role="status">Draft recovery is unavailable in this browser. Export your work before leaving.</p>}
    <div className="workbench">
      <section className="catalog" aria-label="Card catalog">
        <h2>Card catalog <small>{filtered.length} results</small></h2>
        <div className="filters">
          <label>Search <input type="search" placeholder="Name, rules, or card ID" value={filter.search} onChange={event => setFilter({ ...filter, search: event.target.value })} /></label>
          <label>Type <select value={filter.type} onChange={event => setFilter({ ...filter, type: event.target.value })}><option value="">All types</option>{[...new Set(cards.flatMap(card => card.cardTypes))].sort().map(type => <option key={type}>{type}</option>)}</select></label>
          <label>Color <select value={filter.color} onChange={event => setFilter({ ...filter, color: event.target.value })}><option value="">All colors</option><option value="colorless">Colorless</option>{[...new Set(cards.flatMap(card => card.colors))].sort().map(color => <option key={color}>{color}</option>)}</select></label>
          <label className="checkbox"><input type="checkbox" checked={filter.legalOnly} onChange={event => setFilter({ ...filter, legalOnly: event.target.checked })} />Deck-legal only</label>
        </div>
        <div className="catalog-stage page-stage-layer">
          <div className="catalog-skeleton skeleton-grid" data-page-skeleton data-entered={entered} aria-hidden="true">
            {Array.from({ length: 8 }, (_, index) => <span key={index} className="skeleton-block" />)}
          </div>
          <div data-page-stage data-entered={entered}>
            {catalogError ? <p role="alert">{catalogError} <button onClick={() => setCatalogRevision(value => value + 1)}>Retry catalog</button></p> : !catalogReady ? entered && <p role="status">Loading catalog…</p> : !filtered.length ? <p>No cards match these filters.</p> : null}
            <div className="catalog-grid">{filtered.map((card, index) => <CatalogTile key={card.id} index={index} id={card.id} description={card.rulesText || 'No rules text.'} onClick={(event) => {
          if ((event.target as Element).closest('button')) return;
          setDetail({ card, rect: event.currentTarget.getBoundingClientRect() });
        }} action={
          <button disabled={locked || !catalogReady || !card.deckLegal || deckCount(draft) >= DECK_RULES.maxCards || (draft.cards.find(entry => entry.cardId === card.id)?.quantity ?? 0) >= (card.copyLimit ?? DECK_RULES.maxCards)} onClick={() => edit(changeCopies(draft, card.id, 1))} aria-label={`Add ${card.name}${card.deckLegal && card.copyLimit !== null ? ` (max ${card.copyLimit})` : ''}`} title={card.deckLegal ? undefined : 'Not legal in saved decks'}>+ Add{card.deckLegal && card.copyLimit !== null ? ` (Max ${card.copyLimit})` : ''}</button>
        }>
          <CardSurface card={card} art={cardArt(card.id)} />
        </CatalogTile>)}</div>
          </div>
        </div>
      </section>
      <aside aria-label="Deck editor">
        <div className="deck-tabs" role="tablist" aria-label="Deck panels">
          <button type="button" role="tab" id="deck-tab-create" aria-selected={tab === 'create'} aria-controls="deck-panel-create" onClick={() => setTab('create')}>Create</button>
          <button type="button" role="tab" id="deck-tab-saved" aria-selected={tab === 'saved'} aria-controls="deck-panel-saved" onClick={() => setTab('saved')}>My Decks</button>
          <button type="button" role="tab" id="deck-tab-transfer" aria-selected={tab === 'transfer'} aria-controls="deck-panel-transfer" onClick={() => setTab('transfer')}>Import/Export</button>
        </div>

        <div className="deck-panel" role="tabpanel" id="deck-panel-create" aria-labelledby="deck-tab-create" hidden={tab !== 'create'}>
          <h2>Your decks</h2>
          <label>Deck name <input maxLength={80} value={draft.name} disabled={locked} onChange={event => edit({ ...draft, name: event.target.value })} placeholder="Give this deck a name" /></label>
          <div className="toolbar"><button disabled={locked} onClick={() => replaceDraft(newDraft(), null)}>New deck</button>
            <button disabled={!session || locked || listBusy || !catalogReady || !validation.valid} onClick={() => void save()}>{busy ? 'Working…' : saved ? 'Update saved deck' : 'Save deck'}</button>
            {saved && <button disabled={!session || locked || listBusy || !catalogReady || !validation.valid} onClick={() => void save(true)}>Save as new</button>}
          </div>
          {catalogReady ? <DeckPreview draft={draft} cards={cards} /> : <p>Validation needs the catalog.</p>}
          {!session && <p>Sign in from the account menu to save your deck.</p>}
          <ul className="deck-list">{draft.cards.map(entry => <li key={entry.cardId}>
            <div><strong>{catalog.get(entry.cardId)?.name ?? entry.cardId}</strong><small>{entry.cardId}</small></div>
            <CardCountControls label={entry.cardId} quantity={entry.quantity} disabled={locked} canAdd={catalogReady && !!catalog.get(entry.cardId)?.deckLegal && deckCount(draft) < DECK_RULES.maxCards && entry.quantity < (catalog.get(entry.cardId)?.copyLimit ?? DECK_RULES.maxCards)} onChange={delta => edit(changeCopies(draft,entry.cardId,delta))} />
            <button aria-label={'Remove all ' + entry.cardId} disabled={locked} onClick={() => edit(changeCopies(draft, entry.cardId, -entry.quantity))}>×</button>
          </li>)}</ul>
          {saved && <p>{dirty ? 'Unsaved changes. Save before playing this version.' : 'This version is saved.'}</p>}
          {playUrl && session && catalogReady && validation.valid && <><a className="primary-link" href={playUrl} target="_blank" rel="noopener noreferrer">Play this deck →</a><p className="hint">Opens a separate game tab using your browser sign-in. Your draft stays here and each game tab has its own seat.</p></>}
          {destinationError && <p role="alert">{destinationError}</p>}
          {!platform && saved && <p>Game navigation is unavailable. Reload before playing this deck.</p>}
        </div>

        <div className="deck-panel" role="tabpanel" id="deck-panel-saved" aria-labelledby="deck-tab-saved" hidden={tab !== 'saved'}>
          <h2>My decks</h2>
          {session ? <>
            <button className="deck-refresh" disabled={locked || listBusy} onClick={() => setListRevision(value => value + 1)}>Refresh</button>
            {listBusy ? <div className="saved-decks-skeleton" role="status" aria-label="Loading your decks">
              {Array.from({ length: 3 }, (_, index) => <span key={index} className="skeleton-block" aria-hidden="true" />)}
            </div> : <div className="saved-decks-result">
              {!decks.length ? <div className="saved-decks-empty">
                <p>No deck yet. Create one in the Create tab.</p>
                <button type="button" onClick={() => setTab('create')}>Create a deck</button>
              </div> : <ul className="saved-decks">{decks.map(deck => {
              const href = safeDeckUrl(deck.id);
              return <li key={deck.id}>
                <button disabled={locked || listBusy} onClick={() => replaceDraft(editableDeck(deck), deck)}>{deck.name}</button>
                <span className="saved-deck-meta">·{deck.cards.reduce((total, entry) => total + entry.quantity, 0)}
                  <span className="card-back" aria-hidden="true" />
                </span>
                {href && <a className="saved-deck-play" href={href} target="_blank" rel="noopener noreferrer">Play</a>}
              </li>;
            })}</ul>}
            </div>}
          </> : <p>Sign in from the account menu to load your saved decks.</p>}
        </div>

        <div className="deck-panel" role="tabpanel" id="deck-panel-transfer" aria-labelledby="deck-tab-transfer" hidden={tab !== 'transfer'}>
          <h2>Import / export</h2>
          <p>One line per card: <code>4 empire-servant</code>. Use the card IDs shown in the catalog.</p>
          <BuilderTransfer maxLength={builderConfig.maxImportBytes} label="Deck text" importLabel="Import text" exportLabel="Export deck to text" text={text} onText={setText} disabled={locked} onImport={() => { try { replaceDraft(importDeck(text), null); } catch (reason) { setError(message(reason)); } }} onExport={() => setText(exportDeck(draft))} />
        </div>
      </aside>
    </div>
    </main>
    {detail && <CardDetail card={detail.card} art={cardArt(detail.card.id)} origin={detail.rect} onClose={() => setDetail(null)} />}
  </>;
}
