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
import { BuilderApi } from './api';
import { builderConfig } from './config';
import { changeCopies, setCopies, deckCount, editableDeck, exportDeck, filterCatalog, importDeck, newDraft, type CatalogFilter } from './model';
import { gameDeckUrl, gameDestination } from './handoff';
import { readDraftRecovery, recoverSavedDeck, tabStorage, writeDraft, writeSession, type DraftTarget } from './storage';

const api = new BuilderApi(publicSession);
const message = (error: unknown) => error instanceof Error ? error.message : 'Unable to complete this request.';
export function DeckPreview({ draft, cards }: { draft: DeckInput; cards: readonly CatalogCard[] }) {
  const catalog = new Map(cards.map(card => [card.id, card]));
  const validation = validateDeck({ ...draft, name: draft.name.trim() || 'Draft' }, catalog);
  const count = deckCount(draft);
  const issues = !draft.cards.length ? [{ message: `Add ${DECK_RULES.minCards} cards to start your deck.`, cardId: undefined }]
    : validation.valid ? [] : validation.issues;
  return <section aria-label="Deck validation" className="validation" aria-live="polite">
    <strong>{count} / {DECK_RULES.minCards} minimum cards · maximum {DECK_RULES.maxCards}</strong>
    <p>Up to {DECK_RULES.maxCopies} copies per card unless its rules grant an exception.</p>
    {!draft.name.trim() && <p>Give your deck a name before saving.</p>}
    {count > 0 && count < DECK_RULES.minCards && <p>Add {DECK_RULES.minCards - count} more cards to reach the minimum.</p>}
    {!issues.length && draft.name.trim() ? <p>Ready to save and play.</p> : <ul>{issues.map((issue, index) => <li key={index}>{issue.cardId ? issue.cardId + ': ' : ''}{issue.message}</li>)}</ul>}
  </section>;
}

