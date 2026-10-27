import { randomUUID } from 'node:crypto';
import { DECK_RULES, validateDeck, type DeckCatalogEntry, type DeckInput, type DeckIssue, type SavedDeck } from '@card-game/protocol';
import { AuthError } from '../auth/errors';
import type { DeckRepository } from './deck-store';

export class InvalidDeckError extends AuthError {
  constructor(readonly issues: DeckIssue[]) { super(400, 'Deck is invalid.'); }
}
export class DeckService {
  constructor(private readonly repository: DeckRepository, private readonly catalog: ReadonlyMap<string, DeckCatalogEntry>, private readonly now = Date.now) {}
  private validate(input: unknown): DeckInput {
    const result = validateDeck(input, this.catalog);
    if (!result.valid) throw new InvalidDeckError(result.issues);
    return result.deck;
  }
  list(ownerId: string, offset: number, limit: number) { return this.repository.listDecks(ownerId, offset, limit); }
  get(ownerId: string, id: string): SavedDeck {
    const deck = this.repository.findDeck(ownerId, id);
    if (!deck) throw new AuthError(404, 'Deck not found.');
    return deck;
  }
  create(ownerId: string, input: unknown): SavedDeck {
    const deck = this.validate(input);
    if (this.repository.listDecks(ownerId, 0, 1).total >= DECK_RULES.maxDecksPerAccount) throw new AuthError(409, 'Deck capacity reached.');
    const timestamp = this.now(), saved = { ...deck, id: randomUUID(), createdAt: timestamp, updatedAt: timestamp };
    if (!this.repository.createDeck(ownerId, saved)) throw new AuthError(409, 'Deck could not be created.');
    return saved;
  }
  update(ownerId: string, id: string, input: unknown): SavedDeck {
    this.get(ownerId, id);
    const deck = this.repository.updateDeck(ownerId, id, this.validate(input), this.now());
    if (!deck) throw new AuthError(404, 'Deck not found.');
    return deck;
  }
  delete(ownerId: string, id: string): void { if (!this.repository.deleteDeck(ownerId, id)) throw new AuthError(404, 'Deck not found.'); }
  /** Expand only after ownership and current catalog rules pass; never accept browser card lists. */
  matchCards(ownerId: string, id: string): string[] {
    return this.validate(this.input(this.get(ownerId, id))).cards.flatMap(entry => Array<string>(entry.quantity).fill(entry.cardId));
  }
  private input({ name, format, cards }: SavedDeck): DeckInput { return { name, format, cards }; }
}
