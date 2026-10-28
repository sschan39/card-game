import { DeckIdSchema, type SavedDeck } from '@card-game/protocol';

export type DeckHandoff = { kind: 'none' } | { kind: 'invalid' } | { kind: 'requested'; id: string };
export function readDeckHandoff(search: string): DeckHandoff {
  const values = new URLSearchParams(search).getAll('deckId');
  if (!values.length) return { kind: 'none' };
  const result = DeckIdSchema.safeParse(values[0]);
  return values.length === 1 && result.success ? { kind: 'requested', id: result.data } : { kind: 'invalid' };
}
/** A URL identifies a request, never proof of ownership. */
export function ownedHandoffDeck(handoff: DeckHandoff, decks: readonly SavedDeck[]): SavedDeck | undefined {
  return handoff.kind === 'requested' ? decks.find(deck => deck.id === handoff.id) : undefined;
}
export function consumeDeckHandoff(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href); url.searchParams.delete('deckId');
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
}
