import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CardDetail, CardSurface, WorkspaceHeader, CardCountControls, CatalogTile, Toast, cardArt, applyManaStyleFromUrl, applyCardFaceFromUrl, usePageEntrance, useConfirmation, openAccountMenu } from '@card-game/ui';
import { publicSession, PublicApiError } from '@card-game/browser-session';
import { DECK_RULES, validateDeck, type SessionInfo, type PlatformInfo, type CatalogCard, type DeckInput, type SavedDeck } from '@card-game/protocol';
import { AccountMenu } from './components/AccountMenu';
import DeckLibrary from './components/DeckLibrary';
import deckHeader from './assets/deck-header.webp';

/* Rune treatment is per page load, from `?mana=1..5`. The deck catalogue is where the
   most cards are on screen, so this page has to honour the switch too. */
applyManaStyleFromUrl();
/* `?card=original` puts the untouched card face back for comparison. */
applyCardFaceFromUrl();
import { BuilderApi } from './api';
import { builderConfig } from './config';
import { changeCopies, setCopies, deckCount, eligibleDeckCount, editableDeck, exportDeck, filterCatalog, importDeck, newDraft, type CatalogFilter } from './model';
import { gameDeckUrl, gameDestination } from './handoff';
import { readDraftRecovery, recoverSavedDeck, tabStorage, writeDraft, writeSession, type DraftTarget } from './storage';

const api = new BuilderApi(publicSession);
type Screen = 'library' | 'editor' | 'import' | 'export';
const message = (error: unknown) => error instanceof Error ? error.message : 'Unable to complete this request.';
export function DeckPreview({ draft, cards }: { draft: DeckInput; cards: readonly CatalogCard[] }) {
  const catalog = new Map(cards.map(card => [card.id, card]));
  const validation = validateDeck({ ...draft, name: draft.name.trim() || 'Draft' }, catalog);
  const count = eligibleDeckCount(draft, catalog);
  const excluded = deckCount(draft) - count;
  const missing = DECK_RULES.minCards - count;
  const issues = !draft.cards.length || validation.valid ? [] :
    validation.issues.filter(issue => issue.code !== 'size' || count >= DECK_RULES.minCards);
  return <section aria-label="Deck validation" className="validation" aria-live="polite">
    <strong>{count} / {DECK_RULES.minCards} minimum cards · maximum {DECK_RULES.maxCards}</strong>
    {excluded > 0 && <p>{excluded} {excluded === 1 ? 'card needs' : 'cards need'} correction before counting toward the minimum.</p>}
    {!draft.name.trim() && <p>Give your deck a name before saving.</p>}
    {missing > 0 && <p>Add {missing} more {missing === 1 ? 'card' : 'cards'} to reach the minimum.</p>}
    {validation.valid && draft.name.trim() && <p>Ready to save and play.</p>}
    {!!issues.length && <ul>{issues.map((issue, index) => <li key={index}>{issue.cardId ? (catalog.get(issue.cardId)?.name ?? issue.cardId) + ' — ' : ''}{issue.message}</li>)}</ul>}
  </section>;
}

