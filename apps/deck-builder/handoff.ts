import { DeckIdSchema } from '@card-game/protocol';

/** The configured destination is trusted build configuration, never a query parameter. */
export function gameDeckUrl(gameUrl: string, id: string): string {
  DeckIdSchema.parse(id);
  const url = new URL(gameDestination(gameUrl));
  url.searchParams.set('deckId', id);
  return url.href;
}
export function gameDestination(gameUrl: string): string {
  const url = new URL(gameUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid game destination.');
  url.search = ''; url.hash = '';
  return url.href;
}
