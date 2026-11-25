import { describe, expect, it } from 'vitest';
import { CatalogResponseSchema, deckEligibility, newScenario, validateDeck, type DeckInput } from '@card-game/protocol';
import { buildCatalog } from '@server/catalog/catalog';
import { DeckService, InvalidDeckError } from '@server/decks/deck-service';
import { InMemoryDeckStore } from '@server/decks/deck-store';
import { getBlueprint } from '@library/card-catalog';
import { buildScenarioRoom, scenarioRandom } from '@server/scenarios/scenario-setup';
import { randomUUID } from 'node:crypto';

const catalog = buildCatalog();
const valid: DeckInput = { name: 'Constructed', format: 'standard', cards: [{ cardId: 'land-red', quantity: 56 }, { cardId: 'empire-servant', quantity: 4 }] };
describe('shared deck rules and catalog boundary', () => {
  it('constructs a lab scenario using the new canonical cards', () => {
    const ids = ['frost-giant', 'frost-soul', 'heavenly-gate', 'heavenly-gatekeeper', 'heavenly-lance', 'heavenly-marquis-laila', 'heavenly-patrol', 'shadowwood-sword', 'thunder-devouring-holy-sword', 'vitality-wood-staff',
      'phantom-sapper', 'worlds-wind-envoy', 'heavenly-land-envoy-reila', 'heavenly-seeker-yela', 'wind-spirit-prophet'];
    const scenario = newScenario(); scenario.openingHandSize = 0;
    scenario.players[0].battlefield = ids.map(cardId => ({ cardId, quantity: 1 }));
    const room = buildScenarioRoom('workbook-data-only', ['player1', 'player2'], scenario, { uuid: randomUUID, random: scenarioRandom(1) });
    expect(room.battlefield.map(card => card.blueprint.id)).toEqual(ids);
    expect(room.battlefield.every(card => card.state.ownerId === 'player1' && card.state.controllerId === 'player1')).toBe(true);
  });
  it.each([
    'heavenly-lance', 'thunder-devouring-holy-sword', 'heavenly-gatekeeper', 'heavenly-patrol', 'frost-soul',
    'heavenly-marquis-laila', 'shadowwood-sword', 'vitality-wood-staff', 'frost-giant', 'heavenly-gate',
    'phantom-sapper', 'worlds-wind-envoy', 'heavenly-land-envoy-reila', 'heavenly-seeker-yela', 'wind-spirit-prophet',
  ])('publishes new workbook card %s for deck and scenario consumers', cardId => {
    expect(catalog.get(cardId)).toMatchObject({ id: cardId, deckLegal: true, copyLimit: 4 });
    expect(validateDeck({ ...valid, cards: [{ cardId: 'land-red', quantity: 59 }, { cardId, quantity: 1 }] }, catalog).valid).toBe(true);
  });
  it('permits an explicit repeatable land while enforcing minimum/maximum and four copies', () => {
    expect(validateDeck(valid, catalog).valid).toBe(true);
    for (const quantity of [1, 59, 251]) expect(validateDeck({ ...valid, cards: [{ cardId: 'land-red', quantity }] }, catalog).valid).toBe(false);
    const result = validateDeck({ ...valid, cards: [{ cardId: 'land-red', quantity: 55 }, { cardId: 'empire-servant', quantity: 5 }] }, catalog);
    expect(result).toEqual({ valid: false, issues: [{ code: 'copy_limit', cardId: 'empire-servant', message: 'Use at most 4 copies of this card.' }] });
  });
  it.each(['rock', 'paper', 'scissors', 'trigger-probe', 'choice-practice', 'counterspell-fixture', 'ability-counter-fixture', 'unknown', 'toString'])('rejects illegal/unknown card %s', cardId => {
    expect(validateDeck({ ...valid, cards: [{ cardId: 'land-red', quantity: 59 }, { cardId, quantity: 1 }] }, catalog).valid).toBe(false);
  });
  it('rejects duplicate entries, role/owner injection, fractions and oversized lists', () => {
    for (const input of [
      { ...valid, cards: [{ cardId: 'land-red', quantity: 30 }, { cardId: 'land-red', quantity: 30 }] },
      { ...valid, ownerId: 'other' }, { ...valid, cards: [{ cardId: 'land-red', quantity: 60.5 }] },
      { ...valid, cards: Array(251).fill({ cardId: 'land-red', quantity: 1 }) },
    ]) expect(validateDeck(input, catalog).valid).toBe(false);
  });
  it('publishes safe printed fields without blueprints, effects, abilities or match state', () => {
    const cards = [...catalog.values()];
    expect(CatalogResponseSchema.safeParse({ protocolVersion: 1, cards, offset: 0, limit: 100, total: cards.length }).success).toBe(true);
    const encoded = JSON.stringify(cards);
    for (const field of ['"abilities"', '"onCastEffects"', '"castRequirements"', '"uuid"', '"state"']) expect(encoded).not.toContain(field);
    expect(catalog.get('land-red')?.copyLimit).toBeNull(); expect(catalog.get('sea-domain')?.copyLimit).toBeNull();
    expect(() => getBlueprint('toString')).toThrow('Unknown');
  });
  it('bounds saved-deck creation and returns shared validation issues without mutation', () => {
    const repository = new InMemoryDeckStore(), service = new DeckService(repository, catalog, () => 1);
    for (let i = 0; i < 100; i++) service.create('owner', valid);
    expect(() => service.create('owner', valid)).toThrow('capacity');
    expect(service.list('other', 0, 100).total).toBe(0);
    const previous = service.list('owner', 0, 1).decks[0];
    expect(() => service.update('other', previous.id, valid)).toThrow('not found');
    expect(() => service.update('owner', previous.id, { ...valid, cards: [] })).toThrow(InvalidDeckError);
    expect(service.get('owner', previous.id)).toEqual(previous);
  });
});


