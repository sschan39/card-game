import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CatalogCard, SavedDeck } from '@card-game/protocol';
import { publicSession } from '@card-game/browser-session';
import { deckCoverArt } from '@card-game/ui';
import './lobby-deck-picker.css';

function DeckCover({ deck, catalog, eager = false }: {
  deck: SavedDeck;
  catalog?: ReadonlyMap<string, CatalogCard>;
  eager?: boolean;
}) {
  const art = deckCoverArt(deck.cards, catalog);
  return <span className="lobby-deck-art" aria-hidden="true">
    {art ? <img src={art} alt="" decoding="async" loading={eager ? 'eager' : 'lazy'} /> : <span />}
  </span>;
}

function cardCount(deck: SavedDeck) {
  return deck.cards.reduce((total, entry) => total + entry.quantity, 0);
}

export default function LobbyDeckPicker({ decks, selected, disabled, onSelect, onRefresh }: {
  decks: readonly SavedDeck[];
  selected: SavedDeck;
  disabled: boolean;
  onSelect: (id: string) => void;
  onRefresh: () => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [catalog, setCatalog] = useState<ReadonlyMap<string, CatalogCard>>();
  useEffect(() => {
    const controller = new AbortController();
    void publicSession.catalog(100, controller.signal).then(cards => {
      if (!controller.signal.aborted) setCatalog(new Map(cards.map(card => [card.id, card])));
    }).catch(() => { /* Covers can use the artwork already available for each deck. */ });
    return () => controller.abort();
  }, []);

  useLayoutEffect(() => {
    const modal = dialog.current;
    if (!open || !modal || modal.open) return;
    modal.showModal();
    modal.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus();
  }, [open]);
  const query = search.trim().toLocaleLowerCase();
  const filtered = open ? decks.filter(deck => deck.name.toLocaleLowerCase().includes(query)) : [];
  function closeDecks() {
    setOpen(false);
    setSearch('');
    trigger.current?.focus();
  }

  return <>
    <button ref={trigger} type="button" className="lobby-deck-trigger" onClick={() => setOpen(true)} disabled={disabled}
      aria-label={`Change deck, ${selected.name} selected`} aria-haspopup="dialog" aria-expanded={open} aria-controls={id}>
      <DeckCover deck={selected} catalog={catalog} eager />
      <span className="lobby-deck-title">
        <strong>{selected.name}</strong>
        <span>{cardCount(selected)} cards</span>
      </span>
      <span className="lobby-deck-change">Change <span className="lobby-deck-chevron" aria-hidden="true" /></span>
    </button>
    <dialog ref={dialog} id={id} className="lobby-deck-dialog" aria-labelledby={id + '-title'} onClose={closeDecks} onWheel={event => event.stopPropagation()}
      onClick={event => { if (event.target === event.currentTarget) event.currentTarget.close(); }}>
      <header className="lobby-deck-dialog-header">
        <h2 id={id + '-title'}>Choose a deck</h2>
        <button type="button" className="lobby-deck-icon" onClick={() => { dialog.current?.close(); onRefresh(); }}
          aria-label="Refresh decks" title="Refresh decks">↻</button>
        <button type="button" className="lobby-deck-icon" onClick={() => dialog.current?.close()}
          aria-label="Close deck picker" title="Close deck picker">×</button>
        {decks.length > 8 && <input className="lobby-deck-search" type="search" aria-label="Search decks"
          placeholder="Search decks" value={search} onChange={event => setSearch(event.target.value)} />}
      </header>
      {open && <div className="lobby-deck-scroll">
        {filtered.length > 0 ? <ul className="lobby-deck-grid">
          {filtered.map(deck => <li key={deck.id}>
            <button type="button" className="lobby-deck-tile" aria-pressed={deck.id === selected.id}
              onClick={() => { onSelect(deck.id); dialog.current?.close(); }}>
              <DeckCover deck={deck} catalog={catalog} />
              <span className="lobby-deck-title"><strong>{deck.name}</strong><span>{cardCount(deck)} cards</span></span>
              {deck.id === selected.id && <span className="lobby-deck-check" aria-hidden="true">✓</span>}
            </button>
          </li>)}
        </ul> : <p role="status" className="lobby-deck-empty">No matching decks.</p>}
      </div>}
    </dialog>
  </>;
}
