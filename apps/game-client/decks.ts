import { DeckListResponseSchema, type SavedDeck } from '@card-game/protocol';

export async function loadSavedDecks(token: string, signal?: AbortSignal): Promise<SavedDeck[]> {
  const response = await fetch('/api/decks?offset=0&limit=100', { headers: { Authorization: 'Bearer ' + token }, signal });
  if (!response.ok) throw new Error('Unable to load saved decks. Sign in again or retry.');
  const parsed = DeckListResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error('The server returned an incompatible deck list.');
  return parsed.data.decks;
}