export default function App() {
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [authorityUnavailable, setAuthorityUnavailable] = useState(false);
  const [platform, setPlatform] = useState<PlatformInfo | null>(null);
  const [recovery] = useState(() => readDraftRecovery(tabStorage()));
  const [draft, setDraft] = useState<DeckInput>(recovery.draft);
  const [target, setTarget] = useState<DraftTarget | null>(recovery.target);
  const targetRef = useRef(target);
  const changeTarget = (value: DraftTarget | null) => { targetRef.current = value; setTarget(value); };
  const [saved, setSaved] = useState<SavedDeck | null>(null), [decks, setDecks] = useState<SavedDeck[]>([]);
  /* The saved deck whose cards the catalogue is previewing; null = the normal full list. */
  const [previewDeck, setPreviewDeck] = useState<SavedDeck | null>(null);
  const [cards, setCards] = useState<CatalogCard[]>([]), [catalogReady, setCatalogReady] = useState(false);
  const [catalogError, setCatalogError] = useState(''), [catalogRevision, setCatalogRevision] = useState(0);
  const [listBusy, setListBusy] = useState(false), [listRevision, setListRevision] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [storageWarning, setStorageWarning] = useState(false);
  const [tab, setTab] = useState<'create' | 'saved' | 'transfer'>('create');
  /* Leaving My Decks drops the preview, so the catalogue is always back to all cards when
     the player works in Create or Import/Export. */
  useEffect(() => {
    if (tab !== 'saved') setPreviewDeck(null);
  }, [tab]);
  const [detail, setDetail] = useState<{ card: CatalogCard; rect: DOMRect } | null>(null);
  const [username, setUsername] = useState(''), [password, setPassword] = useState('');
  const [text, setText] = useState('');
  const [importError, setImportError] = useState(''), [importResult, setImportResult] = useState('');
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
    setAuthorityUnavailable(false);
    setSaved(null); changeTarget(null); setDecks([]); setBusy(false); setListBusy(false);
  };
  useEffect(() => { setStorageWarning(!writeDraft(tabStorage(), draft, target)); }, [draft, target]);
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
    let verifiedAccountId: string | undefined;
    setListBusy(true);
    void publicSession.me(controller.signal).then(identity => {
      if (controller.signal.aborted || currentEpoch !== epoch.current) return null;
      setAuthorityUnavailable(!!identity.authorityUnavailable);
      if (!identity.session) {
        if (session) changeSession(null);
        else { setSaved(null); changeTarget(null); }
        return [];
      }
      verifiedAccountId = identity.session.account?.id;
      if (targetRef.current && targetRef.current.accountId !== verifiedAccountId) changeTarget(null);
      if (identity.session.sessionId !== session?.sessionId) { setSession(identity.session); setSaved(null); setDecks([]); }
      if (identity.authorityUnavailable) return null;
      return api.decks(controller.signal);
    }).then(value => {
      if (value && !controller.signal.aborted && currentEpoch === epoch.current) {
        setDecks(value);
        const record = recoverSavedDeck(targetRef.current, verifiedAccountId, value);
        setSaved(record);
        if (!record) changeTarget(null);
      }
    }).catch(reason => {
      if (controller.signal.aborted || currentEpoch !== epoch.current) return;
      if (reason instanceof PublicApiError && reason.status === 503) setAuthorityUnavailable(true);
      else {
        if (reason instanceof PublicApiError && (reason.status === 401 || reason.status === 403)) changeSession(null);
        setError(message(reason));
      }
    }).finally(() => { if (!controller.signal.aborted && currentEpoch === epoch.current) setListBusy(false); });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const watchExpiry = () => {
      if (!session || currentEpoch !== epoch.current) return;
      const remaining = session.expiresAt - Date.now();
      if (remaining > 0) timer = setTimeout(watchExpiry, Math.min(remaining, 2_147_483_647));
      else {
        changeSession(null);
        setError('Your session expired. Sign in again. Your draft is still here.');
      }
    };
    watchExpiry();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [session?.sessionId, listRevision, busy]);

  const catalog = useMemo(() => new Map(cards.map(card => [card.id, card])), [cards]);
  const filtered = useMemo(() => filterCatalog(cards.filter(card => !card.retired), filter), [cards, filter]);
  const validation = validateDeck(draft, catalog);
  const dirty = !saved || JSON.stringify(draft) !== JSON.stringify(editableDeck(saved));
  const configuredGameBase = platform && typeof window !== 'undefined' ? new URL(platform.navigation.play, window.location.origin).href : null;
  let gameBase = '', playUrl = '', destinationError = '';
  try { if (configuredGameBase) { gameBase = gameDestination(configuredGameBase); if (saved && !dirty) playUrl = gameDeckUrl(gameBase, saved.id); } } catch { destinationError = 'The game destination is misconfigured. Contact the operator.'; }
  const safeDeckUrl = (id: string) => { try { return gameBase && !authorityUnavailable ? gameDeckUrl(gameBase, id) : ''; } catch { return ''; } };
  const locked = busy;
  const checkingSavedDeck = !!target && !saved;
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
    try {
      await publicSession.logout(all);
      if (epoch.current === currentEpoch) setNotice(all ? 'All public sessions ended. Your draft remains here.' : 'Signed out this browser. Your draft remains here.');
    } catch (reason) {
      if (epoch.current === currentEpoch) setError(reason instanceof PublicApiError ? reason.message : 'Server sign-out could not be confirmed.');
    }
    finally { if (epoch.current === currentEpoch) setBusy(false); }
  }
  async function save(asNew = false) {
    if (!session?.account || authorityUnavailable || !catalogReady || !validation.valid || busy || listBusy || checkingSavedDeck) return;
    const currentEpoch = epoch.current; setBusy(true); setError(''); setNotice('');
    try {
      const value = await api.save(validation.deck, asNew ? undefined : saved?.id);
      if (currentEpoch !== epoch.current) return;
      setDraft(editableDeck(value)); setSaved(value);
      changeTarget({ accountId: session.account.id, deckId: value.id });
      setDecks(previous => [...previous.filter(deck => deck.id !== value.id), value]);
      setNotice(asNew ? 'New copy saved. You are now editing the copy.' : saved ? 'Saved deck updated.' : 'Deck saved. Play it in the game, or keep editing.');
    } catch (reason) {
      if (currentEpoch !== epoch.current) return;
      if (reason instanceof PublicApiError && reason.status === 503) setAuthorityUnavailable(true);
      else {
        if (reason instanceof PublicApiError && (reason.status === 401 || reason.status === 403)) changeSession(null);
        if (reason instanceof PublicApiError && reason.status === 404) { setSaved(null); changeTarget(null); }
        setError(message(reason));
      }
    } finally { if (currentEpoch === epoch.current) setBusy(false); }
  }
  function replaceDraft(value: DeckInput, record: SavedDeck | null) {
    if (deckCount(draft) > 0 && dirty && typeof window !== 'undefined' && !window.confirm('Replace the current draft? Unsaved changes will be lost.')) return false;
    setSaved(record); changeTarget(record && session?.account ? { accountId: session.account.id, deckId: record.id } : null); edit(value);
    setImportError(''); setImportResult('');
    return true;
  }

  return <>
    <WorkspaceHeader navigation={platform?.navigation ?? null} scenariosAvailable={!!platform?.capabilities.scenarios} current="decks" account={session?.account ?? null} breadcrumb="Decks / Builder" accountMenu={<AccountMenu session={session} busy={busy} username={username} onUsername={setUsername} password={password} onPassword={setPassword} onAuthenticate={(action) => void authenticate(action)} onLogout={(all) => void logout(all)} />} />
    <main>
    <header><div><p className="eyebrow">CARD GAME / DECK WORKSHOP</p><h1>Build your next game.</h1><p>Explore the cards, shape a deck, then take it to the table.</p></div></header>
    {error ? <Toast message={error} tone="error" onDismiss={() => setError('')} />
      : notice ? <Toast message={notice} tone="info" onDismiss={() => setNotice('')} /> : null}
    {storageWarning && <p role="status">Draft recovery is unavailable in this browser. Export your work before leaving.</p>}
    {authorityUnavailable && <p role="status">Account service unavailable. You can edit or export your draft. Saving and Play will return when the service is back.{' '}
      <button disabled={listBusy} onClick={() => setListRevision(value => value + 1)}>Retry account service</button></p>}
    <div className="workbench">
      <section className="catalog" aria-label="Card catalog">
        {previewDeck
          ? <h2>Deck: {previewDeck.name} <small>{previewDeck.cards.reduce((total, entry) => total + entry.quantity, 0)} cards</small> <button type="button" className="catalog-show-all" onClick={() => setPreviewDeck(null)}>Show all</button></h2>
          : <h2>Card catalog <small>{filtered.length} results</small></h2>}
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
            <div className="catalog-grid">{previewDeck ? previewDeck.cards.map((entry, index) => {
              const card = catalog.get(entry.cardId);
              /* Read-only preview: inert actions, a missing id still gets a tile so the
                 card count matches the saved deck. */
              return <CatalogTile key={entry.cardId} index={index} count={entry.quantity} id={entry.cardId} description={card ? (card.rulesText || 'No rules text.') : 'This card is not in the current catalog.'} onClick={card ? ((event) => {
                if ((event.target as Element).closest('button')) return;
                setDetail({ card, rect: event.currentTarget.getBoundingClientRect() });
              }) : undefined} action={<button disabled>{card ? 'In deck' : 'Missing'}</button>}>
                {card ? <CardSurface card={card} art={cardArt(card.id)} /> : <div className="tile-missing" aria-hidden="true" />}
              </CatalogTile>;
            }) : filtered.map((card, index) => {
              const quantity = draft.cards.find(entry => entry.cardId === card.id)?.quantity ?? 0;
              /* What is still addable: copies left under this card's limit, capped by the
                 room left in the deck as a whole. Recomputed on every render, so the number
                 follows each add/remove immediately. */
              const remaining = Math.min(
                (card.copyLimit ?? DECK_RULES.maxCards) - quantity,
                DECK_RULES.maxCards - deckCount(draft),
              );
              return <CatalogTile key={card.id} index={index} selected={quantity > 0} id={card.id} description={card.rulesText || 'No rules text.'} onClick={(event) => {
                if ((event.target as Element).closest('button')) return;
                setDetail({ card, rect: event.currentTarget.getBoundingClientRect() });
              }} action={
                <button disabled={locked || !catalogReady || !card.deckLegal || remaining <= 0} onClick={() => edit(changeCopies(draft, card.id, 1))} aria-label={`Add ${card.name} (${Math.max(0, remaining)} left)`} title={card.deckLegal ? undefined : 'Not legal in saved decks'}>{remaining <= 0 ? 'Full' : `+ Add (${remaining})`}</button>
              }>
                <CardSurface card={card} art={cardArt(card.id)} />
              </CatalogTile>;
            })}</div>
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
            <button disabled={!session || authorityUnavailable || locked || listBusy || checkingSavedDeck || !catalogReady || !validation.valid} onClick={() => void save()}>{busy ? 'Working…' : saved ? 'Update saved deck' : 'Save deck'}</button>
            {saved && <button disabled={!session || authorityUnavailable || locked || listBusy || !catalogReady || !validation.valid} onClick={() => void save(true)}>Save as new</button>}
          </div>
          {catalogReady ? <DeckPreview draft={draft} cards={cards} /> : <p>Validation needs the catalog.</p>}
          {!session && <p>Sign in from the account menu to save your deck.</p>}
          {checkingSavedDeck && <p role="status">Verifying your saved deck. If this does not finish, refresh My Decks before saving.</p>}
          <ul className="deck-list">{draft.cards.map(entry => <li key={entry.cardId}>
            <div><strong>{catalog.get(entry.cardId)?.name ?? entry.cardId}</strong><small>{entry.cardId}</small></div>
            <CardCountControls label={entry.cardId} quantity={entry.quantity} disabled={locked || !catalogReady} canAdd={catalogReady && !!catalog.get(entry.cardId)?.deckLegal && deckCount(draft) < DECK_RULES.maxCards && entry.quantity < (catalog.get(entry.cardId)?.copyLimit ?? DECK_RULES.maxCards)} onChange={delta => edit(changeCopies(draft,entry.cardId,delta))}
              onQuantity={quantity => { const result = setCopies(draft, entry.cardId, quantity, catalog); if (!result.error && result.deck !== draft) edit(result.deck); return result.error; }} />
            <button aria-label={'Remove all ' + entry.cardId} disabled={locked} onClick={() => edit(changeCopies(draft, entry.cardId, -entry.quantity))}>×</button>
          </li>)}</ul>
          {saved && <p>{dirty ? 'Unsaved changes. Save before playing this version.' : 'This version is saved.'}</p>}
          {playUrl && session && !authorityUnavailable && catalogReady && validation.valid && <><a className="primary-link" href={playUrl}>Play this deck →</a><p className="hint">Continues to Play in this tab. Your draft is kept here when you return to Decks.</p></>}
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
              const active = previewDeck?.id === deck.id;
              return <li key={deck.id} className={active ? 'is-preview' : undefined}>
                <button disabled={locked || listBusy} aria-pressed={active} onClick={() => { setPreviewDeck(deck); setTab('saved'); }}>{deck.name}</button>
                <span className="saved-deck-meta">·{deck.cards.reduce((total, entry) => total + entry.quantity, 0)}
                  <span className="card-back" aria-hidden="true" />
                </span>
                <span className="saved-deck-details"><time dateTime={new Date(deck.updatedAt).toISOString()}>Updated {new Date(deck.updatedAt).toLocaleString()}</time><small title={deck.id}>#{deck.id.slice(0, 8)}</small></span>
                <button type="button" className="saved-deck-edit" disabled={locked || listBusy} onClick={() => { setPreviewDeck(null); replaceDraft(editableDeck(deck), deck); setTab('create'); }}>Edit</button>
                {href && <a className="saved-deck-play" href={href}>Play</a>}
              </li>;
            })}</ul>}
            </div>}
          </> : <p>Sign in from the account menu to load your saved decks.</p>}
        </div>

        <div className="deck-panel" role="tabpanel" id="deck-panel-transfer" aria-labelledby="deck-tab-transfer" hidden={tab !== 'transfer'}>
          <h2>Import / export</h2>
          <p>One line per card: <code>4 empire-servant</code>. Use the card IDs shown in the catalog.</p>
          <BuilderTransfer maxLength={builderConfig.maxImportBytes} label="Deck text" importLabel="Import text" exportLabel="Export deck to text" text={text} onText={setText} disabled={locked} onImport={() => {
            setImportError(''); setImportResult('');
            try { const value = importDeck(text); if (replaceDraft(value, null)) setImportResult(`Imported ${deckCount(value)} cards. Review the validation below.`); else setImportResult('Import cancelled. Your current draft is unchanged.'); }
            catch (reason) { setImportError(message(reason)); }
          }} onExport={() => setText(exportDeck(draft))} />
          {importError && <p role="alert">{importError} Your current draft is unchanged.</p>}
          {importResult && <section aria-label="Import result"><p role="status">{importResult}</p>{catalogReady && <DeckPreview draft={draft} cards={cards} />}<button onClick={() => setTab('create')}>Open in editor</button></section>}
        </div>
      </aside>
    </div>
    </main>
    {detail && <CardDetail card={detail.card} art={cardArt(detail.card.id)} origin={detail.rect} onClose={() => setDetail(null)} />}
  </>;
}
