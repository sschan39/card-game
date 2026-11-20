import { useEffect, useMemo, useRef, useState } from 'react';
import { CardDetail, CardSurface, WorkspaceHeader, CardCountControls, CatalogTile, BuilderTransfer, Toast, cardArt, applyManaStyleFromUrl, applyCardFaceFromUrl, usePageEntrance, useT, useLocale, cardTypeLabel, colorLabel, type MessageKey } from '@card-game/ui';
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
import { changeCopies, deckCount, editableDeck, exportDeck, filterCatalog, importDeck, newDraft, type CatalogFilter } from './model';
import { gameDeckUrl, gameDestination } from './handoff';
import { readDraft, tabStorage, writeDraft, writeSession } from './storage';

const api = new BuilderApi(publicSession);
/** Validation code to its dictionary key; an unknown code falls back to the English message. */
const ISSUE_KEYS: Record<string, MessageKey> = {
  name_missing: 'builder.issueNameMissing',
  empty: 'builder.issueEmpty',
  size_below: 'builder.issueSizeBelow',
  size_above: 'builder.issueSizeAbove',
  structure: 'builder.issueStructure',
  duplicate: 'builder.issueDuplicate',
  unknown_card: 'builder.issueUnknownCard',
  illegal_card: 'builder.issueIllegalCard',
  copy_limit: 'builder.issueCopyLimit',
};
export function DeckPreview({ draft, cards }: { draft: DeckInput; cards: readonly CatalogCard[] }) {
  const t = useT();
  const catalog = new Map(cards.map(card => [card.id, card])), validation = validateDeck(draft, catalog);
  return <section aria-label={t('builder.deckValidation')} className="validation" aria-live="polite">
    <strong>{t('builder.deckSummary', { count: deckCount(draft), format: draft.format })}</strong>
    {validation.valid ? <p>{t('builder.readyToSave')}</p> : <ul>{validation.issues.map((issue, index) => {
      const key = ISSUE_KEYS[issue.code];
      return <li key={index}>{issue.cardId ? issue.cardId + ': ' : ''}{key ? t(key, issue.params) : issue.message}</li>;
    })}</ul>}
  </section>;
}

