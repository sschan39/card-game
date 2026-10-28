import { useEffect, useMemo, useRef, useState } from 'react';
import { CardSurface } from '@card-game/ui';
import { DECK_RULES, PASSWORD_LIMITS, validateDeck, type AuthResponse, type CatalogCard, type DeckInput, type SavedDeck } from '@card-game/protocol';
import { BuilderApi, BuilderApiError } from './api';
import { builderConfig } from './config';
import { changeCopies, deckCount, editableDeck, exportDeck, filterCatalog, importDeck, newDraft, type CatalogFilter } from './model';
import { gameDeckUrl, gameDestination } from './handoff';
import { readDraft, readSession, tabStorage, writeDraft, writeSession } from './storage';

const api = new BuilderApi();
const message = (error: unknown) => error instanceof Error ? error.message : 'Unable to complete this request.';
export function DeckPreview({ draft, cards }: { draft: DeckInput; cards: readonly CatalogCard[] }) {
  const catalog = new Map(cards.map(card => [card.id, card])), validation = validateDeck(draft, catalog);
  return <section aria-label="Deck validation" className="validation" aria-live="polite">
    <strong>{deckCount(draft)} cards · {draft.format}</strong>
    {validation.valid ? <p>Ready to save and play.</p> : <ul>{validation.issues.map((issue, index) => <li key={index}>{issue.cardId ? issue.cardId + ': ' : ''}{issue.message}</li>)}</ul>}
  </section>;
}

