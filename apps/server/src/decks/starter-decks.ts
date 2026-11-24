import { CardIdSchema, STARTER_DECK_COUNT, validateDeck, type DeckCatalogEntry, type DeckInput } from '@card-game/protocol';
import { ConfigurationError } from '../config';
import templates from './starter-decks.json';

export function loadStarterDecks(catalog: ReadonlyMap<string, DeckCatalogEntry>): DeckInput[] {
  if (templates.length !== STARTER_DECK_COUNT || new Set(templates.map(template => template.id)).size !== templates.length) {
    throw new ConfigurationError('Invalid starter deck template count or duplicate ID.');
  }
  return templates.map(template => {
    const id = CardIdSchema.parse(template.id);
    const result = validateDeck(template.deck, catalog);
    if (!result.valid) {
      const details = result.issues.map(issue => [issue.cardId, issue.message].filter(Boolean).join(' ')).join(' ');
      throw new ConfigurationError(`Invalid starter deck ${id}. ${details}`);
    }
    return result.deck;
  });
}
