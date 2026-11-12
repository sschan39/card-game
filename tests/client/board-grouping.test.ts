import { describe, expect, it } from 'vitest';
import type { CardView } from '@card-game/protocol';
import {
  CATEGORY_ORDER,
  groupPermanents,
  groupTokens,
  permanentCategory,
  tokenSignature,
} from '@client/layout/grouping';

function card(overrides: Partial<CardView> & { uuid: string }): CardView {
  return {
    definitionId: 'def',
    name: 'Card',
    label: 'Card',
    cardTypes: [],
    subTypes: [],
    keywords: [],
    rulesText: '',
    manaCost: '',
    state: {
      zone: 'battlefield',
      ownerId: 'player1',
      controllerId: 'player1',
      zoneRevision: 1,
      isTapped: false,
      damageTaken: 0,
      summoningSickness: false,
      attackedThisTurn: false,
      counters: {},
      attachedTo: null,
      attachedToRevision: null,
      attachedToPlayerId: null,
      protectorId: null,
    },
    actions: [],
    targetGroups: {},
    canAttack: false,
    canBlock: false,
    ...overrides,
  } as CardView;
}

describe('battlefield grouping', () => {
  describe('permanentCategory', () => {
    it('classifies each permanent type', () => {
      expect(permanentCategory(card({ uuid: 'a', cardTypes: ['Creature'] }))).toBe('creature');
      expect(permanentCategory(card({ uuid: 'b', cardTypes: ['Planeswalker'] }))).toBe('planeswalker');
      expect(permanentCategory(card({ uuid: 'c', cardTypes: ['Artifact'] }))).toBe('artifact');
      expect(permanentCategory(card({ uuid: 'd', cardTypes: ['Enchantment'] }))).toBe('enchantment');
      expect(permanentCategory(card({ uuid: 'e', cardTypes: ['Land'] }))).toBe('land');
      expect(permanentCategory(card({ uuid: 'f', cardTypes: ['Instant'] }))).toBe('other');
    });

    it('prefers creature when a card has several types', () => {
      expect(permanentCategory(card({ uuid: 'a', cardTypes: ['Artifact', 'Creature'] }))).toBe('creature');
    });

    it('prefers planeswalker over artifact', () => {
      expect(permanentCategory(card({ uuid: 'a', cardTypes: ['Artifact', 'Planeswalker'] }))).toBe('planeswalker');
    });
  });

  describe('groupPermanents', () => {
    it('returns bands in the canonical order', () => {
      const bands = groupPermanents([
        card({ uuid: 'land', cardTypes: ['Land'] }),
        card({ uuid: 'creature', cardTypes: ['Creature'] }),
        card({ uuid: 'artifact', cardTypes: ['Artifact'] }),
      ]);
      expect(bands.map((band) => band.category)).toEqual(['creature', 'artifact', 'land']);
    });

    it('omits empty categories', () => {
      const bands = groupPermanents([card({ uuid: 'a', cardTypes: ['Creature'] })]);
      expect(bands).toHaveLength(1);
      expect(bands[0].category).toBe('creature');
    });

    it('keeps every card and preserves input order inside a band', () => {
      const cards = [
        card({ uuid: 'c1', cardTypes: ['Creature'] }),
        card({ uuid: 'l1', cardTypes: ['Land'] }),
        card({ uuid: 'c2', cardTypes: ['Creature'] }),
      ];
      const bands = groupPermanents(cards);
      expect(bands.find((band) => band.category === 'creature')!.cards.map((c) => c.uuid)).toEqual(['c1', 'c2']);
      expect(bands.flatMap((band) => band.cards)).toHaveLength(3);
    });

    it('returns nothing for an empty battlefield', () => {
      expect(groupPermanents([])).toEqual([]);
    });

    it('orders every category it can produce', () => {
      const produced = new Set(CATEGORY_ORDER);
      expect(produced.size).toBe(6);
    });
  });

  describe('groupTokens', () => {
    it('collapses identical tokens into one group', () => {
      const tokens = [
        card({ uuid: 't1', isToken: true, name: 'Soldier', power: 1, toughness: 1 }),
        card({ uuid: 't2', isToken: true, name: 'Soldier', power: 1, toughness: 1 }),
        card({ uuid: 't3', isToken: true, name: 'Soldier', power: 1, toughness: 1 }),
      ];
      const groups = groupTokens(tokens);
      expect(groups).toHaveLength(1);
      expect(groups[0].cards).toHaveLength(3);
    });

    it('never collapses non-token permanents', () => {
      const cards = [
        card({ uuid: 'a', name: 'Bear', power: 2, toughness: 2 }),
        card({ uuid: 'b', name: 'Bear', power: 2, toughness: 2 }),
      ];
      expect(groupTokens(cards)).toHaveLength(2);
    });

    it('separates tokens that differ in any visible way', () => {
      const base = { isToken: true, name: 'Soldier', power: 1, toughness: 1 } as const;
      const groups = groupTokens([
        card({ uuid: 't1', ...base }),
        card({ uuid: 't2', ...base, state: { ...card({ uuid: 'x' }).state, isTapped: true } }),
        card({ uuid: 't3', ...base, power: 2 }),
      ]);
      expect(groups).toHaveLength(3);
    });

    it('separates tokens with different counters', () => {
      const base = { isToken: true, name: 'Soldier', power: 1, toughness: 1 } as const;
      const groups = groupTokens([
        card({ uuid: 't1', ...base }),
        card({ uuid: 't2', ...base, state: { ...card({ uuid: 'x' }).state, counters: { '+1/+1': 1 } } }),
      ]);
      expect(groups).toHaveLength(2);
    });

    it('groups matching counter sets in any order and separates effects with a different expiry', () => {
      const first = card({ uuid: 't1', isToken: true });
      first.state.counters = { scorch: 1, '+1/+1': 2 };
      first.effects = [{ kind: 'restriction', action: 'block', duration: 'turn' }];
      const second = { ...first, uuid: 't2', state: { ...first.state, counters: { '+1/+1': 2, scorch: 1 } } };
      const third: CardView = { ...first, uuid: 't3', effects: [{ kind: 'restriction', action: 'block', duration: 'combat' }] };
      expect(groupTokens([first, second, third]).map(group => group.cards.length)).toEqual([2, 1]);
    });

    it('gives every card a stable signature', () => {
      const one = card({ uuid: 't1', isToken: true, name: 'Soldier', power: 1, toughness: 1 });
      const two = card({ uuid: 't2', isToken: true, name: 'Soldier', power: 1, toughness: 1 });
      expect(tokenSignature(one)).toBe(tokenSignature(two));
    });

    it('keeps a mixed battlefield in order', () => {
      const groups = groupTokens([
        card({ uuid: 'bear', name: 'Bear', power: 2, toughness: 2 }),
        card({ uuid: 't1', isToken: true, name: 'Soldier', power: 1, toughness: 1 }),
        card({ uuid: 't2', isToken: true, name: 'Soldier', power: 1, toughness: 1 }),
      ]);
      expect(groups.map((group) => group.cards.length)).toEqual([1, 2]);
    });
  });
});