export default function App() {
  const { confirm, dialog } = useConfirmation();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [authorityUnavailable, setAuthorityUnavailable] = useState(false);
  const [platform, setPlatform] = useState<PlatformInfo | null>(null);
  const [recovery] = useState(() => readDraftRecovery(tabStorage()));
  const [draft, setDraft] = useState<DeckInput>(recovery.draft);
  const [target, setTarget] = useState<DraftTarget | null>(recovery.target);
  const targetRef = useRef(target);
  const changeTarget = (value: DraftTarget | null) => { targetRef.current = value; setTarget(value); };
  const [saved, setSaved] = useState<SavedDeck | null>(null), [decks, setDecks] = useState<SavedDeck[]>([]);
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [cards, setCards] = useState<CatalogCard[]>([]), [catalogReady, setCatalogReady] = useState(false);
  const [catalogError, setCatalogError] = useState(''), [catalogRevision, setCatalogRevision] = useState(0);
  const [listBusy, setListBusy] = useState(true), [listRevision, setListRevision] = useState(0);
  const [listError, setListError] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [storageWarning, setStorageWarning] = useState(false);
  const [screen, setScreen] = useState<Screen>('library');
  const [exportFrom, setExportFrom] = useState<'library' | 'editor'>('library');
  const heading = useRef<HTMLHeadingElement>(null);
  const libraryScroll = useRef(0);
  const screenChanged = useRef(false);
  useLayoutEffect(() => {
    if (!screenChanged.current) return;
    heading.current?.focus({ preventScroll: true });
    window.scrollTo({ top: screen === 'library' ? libraryScroll.current : 0, behavior: 'instant' });
  }, [screen]);
  const navigate = (next: Screen) => {
    if (screen === 'library') libraryScroll.current = window.scrollY;
    screenChanged.current = true;
    setScreen(next);
  };
  const [detail, setDetail] = useState<{ card: CatalogCard; rect: DOMRect } | null>(null);
  const [username, setUsername] = useState(''), [password, setPassword] = useState('');
  const [text, setText] = useState('');
  const [exportName, setExportName] = useState('');
  const [exportText, setExportText] = useState('');
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
    setSaved(null); changeTarget(null); setDecks([]); setSelectedDeckId(null); setListError(''); setBusy(false); setListBusy(false);
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
    setListBusy(true); setListError('');
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
        setListError(message(reason));
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
  const hasDraft = !!draft.name.trim() || draft.cards.length > 0;
  const configuredGameBase = platform && typeof window !== 'undefined' ? new URL(platform.navigation.play, window.location.origin).href : null;
  let gameBase = '', playUrl = '', destinationError = '';
  try { if (configuredGameBase) { gameBase = gameDestination(configuredGameBase); if (saved && !dirty) playUrl = gameDeckUrl(gameBase, saved.id); } } catch { destinationError = 'The game destination is misconfigured. Contact the operator.'; }
  const safeDeckUrl = (id: string) => { try { return gameBase && !authorityUnavailable ? gameDeckUrl(gameBase, id) : ''; } catch { return ''; } };
  const locked = busy;
  const checkingSavedDeck = !!target && !saved;
  const saveDisabled = !session || authorityUnavailable || locked || listBusy || checkingSavedDeck || !catalogReady || !validation.valid;
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
      setSelectedDeckId(value.id);
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
  async function replaceDraft(value: DeckInput, record: SavedDeck | null) {
    const currentEpoch = epoch.current;
    if (hasDraft && dirty && !await confirm({ title: 'Replace the current draft?', message: 'You’ll lose the unsaved edits to this deck.', confirmLabel: 'Replace draft' })) return false;
    if (currentEpoch !== epoch.current) return false;
    setSaved(record); changeTarget(record && session?.account ? { accountId: session.account.id, deckId: record.id } : null); edit(value);
    setImportError(''); setImportResult('');
    return true;
  }

  async function openEditor(deck?: SavedDeck) {
    if (deck && target?.deckId === deck.id && target.accountId === session?.account?.id) {
      navigate('editor');
      return;
    }
    if (await replaceDraft(deck ? editableDeck(deck) : newDraft(), deck ?? null)) navigate('editor');
  }

  function openExport(deck: DeckInput, from: 'library' | 'editor') {
    setExportFrom(from);
    setExportName(deck.name || 'Untitled deck');
    setExportText(exportDeck(deck));
    navigate('export');
  }

  async function manageDeck(deck: SavedDeck, action: 'duplicate' | 'delete') {
    if (!session?.account || authorityUnavailable || busy || listBusy) return;
    const currentEpoch = epoch.current;
    const currentDraft = target?.deckId === deck.id;
    if (action === 'delete' && !await confirm({ title: 'Delete saved deck?',
      message: currentDraft && dirty ? `Delete “${deck.name}”? Your edits will remain as a new draft.` : `“${deck.name}” will be removed from your library.`,
      confirmLabel: 'Delete deck' })) return;
    if (currentEpoch !== epoch.current) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (action === 'duplicate') {
        const copy = await api.save({ ...editableDeck(deck), name: deck.name.slice(0, 73).trimEnd() + ' (copy)' });
        if (currentEpoch !== epoch.current) return;
        setDecks(previous => [...previous, copy]); setSelectedDeckId(copy.id);
        setNotice(`Created “${copy.name}”.`);
      } else {
        await api.remove(deck.id);
        if (currentEpoch !== epoch.current) return;
        setDecks(previous => previous.filter(item => item.id !== deck.id));
        setSelectedDeckId(id => id === deck.id ? null : id);
        if (targetRef.current?.deckId === deck.id) {
          changeTarget(null); setSaved(null);
          if (!dirty) setDraft(newDraft());
        }
        setNotice(`Deleted “${deck.name}”.`);
      }
    } catch (reason) {
      if (currentEpoch !== epoch.current) return;
      if (reason instanceof PublicApiError && reason.status === 503) setAuthorityUnavailable(true);
      else {
        if (reason instanceof PublicApiError && (reason.status === 401 || reason.status === 403)) changeSession(null);
        setError(message(reason));
      }
    } finally { if (currentEpoch === epoch.current) setBusy(false); }
  }

  async function importDraft() {
    setImportError(''); setImportResult('');
    try {
      const value = importDeck(text);
      if (!await replaceDraft(value, null)) { setImportResult('Import cancelled. Your current draft is unchanged.'); return; }
      const count = eligibleDeckCount(value, catalog);
      const excluded = deckCount(value) - count;
      setImportResult(`Imported ${count} eligible ${count === 1 ? 'card' : 'cards'}.` +
        (excluded ? ` ${excluded} ${excluded === 1 ? 'entry needs' : 'copies need'} correction in the editor.` : ''));
      setText('');
      navigate('editor');
    } catch (reason) { setImportError(message(reason)); }
  }

  return <>
    {dialog}
    <WorkspaceHeader navigation={platform?.navigation ?? null} scenariosAvailable={!!platform?.capabilities.scenarios} current="decks" account={session?.account ?? null} breadcrumb={`Decks / ${screen === 'library' ? 'Library' : screen === 'editor' ? 'Editor' : screen === 'import' ? 'Import' : 'Export'}`} accountMenu={<AccountMenu session={session} busy={busy} username={username} onUsername={setUsername} password={password} onPassword={setPassword} onAuthenticate={(action) => void authenticate(action)} onLogout={(all) => void logout(all)} />} />
    <main className="decks-page">
    {screen === 'library' ? <header className="library-header">
      <h1 ref={heading} tabIndex={-1}>Deck library</h1>
      <div className="deck-page-actions">
        <button disabled={locked} onClick={() => navigate('import')}>Import</button>
        <button className="library-primary" disabled={locked} onClick={() => void openEditor()}>New deck</button>
      </div>
    </header> : <div className="deck-view-header">
      <button onClick={() => navigate(screen === 'export' ? exportFrom : 'library')} disabled={locked}>
        {screen === 'export' && exportFrom === 'editor' ? '← Back to editor' : '← Back to decks'}
      </button>
      <h1 ref={heading} tabIndex={-1}>{screen === 'editor' ? 'Deck editor' : screen === 'import' ? 'Import deck' : 'Export deck'}</h1>
      {screen === 'editor' && <details className="library-more">
        <summary aria-label="More editor actions">More</summary>
        <div>
          <button disabled={locked || !hasDraft} onClick={() => openExport(draft, 'editor')}>Export draft</button>
          {saved && <button disabled={saveDisabled} onClick={event => {
            const menu = event.currentTarget.closest('details');
            if (menu) { menu.open = false; menu.querySelector('summary')?.focus(); }
            void save(true);
          }}>Save a copy</button>}
        </div>
      </details>}
    </div>}
    {error ? <Toast message={error} tone="error" onDismiss={() => setError('')} />
      : notice ? <Toast message={notice} tone="info" onDismiss={() => setNotice('')} /> : null}
    {storageWarning && <p role="status">Draft recovery is unavailable in this browser. Export your work before leaving.</p>}
    {authorityUnavailable && <p role="status">Account service unavailable. You can edit or export your draft. Saving and Play will return when the service is back.{' '}
      <button disabled={listBusy} onClick={() => setListRevision(value => value + 1)}>Retry account service</button></p>}
    {destinationError && <p role="alert">{destinationError}</p>}
    <div hidden={screen !== 'library'}>
      {hasDraft && <section className="library-draft" aria-label="Current draft">
        <div><strong>{draft.name.trim() || 'Untitled deck'}</strong>
          <span>{dirty ? 'Unsaved draft' : 'Open deck'} · {deckCount(draft)} cards</span></div>
        <button disabled={locked} onClick={() => navigate('editor')}>Resume editing</button>
      </section>}
      <DeckLibrary decks={decks} catalog={catalog} catalogReady={catalogReady} signedIn={!!session}
        loading={listBusy || busy && !session} loadError={listError} busy={locked}
        canManage={!!session && !authorityUnavailable && !listBusy && !locked}
        selectedId={selectedDeckId} onSelect={setSelectedDeckId} onSignIn={openAccountMenu}
        onRefresh={() => setListRevision(value => value + 1)} onEdit={deck => void openEditor(deck)}
        onDuplicate={deck => void manageDeck(deck, 'duplicate')} onDelete={deck => void manageDeck(deck, 'delete')}
        onExport={deck => openExport(deck, 'library')} playUrl={safeDeckUrl} />
    </div>
    {screen === 'editor' && <div className="workbench">
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
            <div className="catalog-grid">{filtered.map((card, index) => {
              const quantity = draft.cards.find(entry => entry.cardId === card.id)?.quantity ?? 0;
              /* What is still addable: copies left under this card's limit, capped by the
                 room left in the deck as a whole. Recomputed on every render, so the number
                 follows each add/remove immediately. */
              const remaining = Math.min(
                (card.copyLimit ?? DECK_RULES.maxCards) - quantity,
                DECK_RULES.maxCards - deckCount(draft),
              );
              return <CatalogTile key={card.id} index={index} selected={quantity > 0} description={card.rulesText || 'No rules text.'} onClick={(event) => {
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
          <h2>Deck list <small>{deckCount(draft)} cards</small></h2>
          {importResult && <p role="status">{importResult}</p>}
          <label>Deck name <input maxLength={80} value={draft.name} disabled={locked} onChange={event => edit({ ...draft, name: event.target.value })} placeholder="Give this deck a name" /></label>
          <div className="toolbar">
            <button className="library-primary" disabled={saveDisabled || !dirty} onClick={() => void save()}>{busy ? 'Working…' : !dirty ? 'Saved' : 'Save deck'}</button>
            {playUrl && session && !authorityUnavailable && catalogReady && validation.valid && <a className="primary-link" href={playUrl}>Play deck</a>}
          </div>
          {catalogReady ? <DeckPreview draft={draft} cards={cards} /> : <p>Validation needs the catalog.</p>}
          {!session && <p>Sign in from the account menu to save your deck.</p>}
          {checkingSavedDeck && <p role="status">Verifying your saved deck. <button onClick={() => setListRevision(value => value + 1)} disabled={listBusy || locked}>Retry</button></p>}
          <ul className="deck-list">{draft.cards.map(entry => {
            const card = catalog.get(entry.cardId);
            const name = card?.name ?? entry.cardId;
            return <li key={entry.cardId}>
              <div><strong>{name}</strong></div>
              <CardCountControls label={name} quantity={entry.quantity} disabled={locked || !catalogReady} canAdd={catalogReady && !!card?.deckLegal && deckCount(draft) < DECK_RULES.maxCards && entry.quantity < (card.copyLimit ?? DECK_RULES.maxCards)} onChange={delta => edit(changeCopies(draft,entry.cardId,delta))}
                onQuantity={quantity => { const result = setCopies(draft, entry.cardId, quantity, catalog); if (!result.error && result.deck !== draft) edit(result.deck); return result.error; }} />
              <button aria-label={'Remove all ' + name} disabled={locked} onClick={() => edit(changeCopies(draft, entry.cardId, -entry.quantity))}>×</button>
            </li>;
          })}</ul>
          {!platform && saved && <p>Game navigation is unavailable. Reload before playing this deck.</p>}
      </aside>
    </div>}
    {screen === 'import' && <form className="deck-transfer" onSubmit={event => {
      event.preventDefault();
      if (catalogReady && text.trim() && !locked) void importDraft();
    }}>
          <p>Paste one entry per line in the form <code>4 empire-servant</code>.</p>
          {!catalogReady && <p>Load the catalog to check card IDs before importing.</p>}
          {catalogError && <button type="button" onClick={() => setCatalogRevision(value => value + 1)}>Retry catalog</button>}
          <label>Deck text<textarea rows={10} maxLength={builderConfig.maxImportBytes} value={text} onChange={event => setText(event.target.value)} /></label>
          <button className="library-primary" type="submit" disabled={locked || !catalogReady || !text.trim()}>Import and edit</button>
          {importError && <p role="alert">{importError} Your current draft is unchanged.</p>}
          {importResult && <p role="status">{importResult}</p>}
    </form>}
    {screen === 'export' && <section className="deck-transfer" aria-label="Export deck">
      <h2>{exportName}</h2>
      <label>Deck text<textarea rows={10} readOnly value={exportText} onFocus={event => event.currentTarget.select()} /></label>
      <button className="library-primary" onClick={async () => {
        try { await navigator.clipboard.writeText(exportText); setError(''); setNotice('Deck copied.'); }
        catch { setError('Clipboard unavailable. Select the deck text and copy it manually.'); }
      }}>Copy deck text</button>
    </section>}
    </main>
    {detail && <CardDetail card={detail.card} art={cardArt(detail.card.id)} origin={detail.rect} onClose={() => setDetail(null)} />}
  </>;
}
