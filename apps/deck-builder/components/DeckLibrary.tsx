import { useMemo, useRef, useState } from 'react';
import { deckCoverArt } from '@card-game/ui';
import { validateDeck, type CatalogCard, type SavedDeck } from '@card-game/protocol';
import { deckCount, editableDeck } from '../model';

const colors = [
  ['white', 'W', 'Cold'], ['blue', 'U', 'Blue'], ['black', 'B', 'Black'],
  ['red', 'R', 'Red'], ['green', 'G', 'Green'], ['yellow', 'Y', 'Yellow'],
] as const;

function describeDeck(deck: SavedDeck, catalog: ReadonlyMap<string, CatalogCard>) {
  const ranked = [...deck.cards].sort((a, b) => b.quantity - a.quantity || a.cardId.localeCompare(b.cardId));
  const spells = ranked.filter(entry => catalog.has(entry.cardId) && !catalog.get(entry.cardId)?.cardTypes.includes('Land'));
  const symbols = new Set((spells.length ? spells : ranked).flatMap(entry => catalog.get(entry.cardId)?.colors ?? []));
  return {
    deck, ranked, count: deckCount(deck),
    art: deckCoverArt(deck.cards, catalog),
    colors: colors.filter(([color, rune]) => symbols.has(color) || symbols.has(rune)),
  };
}

type DeckSummary = ReturnType<typeof describeDeck>;

function DeckColors({ deck }: { deck: DeckSummary }) {
  return <span className="library-colors">
    {deck.colors.map(([color, rune, label]) => <span className="library-color" data-color={color} key={color} aria-label={label}>{rune}</span>)}
  </span>;
}

interface DeckLibraryProps {
  decks: readonly SavedDeck[];
  catalog: ReadonlyMap<string, CatalogCard>;
  catalogReady: boolean;
  signedIn: boolean;
  loading: boolean;
  loadError: string;
  busy: boolean;
  canManage: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onSignIn: () => void;
  onRefresh: () => void;
  onEdit: (deck: SavedDeck) => void;
  onDuplicate: (deck: SavedDeck) => void;
  onExport: (deck: SavedDeck) => void;
  onDelete: (deck: SavedDeck) => void;
  playUrl: (id: string) => string;
}

export default function DeckLibrary({ decks, catalog, catalogReady, signedIn, loading, loadError, busy, canManage,
  selectedId, onSelect, onSignIn, onRefresh, onEdit, onDuplicate, onExport, onDelete, playUrl }: DeckLibraryProps) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('recent');
  const [color, setColor] = useState('');
  const more = useRef<HTMLDetailsElement>(null);
  const closeActions = () => {
    if (!more.current) return;
    more.current.open = false;
    more.current.querySelector('summary')?.focus();
  };
  const summaries = useMemo(() => decks.map(deck => describeDeck(deck, catalog)), [catalog, decks]);
  const search = query.trim().toLocaleLowerCase();
  const visible = summaries.filter(item => item.deck.name.toLocaleLowerCase().includes(search) &&
    (!catalogReady || !color || item.colors.some(([value]) => value === color)));
  visible.sort((a, b) => (sort === 'name' ? a.deck.name.localeCompare(b.deck.name) : b.deck.updatedAt - a.deck.updatedAt) ||
    a.deck.id.localeCompare(b.deck.id));
  const selected = visible.find(item => item.deck.id === selectedId) ?? visible[0];

  if (!summaries.length) {
    return <div className="library-empty">
      {loading ? <p role="status">Loading your decks…</p>
        : loadError ? <><h2>Couldn’t load your decks</h2><p role="alert">{loadError}</p><button onClick={onRefresh}>Retry</button></>
        : signedIn ? <><h2>No saved decks yet</h2><p>Create or import a deck, then save it to your library.</p></>
        : <><h2>Sign in to see your decks</h2><p>You can build or import a draft before signing in.</p><button onClick={onSignIn}>Sign in / Create account</button></>}
    </div>;
  }

  const selectedRules = selected && catalogReady ? validateDeck(editableDeck(selected.deck), catalog) : null;
  const needsReview = selectedRules?.valid === false;
  const href = selected && !needsReview ? playUrl(selected.deck.id) : '';

  return <div className="library-layout">
      <div className="library-filters" aria-label="Filter saved decks">
        <label>Search decks <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search by deck name" /></label>
        <label>Sort by <select value={sort} onChange={event => setSort(event.target.value)}>
          <option value="recent">Last modified</option><option value="name">Name A–Z</option>
        </select></label>
        <label>Color <select value={color} onChange={event => setColor(event.target.value)} disabled={!catalogReady}>
          <option value="">All colors</option>
          {colors.map(([value, rune, label]) => <option key={value} value={value}>{label} · {rune}</option>)}
        </select></label>
      </div>
    <section aria-label="Saved decks" className="library-results">
      {loadError && <p role="alert">{loadError} <button onClick={onRefresh} disabled={loading || busy}>Retry</button></p>}
      <p className="library-count" role="status">{visible.length === summaries.length
        ? `${visible.length} saved ${visible.length === 1 ? 'deck' : 'decks'}`
        : `${visible.length} of ${summaries.length} decks`}</p>
      {visible.length ? <ul className="library-grid">
        {visible.map(item => <li key={item.deck.id}>
          <button type="button" className="library-tile" aria-pressed={item === selected} onClick={() => onSelect(item.deck.id)}>
            <span className="library-cover">{item.art ? <img src={item.art} alt="" decoding="async" loading="lazy" /> : <span className="library-cover-mark" aria-hidden="true" />}</span>
            <span className="library-tile-body">
              <strong>{item.deck.name}</strong>
              <span className="library-tile-meta"><span>{item.count} cards</span><DeckColors deck={item} /></span>
            </span>
          </button>
        </li>)}
      </ul> : <p>No decks match your search and color filter.</p>}
    </section>
    {selected && <aside className="library-selection" aria-label="Selected deck">
      <div className="library-selection-heading">
        <p className="eyebrow">{selected.deck.format}</p>
        <h2>{selected.deck.name}</h2>
        <div className="library-tile-meta"><span>{selected.count} cards · <time dateTime={new Date(selected.deck.updatedAt).toISOString()}>
          {new Date(selected.deck.updatedAt).toLocaleDateString()}
        </time></span><DeckColors deck={selected} /></div>
      </div>
      {needsReview && <p className="library-review">Needs review. Open the editor to resolve deck rules.</p>}
      <div className="library-selection-actions">
        {href && <a className="primary-link" href={href}>Play deck</a>}
        <button onClick={() => onEdit(selected.deck)} disabled={busy}>Edit deck</button>
        <details key={selected.deck.id} ref={more} className="library-more" onKeyDown={event => {
          if (event.key === 'Escape' && event.currentTarget.open) closeActions();
        }}>
          <summary aria-label="More deck actions">More</summary>
          <div>
            <button disabled={!canManage} onClick={() => { closeActions(); onDuplicate(selected.deck); }}>Duplicate</button>
            <button disabled={busy} onClick={() => { closeActions(); onExport(selected.deck); }}>Export</button>
            <button className="library-delete" disabled={!canManage} onClick={() => { closeActions(); onDelete(selected.deck); }}>Delete</button>
          </div>
        </details>
      </div>
      <div className="library-contents">
        <h3>Deck list</h3>
        <ul>{selected.ranked.map(entry => <li key={entry.cardId}>
          <span>{catalog.get(entry.cardId)?.name ?? entry.cardId}</span><span>×{entry.quantity}</span>
        </li>)}</ul>
      </div>
    </aside>}
  </div>;
}
