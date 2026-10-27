import { DeckListResponseSchema, type SavedDeck } from '@card-game/protocol';
import { clientUi } from './config';

export async function loadSavedDecks(token: string, signal?: AbortSignal): Promise<SavedDeck[]> {
  const decks: SavedDeck[] = [], limit = clientUi.savedDeckPageSize;
  for (let offset = 0; offset < 1000; offset += limit) {
    if (signal?.aborted) throw new DOMException('Deck loading cancelled.', 'AbortError');
    const response = await fetch(`/api/decks?offset=${offset}&limit=${limit}`, { headers: { Authorization: 'Bearer ' + token }, signal });
    if (!response.ok) throw new Error('Unable to load saved decks. Sign in again or retry.');
    const parsed = DeckListResponseSchema.safeParse(await response.json());
    if (!parsed.success || parsed.data.total > 1000 || parsed.data.offset !== offset || parsed.data.limit !== limit || parsed.data.decks.length > limit) throw new Error('The server returned an incompatible deck list.');
    decks.push(...parsed.data.decks);
    if (!parsed.data.decks.length || offset + limit >= parsed.data.total) return decks;
  }
  return decks;
}
