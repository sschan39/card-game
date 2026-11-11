import { describe, expect, it } from 'vitest';
import type { CardView } from '@card-game/protocol';
import { groupPermanents, groupTokens, permanentCategory, tokenSignature } from '@client/layout/grouping';

const baseState = {
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
};

function bareToken(stateOverrides: Record<string, unknown> = {}, uuid = 'token'): CardView {
  return {
    uuid,
    definitionId: 'soldier-token',
    name: 'Soldier',
    label: 'Soldier',
    cardTypes: ['Creature'],
    subTypes: ['Soldier'],
    keywords: [],
    rulesText: '',
    manaCost: '',
    isToken: true,
    state: { ...baseState, summoningSickness: true, attackedThisTurn: true, ...stateOverrides },
    actions: [],
    targetGroups: {},
    canAttack: false,
    canBlock: false,
  } as unknown as CardView;
}

describe('token signature with sparse display state', () => {
  it('treats missing optional characteristics as their neutral defaults', () => {
    const signature = tokenSignature(bareToken());

    expect(signature.split('|')).toEqual([
      'soldier-token',
      'Soldier',
      '', // power is unknown
      '', // toughness is unknown
      'ready',
      '0', // unmarked damage defaults to zero
      'sick',
      'attacked',
      '', // not attached to a permanent
      '', // not attached to a player
      '{}', // no counters
    ]);
  });

  it('distinguishes the optional states from their defaults', () => {
    const plain = tokenSignature(bareToken({ summoningSickness: false, attackedThisTurn: false, damageTaken: undefined, counters: undefined }));
    const marked = tokenSignature(bareToken({ damageTaken: 2, counters: { '+1/+1': 1 } }));

    expect(plain).not.toBe(marked);
    expect(plain.split('|')).toContain('0');
    expect(marked.split('|')).toContain('2');
    expect(marked.split('|')).toContain('{"+1/+1":1}');
  });

  it('keeps sparse tokens with an identical signature in one stack', () => {
    const groups = groupTokens([bareToken({}, 't1'), bareToken({}, 't2')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].cards.map(card => card.uuid)).toEqual(['t1', 't2']);
  });
});

function typed(uuid: string, cardTypes: string[], isToken = false): CardView {
  return { ...bareToken({}, uuid), cardTypes, isToken } as CardView;
}

describe('permanent bands', () => {
  it('classifies each band and folds unknown types into other', () => {
    expect(permanentCategory(typed('creature', ['Creature']))).toBe('creature');
    expect(permanentCategory(typed('planeswalker', ['Planeswalker']))).toBe('planeswalker');
    expect(permanentCategory(typed('artifact', ['Artifact']))).toBe('artifact');
    expect(permanentCategory(typed('enchantment', ['Enchantment']))).toBe('enchantment');
    expect(permanentCategory(typed('land', ['Land']))).toBe('land');
    expect(permanentCategory(typed('instant', ['Instant']))).toBe('other');
    expect(permanentCategory(typed('both', ['Artifact', 'Creature']))).toBe('creature');
  });

  it('buckets permanents into canonical bands and keeps input order inside a band', () => {
    const bands = groupPermanents([
      typed('land-1', ['Land']),
      typed('creature-1', ['Creature']),
      typed('artifact-1', ['Artifact']),
      typed('creature-2', ['Creature']),
    ]);

    expect(bands.map(band => band.category)).toEqual(['creature', 'artifact', 'land']);
    expect(bands[0].cards.map(card => card.uuid)).toEqual(['creature-1', 'creature-2']);
    expect(bands.flatMap(band => band.cards)).toHaveLength(4);
    expect(groupPermanents([])).toEqual([]);
  });

  it('keeps non-tokens as singletons and splits tokens that differ in visible state', () => {
    expect(groupTokens([typed('a', ['Creature']), typed('b', ['Creature'])])).toHaveLength(2);

    const ready = bareToken({}, 'ready');
    const tapped = { ...bareToken({ isTapped: true }, 'tapped') } as CardView;
    expect(groupTokens([ready, tapped])).toHaveLength(2);
  });
});