export default function App() {
  const [session, setSession] = useState<AuthResponse | null>(() => readSession(tabStorage()));
  const [draft, setDraft] = useState<DeckInput>(() => readDraft(tabStorage()));
  const [saved, setSaved] = useState<SavedDeck | null>(null), [decks, setDecks] = useState<SavedDeck[]>([]);
  const [cards, setCards] = useState<CatalogCard[]>([]), [catalogReady, setCatalogReady] = useState(false);
  const [catalogError, setCatalogError] = useState(''), [catalogRevision, setCatalogRevision] = useState(0);
  const [listBusy, setListBusy] = useState(false), [listRevision, setListRevision] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [storageWarning, setStorageWarning] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState(''), [password, setPassword] = useState('');
  const [text, setText] = useState('');
  const [filter, setFilter] = useState<CatalogFilter>({ search: '', type: '', color: '', legalOnly: true });
  const epoch = useRef(0);
  useEffect(() => () => { epoch.current++; }, []);
  const changeSession = (value: AuthResponse | null) => {
    epoch.current++; writeSession(tabStorage(), value); setSession(value);
    setSaved(null); setDecks([]); setBusy(false);
  };
  useEffect(() => { setStorageWarning(!writeDraft(tabStorage(), draft)); }, [draft]);
  useEffect(() => {
    if (!session || busy) return;
    const refresh = () => { if (document.visibilityState === 'visible') setListRevision(value => value + 1); };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [session?.token, busy]);
  useEffect(() => {
    const controller = new AbortController();
    setCatalogError(''); setCatalogReady(false);
    void api.catalog(controller.signal).then(value => {
      if (!controller.signal.aborted) { setCards(value); setCatalogReady(true); }
    }).catch(reason => { if (!controller.signal.aborted) setCatalogError(message(reason)); });
    return () => controller.abort();
  }, [catalogRevision]);
  useEffect(() => {
    if (!session) { setListBusy(false); return; }
    const controller = new AbortController(), currentEpoch = epoch.current;
    setListBusy(true);
    void api.verify(session.token, controller.signal).then(() => api.decks(session.token, controller.signal)).then(value => {
      if (!controller.signal.aborted && currentEpoch === epoch.current) setDecks(value);
    }).catch(reason => {
      if (controller.signal.aborted || currentEpoch !== epoch.current) return;
      if (reason instanceof BuilderApiError && (reason.status === 401 || reason.status === 403)) changeSession(null);
      setError(message(reason));
    }).finally(() => { if (!controller.signal.aborted && currentEpoch === epoch.current) setListBusy(false); });
    const timer = setTimeout(() => {
      if (currentEpoch === epoch.current) { changeSession(null); setError('Your session expired. Sign in again; your draft is still here.'); }
    }, Math.max(0, session.expiresAt - Date.now()));
    return () => { controller.abort(); clearTimeout(timer); };
  }, [session?.token, listRevision]);

  const catalog = useMemo(() => new Map(cards.map(card => [card.id, card])), [cards]);
  const filtered = useMemo(() => filterCatalog(cards, filter), [cards, filter]);
  const validation = validateDeck(draft, catalog);
  const dirty = !saved || JSON.stringify(draft) !== JSON.stringify(editableDeck(saved));
  const configuredGameBase = typeof window === 'undefined' ? 'http://localhost/' :
    import.meta.env.VITE_GAME_URL || (import.meta.env.DEV ? builderConfig.developmentGameUrl : new URL(builderConfig.gamePath, window.location.origin).href);
  let gameBase = '', playUrl = '', destinationError = '';
  try { gameBase = gameDestination(configuredGameBase); if (saved && !dirty) playUrl = gameDeckUrl(gameBase, saved.id); } catch { destinationError = 'The game destination is misconfigured. Contact the operator.'; }
  const locked = busy;
  const edit = (value: DeckInput) => { setDraft(value); setNotice(''); setError(''); };
  async function authenticate() {
    const currentEpoch = epoch.current; setBusy(true); setError('');
    try {
      const value = await api.authenticate(mode, username, password);
      if (currentEpoch === epoch.current) { changeSession(value); setNotice('Signed in. Your draft is ready to save.'); }
    } catch (reason) { if (currentEpoch === epoch.current) setError(message(reason)); }
    finally { setPassword(''); if (currentEpoch === epoch.current) setBusy(false); }
  }
  async function logout() {
    if (!session) return;
    const token = session.token; changeSession(null); const currentEpoch = epoch.current;
    setError(''); setNotice('Signed out. Your draft remains in this tab.');
    try { await api.logout(token); } catch { if (epoch.current === currentEpoch) setError('Local sign-out completed, but server sign-out failed. The previous session may remain valid until expiry.'); }
  }
  async function save(asNew = false) {
    if (!session || !catalogReady || !validation.valid || busy || listBusy) return;
    const currentEpoch = epoch.current; setBusy(true); setError(''); setNotice('');
    try {
      const value = await api.save(session.token, validation.deck, asNew ? undefined : saved?.id);
      if (currentEpoch !== epoch.current) return;
      setDraft(editableDeck(value)); setSaved(value);
      setDecks(previous => [...previous.filter(deck => deck.id !== value.id), value]);
      setNotice('Deck saved. Play it in the game, or keep editing.');
    } catch (reason) {
      if (currentEpoch !== epoch.current) return;
      if (reason instanceof BuilderApiError && (reason.status === 401 || reason.status === 403)) changeSession(null);
      if (reason instanceof BuilderApiError && reason.status === 404) setSaved(null);
      setError(message(reason));
    } finally { if (currentEpoch === epoch.current) setBusy(false); }
  }
  function replaceDraft(value: DeckInput, record: SavedDeck | null) {
    if (deckCount(draft) > 0 && dirty && typeof window !== 'undefined' && !window.confirm('Replace the current draft? Unsaved changes will be lost.')) return;
    setSaved(record); edit(value);
  }

  return <main>
    <header><div><p className="eyebrow">CARD GAME / DECK WORKSHOP</p><h1>Build your next game.</h1><p>Explore the cards, shape a deck, then take it to the table.</p></div>{gameBase && <a href={gameBase}>Open game</a>}</header>
    <section className="account" aria-label="Account">
      {session ? <><strong>{session.account?.username}</strong><span>Account saves are private to you.</span><button onClick={() => void logout()} disabled={busy}>Sign out</button></> :
        <form onSubmit={event => { event.preventDefault(); void authenticate(); }}>
          <label>Account action <select value={mode} disabled={busy} onChange={event => setMode(event.target.value as 'login' | 'register')}><option value="login">Sign in</option><option value="register">Create account</option></select></label>
          <label>Username <input autoComplete="username" required minLength={3} maxLength={32} value={username} disabled={busy} onChange={event => setUsername(event.target.value)} /></label>
          <label>Password <input type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required minLength={mode === 'register' ? PASSWORD_LIMITS.min : 1} maxLength={128} value={password} disabled={busy} onChange={event => setPassword(event.target.value)} /></label>
          <button disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
          <small>Browse and draft freely. Sign in to save. Signing in ends other game sessions for this account. New passwords need at least {PASSWORD_LIMITS.min} characters.</small>
        </form>}
    </section>
    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status" className="notice">{notice}</p>}
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
        {catalogError ? <p role="alert">{catalogError} <button onClick={() => setCatalogRevision(value => value + 1)}>Retry catalog</button></p> : !catalogReady ? <p role="status">Loading catalog…</p> : !filtered.length ? <p>No cards match these filters.</p> : null}
        <div className="catalog-grid">{filtered.map(card => <article key={card.id}>
          <CardSurface card={card} />
          <p className="card-id">{card.id}</p><p>{card.rulesText || 'No rules text.'}</p>
          <small>{card.deckLegal ? card.copyLimit === null ? 'Unlimited copies' : `Up to ${card.copyLimit} copies` : 'Not legal in saved decks'}</small>
          <button disabled={locked || !catalogReady || !card.deckLegal || deckCount(draft) >= DECK_RULES.maxCards || (draft.cards.find(entry => entry.cardId === card.id)?.quantity ?? 0) >= (card.copyLimit ?? DECK_RULES.maxCards)} onClick={() => edit(changeCopies(draft, card.id, 1))} aria-label={'Add ' + card.name}>+ Add</button>
        </article>)}</div>
      </section>
      <aside aria-label="Deck editor">
        <h2>Your deck</h2>
        <label>Deck name <input maxLength={80} value={draft.name} disabled={locked} onChange={event => edit({ ...draft, name: event.target.value })} placeholder="Give this deck a name" /></label>
        <div className="toolbar"><button disabled={locked} onClick={() => replaceDraft(newDraft(), null)}>New deck</button>
          <button disabled={!session || locked || listBusy || !catalogReady || !validation.valid} onClick={() => void save()}>{busy ? 'Working…' : saved ? 'Update saved deck' : 'Save deck'}</button>
          {saved && <button disabled={!session || locked || listBusy || !catalogReady || !validation.valid} onClick={() => void save(true)}>Save as new</button>}
        </div>
        {catalogReady ? <DeckPreview draft={draft} cards={cards} /> : <p>Validation needs the catalog.</p>}
        {!session && <p>Sign in above to save your deck.</p>}
        <ul className="deck-list">{draft.cards.map(entry => <li key={entry.cardId}>
          <div><strong>{catalog.get(entry.cardId)?.name ?? entry.cardId}</strong><small>{entry.cardId}</small></div>
          <button aria-label={'Remove one ' + entry.cardId} disabled={locked} onClick={() => edit(changeCopies(draft, entry.cardId, -1))}>−</button><span>{entry.quantity}</span>
          <button aria-label={'Add one ' + entry.cardId} disabled={locked || !catalogReady || !catalog.get(entry.cardId)?.deckLegal || deckCount(draft) >= DECK_RULES.maxCards || entry.quantity >= (catalog.get(entry.cardId)?.copyLimit ?? DECK_RULES.maxCards)} onClick={() => edit(changeCopies(draft, entry.cardId, 1))}>+</button>
          <button aria-label={'Remove all ' + entry.cardId} disabled={locked} onClick={() => edit(changeCopies(draft, entry.cardId, -entry.quantity))}>×</button>
        </li>)}</ul>
        {saved && <p>{dirty ? 'Unsaved changes. Save before playing this version.' : 'This version is saved.'}</p>}
        {playUrl && session && catalogReady && validation.valid && <><a className="primary-link" href={playUrl} target="_blank" rel="noopener noreferrer">Play this deck →</a><p className="hint">Opens a new game tab. Sign in there with the same account; the deck will be selected after ownership is checked. Game sign-in ends this builder session; your draft stays here.</p></>}
        {destinationError && <p role="alert">{destinationError}</p>}
        <section aria-label="Saved decks"><h3>Saved decks</h3>
          {session ? <><button disabled={locked || listBusy} onClick={() => setListRevision(value => value + 1)}>Refresh saved decks</button>
            {listBusy ? <p role="status">Loading your decks…</p> : !decks.length ? <p>No saved decks yet.</p> : <ul className="saved-decks">{decks.map(deck => <li key={deck.id}><button disabled={locked || listBusy} onClick={() => replaceDraft(editableDeck(deck), deck)}>{deck.name}</button></li>)}</ul>}</> : <p>Sign in to load your saved decks.</p>}
        </section>
        <section aria-label="Import and export"><h3>Text import / export</h3><p>One line per card: <code>4 empire-servant</code>. Use the card IDs shown in the catalog.</p>
          <label>Deck text <textarea rows={7} value={text} disabled={locked} maxLength={builderConfig.maxImportBytes} onChange={event => setText(event.target.value)} /></label>
          <div className="toolbar"><button disabled={locked || !text.trim()} onClick={() => { try { replaceDraft(importDeck(text), null); } catch (reason) { setError(message(reason)); } }}>Import text</button><button onClick={() => setText(exportDeck(draft))}>Export to text</button></div>
        </section>
      </aside>
    </div>
  </main>;
}