describe('owned config-driven copy limits shared with the builder', () => {
  it.each([['phantom-puppet', 20], ['phantom-castle', 1], ['worlds-sea', 1]])('enforces the configured limit for %s', (cardId, limit) => {
    expect(catalog.get(cardId)?.copyLimit).toBe(limit);
    const deck = (n: number) => ({ name: 'Policy', format: 'standard', cards: [{ cardId: 'land-red', quantity: 60 - n }, { cardId, quantity: n }] });
    expect(validateDeck(deck(limit), catalog).valid).toBe(true);
    expect(validateDeck(deck(limit + 1), catalog).valid).toBe(false);
  });
  it('honors every printed unlimited-copy exemption in the owned eligibility config', () => {
    const repeatable = [...catalog.values()].filter(card => card.rulesText?.includes('此卡不受牌組構築上限限制'));
    expect(repeatable.length).toBeGreaterThan(6);
    for (const card of repeatable) {
      expect(card.copyLimit, card.id).toBeNull();
      expect(validateDeck({ name: 'Land', format: 'standard', cards: [{ cardId: card.id, quantity: 60 }] }, catalog).valid, card.id).toBe(true);
    }
  });
  it('honors the battlefield exemption in public catalog validation and saved create/update', () => {
    const cardId = 'ancient-weapon-battlefield';
    expect(catalog.get(cardId)?.copyLimit).toBeNull();
    const service = new DeckService(new InMemoryDeckStore(), catalog, () => 1);
    const deck = { name: 'Battlefield', format: 'standard', cards: [{ cardId, quantity: 60 }] };
    expect(validateDeck(deck, catalog).valid).toBe(true);
    const saved = service.create('owner', deck);
    expect(service.update('owner', saved.id, { ...deck, cards: [{ cardId, quantity: 250 }] }).id).toBe(saved.id);
    expect(() => service.update('owner', saved.id, { ...deck, cards: [{ cardId, quantity: 251 }] })).toThrow(InvalidDeckError);
  });
});


describe('deck policy parser and custom config', () => {
  it('uses one compiled policy for preview validation and server saves', () => {
    const custom = buildCatalog({ ...deckEligibility, copyLimits: { ...deckEligibility.copyLimits, 'empire-servant': 20 } });
    const deck = { ...valid, cards: [{ cardId: 'land-red', quantity: 40 }, { cardId: 'empire-servant', quantity: 20 }] };
    expect(validateDeck(deck, custom).valid).toBe(true);
    const service = new DeckService(new InMemoryDeckStore(), custom, () => 1);
    expect(service.create('owner', deck).cards).toEqual(deck.cards);
    expect(() => service.create('owner', { ...deck, cards: [{ cardId: 'land-red', quantity: 39 }, { cardId: 'empire-servant', quantity: 21 }] })).toThrow(InvalidDeckError);
  });
  it('rejects unknown, overlapping, duplicate and invalid configured exceptions', () => {
    for (const policy of [
      { ...deckEligibility, copyLimits: { 'not-a-card': 20 } },
      { ...deckEligibility, copyLimits: { 'land-red': 20 } },
      { ...deckEligibility, copyLimits: { 'empire-servant': 0 } },
      { ...deckEligibility, unlimitedCopies: ['land-red', 'land-red'] },
    ]) expect(() => buildCatalog(policy as any)).toThrow();
  });
});