export default function App() {
  const locale = useLocale();
  const t = useT();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [platform, setPlatform] = useState<PlatformInfo | null>(null);
  const [draft, setDraft] = useState<DeckInput>(() => readDraft(tabStorage()));
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
    void publicSession.platform(controller.signal).then(value => { if (!controller.signal.aborted) setPlatform(value); }).catch(() => { if (!controller.signal.aborted) setError(t('builder.navigationUnavailable')); });
    return () => controller.abort();
  }, [t]);
  /* `locale` is the interface language, so the catalogue is re-fetched whenever it
     changes: the card text in the grid has to match the header. */
  useEffect(() => {
    const controller = new AbortController();
    setCatalogError(''); setCatalogReady(false);
    void api.catalog(locale, controller.signal).then(value => {
      if (!controller.signal.aborted) { setCards(value); setCatalogReady(true); }
    }).catch(reason => { if (!controller.signal.aborted) setCatalogError(reason instanceof Error ? reason.message : t('builder.unableToComplete')); });
    return () => controller.abort();
  }, [catalogRevision, locale, t]);
  useEffect(() => {
    if (busy) { setListBusy(false); return; }
    const controller = new AbortController(), currentEpoch = epoch.current;
    setListBusy(true);
    void publicSession.me(controller.signal).then(identity => {
      if (controller.signal.aborted || currentEpoch !== epoch.current) return null;
      if (!identity.session) { if (session) changeSession(null); return []; }
      if (identity.session.sessionId !== session?.sessionId) { setSession(identity.session); setSaved(null); setDecks([]); }
      return api.decks(controller.signal);
    }).then(value => {
      if (value && !controller.signal.aborted && currentEpoch === epoch.current) setDecks(value);
    }).catch(reason => {
      if (controller.signal.aborted || currentEpoch !== epoch.current) return;
      if ((reason instanceof PublicApiError) && (reason.status === 401 || reason.status === 403)) changeSession(null);
      setError(reason instanceof Error ? reason.message : t('builder.unableToComplete'));
    }).finally(() => { if (!controller.signal.aborted && currentEpoch === epoch.current) setListBusy(false); });
    const timer = session ? setTimeout(() => {
      if (currentEpoch === epoch.current) { changeSession(null); setError(t('builder.sessionExpired')); }
    }, Math.max(0, session.expiresAt - Date.now())) : undefined;
    return () => { controller.abort(); clearTimeout(timer); };
  }, [session?.sessionId, listRevision, busy, t]);

  const catalog = useMemo(() => new Map(cards.map(card => [card.id, card])), [cards]);
  const filtered = useMemo(() => filterCatalog(cards, filter), [cards, filter]);
  const validation = validateDeck(draft, catalog);
  const dirty = !saved || JSON.stringify(draft) !== JSON.stringify(editableDeck(saved));
  const configuredGameBase = platform && typeof window !== 'undefined' ? new URL(platform.navigation.play, window.location.origin).href : null;
  let gameBase = '', playUrl = '', destinationError = '';
  try { if (configuredGameBase) { gameBase = gameDestination(configuredGameBase); if (saved && !dirty) playUrl = gameDeckUrl(gameBase, saved.id); } } catch { destinationError = t('builder.destinationMisconfigured'); }
  const safeDeckUrl = (id: string) => { try { return gameBase ? gameDeckUrl(gameBase, id) : ''; } catch { return ''; } };
  const locked = busy;
  const edit = (value: DeckInput) => { setDraft(value); setNotice(''); setError(''); };
  async function authenticate(action: 'login' | 'register') {
    const currentEpoch = epoch.current; setBusy(true); setError('');
    try {
      const value = await publicSession.authenticate(action, username, password);
      if (currentEpoch === epoch.current) { changeSession(value.session); setNotice(t('builder.signedIn')); }
    } catch (reason) { if (currentEpoch === epoch.current) setError(reason instanceof Error ? reason.message : t('builder.unableToComplete')); }
    finally { setPassword(''); if (currentEpoch === epoch.current) setBusy(false); }
  }
  async function logout(all = false) {
    if (!session) return;
    changeSession(null); const currentEpoch = epoch.current;
    setBusy(true);
    setError(''); setNotice('');
    try { await publicSession.logout(all); if (epoch.current === currentEpoch) setNotice(all ? t('builder.allSessionsEnded') : t('builder.signedOutBrowser')); } catch { if (epoch.current === currentEpoch) setError(t('builder.signOutFailed')); }
    finally { if (epoch.current === currentEpoch) setBusy(false); }
  }
  async function save(asNew = false) {
    if (!session || !catalogReady || !validation.valid || busy || listBusy) return;
    const currentEpoch = epoch.current; setBusy(true); setError(''); setNotice('');
    try {
      const value = await api.save(validation.deck, asNew ? undefined : saved?.id);
      if (currentEpoch !== epoch.current) return;
      setDraft(editableDeck(value)); setSaved(value);
      setDecks(previous => [...previous.filter(deck => deck.id !== value.id), value]);
      setNotice(t('builder.deckSaved'));
    } catch (reason) {
      if (currentEpoch !== epoch.current) return;
      if ((reason instanceof PublicApiError) && (reason.status === 401 || reason.status === 403)) changeSession(null);
      if (reason instanceof PublicApiError && reason.status === 404) setSaved(null);
      setError(reason instanceof Error ? reason.message : t('builder.unableToComplete'));
    } finally { if (currentEpoch === epoch.current) setBusy(false); }
  }
  function replaceDraft(value: DeckInput, record: SavedDeck | null) {
    if (deckCount(draft) > 0 && dirty && typeof window !== 'undefined' && !window.confirm(t('builder.replaceConfirm'))) return;
    setSaved(record); edit(value);
  }

  return <>
    <WorkspaceHeader navigation={platform?.navigation ?? null} scenariosAvailable={!!platform?.capabilities.scenarios} current="decks" account={session?.account ?? null} breadcrumb="Decks / Builder" accountMenu={<AccountMenu session={session} busy={busy} username={username} onUsername={setUsername} password={password} onPassword={setPassword} onAuthenticate={(action) => void authenticate(action)} onLogout={(all) => void logout(all)} />} />
    <main>
    <header><div><p className="eyebrow">{t('builder.eyebrow')}</p><h1>{t('builder.title')}</h1><p>{t('builder.lede')}</p></div></header>
    {error ? <Toast message={error} tone="error" onDismiss={() => setError('')} />
      : notice ? <Toast message={notice} tone="info" onDismiss={() => setNotice('')} /> : null}
    {storageWarning && <p role="status">{t('builder.draftRecovery')}</p>}
    <div className="workbench">
      <section className="catalog" aria-label={t('builder.cardCatalog')}>
        {previewDeck
          ? <h2>{t('builder.deckPreview', { name: previewDeck.name })} <small>{t('builder.cardsCount', { count: previewDeck.cards.reduce((total, entry) => total + entry.quantity, 0) })}</small> <button type="button" className="catalog-show-all" onClick={() => setPreviewDeck(null)}>{t('builder.showAll')}</button></h2>
          : <h2>{t('builder.cardCatalog')} <small>{t('builder.results', { count: filtered.length })}</small></h2>}
        <div className="filters">
          <label>{t('builder.search')} <input type="search" placeholder={t('builder.searchPlaceholder')} value={filter.search} onChange={event => setFilter({ ...filter, search: event.target.value })} /></label>
          <label>{t('builder.type')} <select value={filter.type} onChange={event => setFilter({ ...filter, type: event.target.value })}><option value="">{t('builder.allTypes')}</option>{[...new Set(cards.flatMap(card => card.cardTypes))].sort().map(type => <option key={type} value={type}>{cardTypeLabel(type, t)}</option>)}</select></label>
          <label>{t('builder.color')} <select value={filter.color} onChange={event => setFilter({ ...filter, color: event.target.value })}><option value="">{t('builder.allColors')}</option><option value="colorless">{t('builder.colorless')}</option>{[...new Set(cards.flatMap(card => card.colors))].sort().map(color => <option key={color} value={color}>{colorLabel(color, t)}</option>)}</select></label>
          <label className="checkbox"><input type="checkbox" checked={filter.legalOnly} onChange={event => setFilter({ ...filter, legalOnly: event.target.checked })} />{t('builder.deckLegalOnly')}</label>
        </div>
        <div className="catalog-stage page-stage-layer">
          <div className="catalog-skeleton skeleton-grid" data-page-skeleton data-entered={entered} aria-hidden="true">
            {Array.from({ length: 8 }, (_, index) => <span key={index} className="skeleton-block" />)}
          </div>
          <div data-page-stage data-entered={entered}>
            {catalogError ? <p role="alert">{catalogError} <button onClick={() => setCatalogRevision(value => value + 1)}>{t('builder.retryCatalog')}</button></p> : !catalogReady ? entered && <p role="status">{t('builder.loadingCatalog')}</p> : !filtered.length ? <p>{t('builder.noMatch')}</p> : null}
            <div className="catalog-grid">{previewDeck ? previewDeck.cards.map((entry, index) => {
              const card = catalog.get(entry.cardId);
              /* Read-only preview: inert actions, a missing id still gets a tile so the
                 card count matches the saved deck. */
              return <CatalogTile key={entry.cardId} index={index} count={entry.quantity} id={entry.cardId} description={card ? (card.rulesText || t('builder.noRulesText')) : t('builder.notInCatalog')} onClick={card ? ((event) => {
                if ((event.target as Element).closest('button')) return;
                setDetail({ card, rect: event.currentTarget.getBoundingClientRect() });
              }) : undefined} action={<button disabled>{card ? t('builder.inDeck') : t('builder.missing')}</button>}>
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
              return <CatalogTile key={card.id} index={index} selected={quantity > 0} id={card.id} description={card.rulesText || t('builder.noRulesText')} onClick={(event) => {
                if ((event.target as Element).closest('button')) return;
                setDetail({ card, rect: event.currentTarget.getBoundingClientRect() });
              }} action={
                <button disabled={locked || !catalogReady || !card.deckLegal || remaining <= 0} onClick={() => edit(changeCopies(draft, card.id, 1))} aria-label={t('builder.addLabel', { card: card.name, count: Math.max(0, remaining) })} title={card.deckLegal ? undefined : t('builder.notLegal')}>{remaining <= 0 ? t('builder.full') : t('builder.add', { count: remaining })}</button>
              }>
                <CardSurface card={card} art={cardArt(card.id)} />
              </CatalogTile>;
            })}</div>
          </div>
        </div>
      </section>
      <aside aria-label={t('builder.deckEditor')}>
        <div className="deck-tabs" role="tablist" aria-label={t('builder.deckPanels')}>
          <button type="button" role="tab" id="deck-tab-create" aria-selected={tab === 'create'} aria-controls="deck-panel-create" onClick={() => setTab('create')}>{t('builder.tabCreate')}</button>
          <button type="button" role="tab" id="deck-tab-saved" aria-selected={tab === 'saved'} aria-controls="deck-panel-saved" onClick={() => setTab('saved')}>{t('builder.tabSaved')}</button>
          <button type="button" role="tab" id="deck-tab-transfer" aria-selected={tab === 'transfer'} aria-controls="deck-panel-transfer" onClick={() => setTab('transfer')}>{t('builder.tabTransfer')}</button>
        </div>

        <div className="deck-panel" role="tabpanel" id="deck-panel-create" aria-labelledby="deck-tab-create" hidden={tab !== 'create'}>
          <h2>{t('builder.yourDecks')}</h2>
          <label>{t('builder.deckName')} <input maxLength={80} value={draft.name} disabled={locked} onChange={event => edit({ ...draft, name: event.target.value })} placeholder={t('builder.deckNamePlaceholder')} /></label>
          <div className="toolbar"><button disabled={locked} onClick={() => replaceDraft(newDraft(), null)}>{t('builder.newDeck')}</button>
            <button disabled={!session || locked || listBusy || !catalogReady || !validation.valid} onClick={() => void save()}>{busy ? t('builder.working') : saved ? t('builder.updateSaved') : t('builder.saveDeck')}</button>
            {saved && <button disabled={!session || locked || listBusy || !catalogReady || !validation.valid} onClick={() => void save(true)}>{t('builder.saveAsNew')}</button>}
          </div>
          {catalogReady ? <DeckPreview draft={draft} cards={cards} /> : <p>{t('builder.validationNeedsCatalog')}</p>}
          {!session && <p>{t('builder.signInToSave')}</p>}
          <ul className="deck-list">{draft.cards.map(entry => <li key={entry.cardId}>
            <div><strong>{catalog.get(entry.cardId)?.name ?? entry.cardId}</strong><small>{entry.cardId}</small></div>
            <CardCountControls label={entry.cardId} quantity={entry.quantity} disabled={locked} canAdd={catalogReady && !!catalog.get(entry.cardId)?.deckLegal && deckCount(draft) < DECK_RULES.maxCards && entry.quantity < (catalog.get(entry.cardId)?.copyLimit ?? DECK_RULES.maxCards)} onChange={delta => edit(changeCopies(draft,entry.cardId,delta))} />
            <button aria-label={t('builder.removeAll', { card: entry.cardId })} disabled={locked} onClick={() => edit(changeCopies(draft, entry.cardId, -entry.quantity))}>×</button>
          </li>)}</ul>
          {saved && <p>{dirty ? t('builder.unsaved') : t('builder.saved')}</p>}
          {playUrl && session && catalogReady && validation.valid && <><a className="primary-link" href={playUrl} target="_blank" rel="noopener noreferrer">{t('builder.playThisDeck')}</a><p className="hint">{t('builder.playHint')}</p></>}
          {destinationError && <p role="alert">{destinationError}</p>}
          {!platform && saved && <p>{t('builder.gameNavUnavailable')}</p>}
        </div>

        <div className="deck-panel" role="tabpanel" id="deck-panel-saved" aria-labelledby="deck-tab-saved" hidden={tab !== 'saved'}>
          <h2>{t('builder.myDecks')}</h2>
          {session ? <>
            <button className="deck-refresh" disabled={locked || listBusy} onClick={() => setListRevision(value => value + 1)}>{t('builder.refresh')}</button>
            {listBusy ? <div className="saved-decks-skeleton" role="status" aria-label={t('builder.loadingDecks')}>
              {Array.from({ length: 3 }, (_, index) => <span key={index} className="skeleton-block" aria-hidden="true" />)}
            </div> : <div className="saved-decks-result">
              {!decks.length ? <div className="saved-decks-empty">
                <p>{t('builder.noDeckYet')}</p>
                <button type="button" onClick={() => setTab('create')}>{t('builder.createADeck')}</button>
              </div> : <ul className="saved-decks">{decks.map(deck => {
              const href = safeDeckUrl(deck.id);
              const active = previewDeck?.id === deck.id;
              return <li key={deck.id} className={active ? 'is-preview' : undefined}>
                <button disabled={locked || listBusy} aria-pressed={active} onClick={() => { setPreviewDeck(deck); setTab('saved'); }}>{deck.name}</button>
                <span className="saved-deck-meta">·{deck.cards.reduce((total, entry) => total + entry.quantity, 0)}
                  <span className="card-back" aria-hidden="true" />
                </span>
                <button type="button" className="saved-deck-edit" disabled={locked || listBusy} onClick={() => { setPreviewDeck(null); replaceDraft(editableDeck(deck), deck); setTab('create'); }}>{t('builder.edit')}</button>
                {href && <a className="saved-deck-play" href={href} target="_blank" rel="noopener noreferrer">{t('builder.play')}</a>}
              </li>;
            })}</ul>}
            </div>}
          </> : <p>{t('builder.signInToLoad')}</p>}
        </div>

        <div className="deck-panel" role="tabpanel" id="deck-panel-transfer" aria-labelledby="deck-tab-transfer" hidden={tab !== 'transfer'}>
          <h2>{t('builder.importExport')}</h2>
          <p>{t('builder.importHelp', { example: '4 empire-servant' })}</p>
          <BuilderTransfer maxLength={builderConfig.maxImportBytes} label={t('builder.deckText')} importLabel={t('builder.importText')} exportLabel={t('builder.exportText')} text={text} onText={setText} disabled={locked} onImport={() => { try { replaceDraft(importDeck(text), null); } catch (reason) { setError(reason instanceof Error ? reason.message : t('builder.unableToComplete')); } }} onExport={() => setText(exportDeck(draft))} />
        </div>
      </aside>
    </div>
    </main>
    {detail && <CardDetail card={detail.card} art={cardArt(detail.card.id)} origin={detail.rect} onClose={() => setDetail(null)} />}
  </>;
}
