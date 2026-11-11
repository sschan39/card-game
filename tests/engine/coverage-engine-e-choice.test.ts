import { describe, expect, it } from 'vitest';
import type { CardBlueprint, CardInstance, CardState, CardZone } from '@shared/card.types';
import type { GameRoom, PlayerId } from '@shared/game.room.types';
import type { StackEffect, TargetingDefinition } from '@shared/effect.types';
import type { CounterRemovalCost } from '@shared/counter-cost.types';
import type { ListedChoice, NumericChoice, PendingChoice } from '@shared/choice.types';
import { createTestRoom } from '../helpers/test-room-factory';
import { choiceCanComplete, targetOptions, validateChoiceAnswer } from '@engine/choices';
import { planAnnouncedDistributions } from '@engine/announced-distributions';
import {
  applyLibraryReorder,
  applyLibraryShuffle,
  planLibraryReorder,
  planLibraryShuffle,
} from '@engine/library-operations';
import {
  counterPaymentAnswer,
  counterPaymentOptions,
  planCounterCosts,
} from '@engine/counter-costs';

let uuid = 0;

const blueprintOf = (overrides: Partial<CardBlueprint> = {}): CardBlueprint => ({
  id: 'test-card',
  name: 'Test Card',
  cardTypes: ['Creature'],
  subTypes: [],
  superTypes: [],
  keywords: [],
  castRequirements: { allowedZones: ['battlefield'], speed: 'instant' },
  rulesText: '',
  power: 1,
  toughness: 1,
  abilities: [],
  ...overrides,
});

function makeCard(
  options: {
    zone?: CardZone;
    controllerId?: string;
    ownerId?: string;
    blueprint?: Partial<CardBlueprint>;
    state?: Partial<CardState>;
  } = {},
): CardInstance {
  const zone = options.zone ?? 'battlefield';
  const controllerId = options.controllerId ?? 'player1';
  uuid += 1;
  return {
    uuid: `card-${uuid}`,
    blueprint: blueprintOf(options.blueprint),
    state: {
      zone,
      ownerId: options.ownerId ?? controllerId,
      controllerId,
      isTapped: false,
      damageTaken: 0,
      counters: {},
      attackedThisTurn: false,
      summoningSickness: false,
      zoneRevision: 0,
      ...options.state,
    },
  };
}

const roomWith = (overrides: Partial<GameRoom> = {}): GameRoom => createTestRoom(overrides);

const listedChoice = (options: string[], overrides: Partial<ListedChoice> = {}): ListedChoice => ({
  id: 'choice',
  playerId: 'player1',
  kind: 'options',
  prompt: '',
  options: options.map((id) => ({ id, label: id, value: `value:${id}` })),
  min: 1,
  max: 1,
  continuation: { type: 'action', actionId: 'a', data: {}, field: 'payment' },
  ...overrides,
});

const numericChoice = (range: { min: number; max?: number }): NumericChoice => ({
  id: 'number',
  playerId: 'player1',
  kind: 'number',
  prompt: '',
  range,
  continuation: { type: 'action', actionId: 'a', data: {}, field: 'payment' },
});

describe('choice completeness', () => {
  it('accepts a sane numeric range', () => {
    expect(choiceCanComplete(numericChoice({ min: 0 }))).toBe(true);
    expect(choiceCanComplete(numericChoice({ min: 0, max: 4 }))).toBe(true);
    expect(choiceCanComplete(numericChoice({ min: 1.5 }))).toBe(false);
    expect(choiceCanComplete(numericChoice({ min: 2, max: 1 }))).toBe(false);
    expect(choiceCanComplete(numericChoice({ min: 0, max: 1.5 }))).toBe(false);
  });

  it('rejects blank or duplicated option ids', () => {
    expect(choiceCanComplete(listedChoice(['a', 'b']))).toBe(true);
    expect(choiceCanComplete(listedChoice(['a', 'a']))).toBe(false);
    const blank: ListedChoice = { ...listedChoice(['a']), options: [{ id: '  ', label: 'x', value: 1 }] };
    expect(choiceCanComplete(blank)).toBe(false);
    const nonString: ListedChoice = { ...listedChoice(['a']), options: [{ id: 4 as unknown as string, label: 'x', value: 1 }] };
    expect(choiceCanComplete(nonString)).toBe(false);
  });

  it('rejects unsatisfiable selection bounds', () => {
    expect(choiceCanComplete(listedChoice(['a'], { min: -1 }))).toBe(false);
    expect(choiceCanComplete(listedChoice(['a'], { min: 2, max: 1 }))).toBe(false);
    expect(choiceCanComplete(listedChoice(['a'], { min: 2, max: 3 }))).toBe(false);
    expect(choiceCanComplete(listedChoice(['a'], { min: 0.5, max: 1 }))).toBe(false);
    expect(choiceCanComplete(listedChoice(['a'], { max: 1.5 }))).toBe(false);
  });

  it('requires a distribution to spend its whole total', () => {
    const distribution = (overrides: Partial<ListedChoice>) =>
      listedChoice(['a', 'b'], { kind: 'distribution', min: 1, max: 2, total: 3, ...overrides });

    expect(choiceCanComplete(distribution({}))).toBe(true);
    expect(choiceCanComplete(distribution({ total: undefined }))).toBe(false);
    expect(choiceCanComplete(distribution({ total: -1 }))).toBe(false);
    expect(choiceCanComplete(distribution({ total: 1, minimumPerOption: 1 }))).toBe(false);
    expect(
      choiceCanComplete({
        kind: 'distribution',
        options: [{ id: 'a', label: 'a', value: 1, limit: 1 }],
        min: 1,
        max: 1,
        total: 2,
      }),
    ).toBe(false);
  });

  it('allows an empty distribution only when the total is zero', () => {
    expect(choiceCanComplete({ kind: 'distribution', options: [], min: 0, max: 0, total: 0 })).toBe(true);
    expect(choiceCanComplete({ kind: 'distribution', options: [], min: 0, max: 0, total: 1 })).toBe(false);
  });
});

describe('target option enumeration', () => {
  const anyDef: TargetingDefinition = { type: 'any', required: true };
  const permanentDef: TargetingDefinition = { type: 'permanent', required: true };
  const playerDef: TargetingDefinition = { type: 'player', required: true };
  const selfDef: TargetingDefinition = { type: 'self', required: false };

  it('lists players and permanents for an unrestricted target', () => {
    const card = makeCard();
    const room = roomWith({ battlefield: [card] });
    const source = makeCard();

    const options = targetOptions(room, 'player1', source, anyDef);
    expect(options.map((option) => option.id)).toEqual(['player:player1', 'player:player2', `permanent:${card.uuid}`]);
    expect(options.map((option) => option.label)).toEqual(['You', 'Opponent', 'Test Card']);

    const legacy = makeCard({ state: { zoneRevision: undefined } });
    const legacyOptions = targetOptions(roomWith({ battlefield: [legacy] }), 'player1', source, anyDef);
    expect(legacyOptions[legacyOptions.length - 1].value).toMatchObject({ zoneRevision: 0 });
  });

  it('lists only players for a player target', () => {
    const room = roomWith();
    const options = targetOptions(room, 'player1', makeCard(), playerDef);
    expect(options.map((option) => option.id)).toEqual(['player:player1', 'player:player2']);
  });

  it('falls back to the raw uuid when a stack object has no usable label', () => {
    const spellCard = makeCard({ zone: 'stack' });
    const blank = { uuid: undefined as unknown as string, type: 'spell' as const, controllerId: 'player1', source: spellCard, effects: [], countered: false };
    const room = roomWith({ stack: [blank] });
    const options = targetOptions(room, 'player1', makeCard(), { type: 'stack', required: true });
    expect(options).toHaveLength(1);
    expect(options[0].label).toBeUndefined();
  });

  it('lists stack objects for spell and stack targets', () => {
    const spellCard = makeCard({ zone: 'stack' });
    const spell = {
      uuid: 'spell-1',
      type: 'spell' as const,
      controllerId: 'player2',
      source: spellCard,
      effects: [],
      countered: false,
    };
    const room = roomWith({ stack: [spell] });
    const options = targetOptions(room, 'player1', makeCard(), { type: 'stack', required: true });
    expect(options).toHaveLength(1);
    expect(options[0].label).toBe('spell-1');

    expect(targetOptions(room, 'player1', makeCard(), { type: 'spell', required: true })).toHaveLength(1);
    expect(targetOptions(room, 'player1', makeCard(), { type: 'spell', required: true, controller: 'self' })).toHaveLength(0);
  });

  it('resolves a permanent label through live characteristics', () => {
    const card = makeCard({ blueprint: { name: 'Live Name' } });
    const room = roomWith({ battlefield: [card] });
    const options = targetOptions(room, 'player1', makeCard(), permanentDef);
    expect(options).toEqual([
      {
        id: `permanent:${card.uuid}`,
        label: 'Live Name',
        value: { targetType: 'permanent', cardUuid: card.uuid, zone: 'battlefield', zoneRevision: 0 },
      },
    ]);
  });

  it('honours structural and permission filters', () => {
    const card = makeCard();
    const hexproof = makeCard({ controllerId: 'player2', blueprint: { keywords: ['Hexproof'] } });
    const room = roomWith({ battlefield: [card, hexproof] });
    const source = makeCard();

    expect(targetOptions(room, 'player1', source, permanentDef).map((option) => option.id)).toEqual([
      `permanent:${card.uuid}`,
    ]);
    expect(
      targetOptions(room, 'player1', source, permanentDef, false).map((option) => option.id),
    ).toEqual([`permanent:${card.uuid}`, `permanent:${hexproof.uuid}`]);
    expect(targetOptions(room, 'player1', source, selfDef).length).toBeGreaterThan(0);
  });
});

describe('choice answer validation', () => {
  it('validates a numeric answer against its range', () => {
    const choice = numericChoice({ min: 1, max: 3 });
    expect(validateChoiceAnswer(choice, { number: 2 })).toEqual({ values: [], number: 2 });
    expect(validateChoiceAnswer(choice, { number: '2' })).toBeUndefined();
    expect(validateChoiceAnswer(choice, { number: 1.5 })).toBeUndefined();
    expect(validateChoiceAnswer(choice, { number: 0 })).toBeUndefined();
    expect(validateChoiceAnswer(choice, { number: 4 })).toBeUndefined();
    expect(validateChoiceAnswer(numericChoice({ min: 1 }), { number: 99 })).toEqual({ values: [], number: 99 });
  });

  it('validates a distribution allocation', () => {
    const choice = listedChoice(['a', 'b'], {
      kind: 'distribution',
      min: 0,
      max: 2,
      total: 3,
      minimumPerOption: 1,
      options: [
        { id: 'a', label: 'a', value: 'A', limit: 2 },
        { id: 'b', label: 'b', value: 'B', limit: 2 },
      ],
    });

    expect(validateChoiceAnswer(choice, { allocations: { a: 1, b: 2 } })).toEqual({
      allocations: { a: 1, b: 2 },
      values: ['A', 'B'],
    });
    expect(validateChoiceAnswer(choice, { allocations: { a: 2, b: 1 } })).toEqual({
      allocations: { a: 2, b: 1 },
      values: ['A', 'B'],
    });
    expect(validateChoiceAnswer(choice, {})).toBeUndefined();
    expect(validateChoiceAnswer(choice, { allocations: [] })).toBeUndefined();
    expect(validateChoiceAnswer(choice, { allocations: 'nope' })).toBeUndefined();
    expect(validateChoiceAnswer(choice, { allocations: { a: 0, b: 3 } })).toBeUndefined();
    expect(validateChoiceAnswer(choice, { allocations: { b: 3 } })).toBeUndefined();
    expect(validateChoiceAnswer(choice, { allocations: { a: 1, b: 1 } })).toBeUndefined();
    expect(validateChoiceAnswer(choice, { allocations: { a: 1, b: 2, c: 0 } })).toBeUndefined();
    expect(validateChoiceAnswer(choice, { allocations: { a: -1, b: 4 } })).toBeUndefined();
    expect(validateChoiceAnswer(choice, { allocations: { a: 1.5, b: 1.5 } })).toBeUndefined();
    expect(validateChoiceAnswer(choice, { allocations: { a: 3, b: 0 } })).toBeUndefined();
    expect(
      validateChoiceAnswer({ ...choice, minimumPerOption: undefined } as PendingChoice, { allocations: { a: 3, b: 1 } }),
    ).toBeUndefined();

    const unlimited = listedChoice(['a', 'b'], {
      kind: 'payment',
      min: 0,
      max: 2,
      total: 3,
      options: [
        { id: 'a', label: 'a', value: 'A' },
        { id: 'b', label: 'b', value: 'B' },
      ],
    });
    expect(validateChoiceAnswer(unlimited, { allocations: { a: 3 } })).toEqual({
      allocations: { a: 3 },
      values: ['A'],
    });
    expect(validateChoiceAnswer(unlimited, { allocations: { a: 2, b: 1 } })).toEqual({
      allocations: { a: 2, b: 1 },
      values: ['A', 'B'],
    });
  });

  it('validates a listed selection', () => {
    const choice = listedChoice(['a', 'b'], { min: 1, max: 2 });
    expect(validateChoiceAnswer(choice, { choices: ['a'] })).toEqual({ values: ['value:a'] });
    expect(validateChoiceAnswer(choice, { choices: ['a', 'b'] })).toEqual({ values: ['value:a', 'value:b'] });
    expect(validateChoiceAnswer(choice, { choices: [] })).toBeUndefined();
    expect(validateChoiceAnswer(choice, { choices: ['a', 'b', 'c'] })).toBeUndefined();
    expect(validateChoiceAnswer(choice, { choices: ['a', 'a'] })).toBeUndefined();
    expect(validateChoiceAnswer(choice, { choices: ['z'] })).toBeUndefined();
    expect(validateChoiceAnswer(choice, { choices: [4] })).toBeUndefined();
    expect(validateChoiceAnswer(choice, { choices: 'a' })).toBeUndefined();
  });
});

describe('announced distributions', () => {
  const target = (uuidValue: string) => ({ targetType: 'permanent' as const, cardUuid: uuidValue, zoneRevision: 0 });
  const divisibleEffect = (overrides: Partial<StackEffect> = {}): StackEffect => ({
    action: 'DEAL_DAMAGE',
    params: { amount: 3 },
    tags: [],
    targets: [target('a'), target('b')],
    targeting: { type: 'permanent', required: true },
    choice: { kind: 'distribution', total: 3 },
    ...overrides,
  });

  it('rejects a malformed distribution payload', () => {
    expect(planAnnouncedDistributions([], { distributions: 5 })).toEqual({ success: false, reason: 'Invalid distributions' });
    expect(planAnnouncedDistributions([], { distributions: [] })).toEqual({ success: false, reason: 'Invalid distributions' });
    expect(planAnnouncedDistributions([], { distributions: null })).toEqual({ success: false, reason: 'Invalid distributions' });
  });

  it('passes effects that cannot be divided through untouched', () => {
    const plain = divisibleEffect({ choice: undefined });
    const selfTargeted = divisibleEffect({ targeting: { type: 'self', required: false } });
    const allTargeted = divisibleEffect({ targeting: { type: 'permanent', required: true, all: true } });
    const result = planAnnouncedDistributions([plain, selfTargeted, allTargeted], {});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.effects).toEqual([plain, selfTargeted, allTargeted]);
    }
  });

  it('splits a divided effect into one single-target copy per target', () => {
    const effect = divisibleEffect();
    const result = planAnnouncedDistributions([effect], {
      distributions: { 'effect-0': { 'permanent:a': 1, 'permanent:b': 2 } },
    });
    expect(result).toEqual({
      success: true,
      effects: [
        { ...effect, choice: undefined, targets: [target('a')], params: { amount: 1 } },
        { ...effect, choice: undefined, targets: [target('b')], params: { amount: 2 } },
      ],
    });
  });

  it('keeps the sign of a negative base value and honours a custom field', () => {
    const effect = divisibleEffect({ params: { damage: -2 }, choice: { kind: 'distribution', total: 2, field: 'damage' } });
    const result = planAnnouncedDistributions([effect], {
      distributions: { 'effect-0': { 'permanent:a': 1, 'permanent:b': 1 } },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.effects.map((item) => item.params.damage)).toEqual([-1, -1]);
    }
  });

  it('rejects unknown, incomplete or over-budget divisions', () => {
    const effect = divisibleEffect();
    const reject = (distributions: Record<string, unknown>) =>
      planAnnouncedDistributions([effect], { distributions }).success;

    expect(reject({ 'effect-9': { 'permanent:a': 3 } })).toBe(false);
    expect(reject({ 'effect-0': { 'permanent:a': 1, 'permanent:b': 2, 'permanent:c': 0 } })).toBe(false);
    expect(reject({ 'effect-0': { 'permanent:a': 1 } })).toBe(false);
    expect(reject({ 'effect-0': { 'permanent:a': 3, 'permanent:b': 0 } })).toBe(false);
    expect(reject({ 'effect-0': { 'permanent:a': 1.5, 'permanent:b': 1.5 } })).toBe(false);
    expect(reject({ 'effect-0': { 'permanent:a': 2, 'permanent:b': 2 } })).toBe(false);
    expect(reject({ 'effect-0': [] })).toBe(false);
    expect(reject({ 'effect-0': 'a' })).toBe(false);
    expect(reject({ 'effect-0': null })).toBe(false);
  });
});

describe('library operations', () => {
  const deckRoom = (cards: CardInstance[], playerId = 'player1'): GameRoom => {
    const room = roomWith();
    room.players[playerId].deck = cards;
    return room;
  };
  const deckOf = (count: number, zone: CardZone = 'library') =>
    Array.from({ length: count }, () => makeCard({ zone, ownerId: 'player1' }));
  const reference = (card: CardInstance) => ({ cardUuid: card.uuid, zoneRevision: card.state.zoneRevision ?? 0 });

  it('reorders a selected block to the top or bottom, storing bottom-to-top', () => {
    const [a, b, c, d] = deckOf(4);
    const room = deckRoom([a, b, c, d]);

    const top = planLibraryReorder(room, 'player1', [reference(c), reference(d)], 'top');
    expect(top).toHaveLength(1);
    expect(top[0]).toMatchObject({ type: 'REORDER_LIBRARY', playerId: 'player1' });
    if (top[0].type === 'REORDER_LIBRARY') {
      expect(top[0].order.map((entry) => entry.cardUuid)).toEqual([a.uuid, b.uuid, d.uuid, c.uuid]);
    }

    const bottom = planLibraryReorder(room, 'player1', [reference(c), reference(d)], 'bottom');
    if (bottom[0].type === 'REORDER_LIBRARY') {
      expect(bottom[0].order.map((entry) => entry.cardUuid)).toEqual([d.uuid, c.uuid, a.uuid, b.uuid]);
    }
  });

  it('rejects unsupported placements, missing players and empty selections', () => {
    const cards = deckOf(2);
    const room = deckRoom(cards);
    expect(planLibraryReorder(room, 'player1', [reference(cards[0])], 'middle' as 'top')).toEqual([]);
    expect(planLibraryReorder(room, 'player9', [reference(cards[0])], 'top')).toEqual([]);
    expect(planLibraryReorder(room, 'player1', [], 'top')).toEqual([]);
    expect(planLibraryReorder(room, 'player1', undefined as unknown as ReturnType<typeof reference>[], 'top')).toEqual([]);
  });

  it('rejects stale, foreign or ambiguous references', () => {
    const cards = deckOf(3);
    const room = deckRoom(cards);
    expect(planLibraryReorder(room, 'player1', [{ cardUuid: 'missing', zoneRevision: 0 }], 'top')).toEqual([]);
    expect(planLibraryReorder(room, 'player1', [{ cardUuid: cards[0].uuid, zoneRevision: 5 }], 'top')).toEqual([]);
    expect(planLibraryReorder(room, 'player1', [{ cardUuid: cards[0].uuid, zoneRevision: -1 }], 'top')).toEqual([]);
    expect(planLibraryReorder(room, 'player1', [{ cardUuid: cards[0].uuid, zoneRevision: 1.5 }], 'top')).toEqual([]);
    expect(planLibraryReorder(room, 'player1', [reference(cards[0]), reference(cards[0])], 'top')).toEqual([]);
    expect(planLibraryReorder(room, 'player1', [null as unknown as { cardUuid: string; zoneRevision: number }], 'top')).toEqual([]);

    const foreign = [{ ...cards[0], state: { ...cards[0].state, ownerId: 'player2' } }, cards[1], cards[2]];
    expect(planLibraryReorder(deckRoom(foreign), 'player1', [reference(foreign[0])], 'top')).toEqual([]);

    const elsewhere = [{ ...cards[0], state: { ...cards[0].state, zone: 'hand' as const } }, cards[1], cards[2]];
    expect(planLibraryReorder(deckRoom(elsewhere), 'player1', [reference(elsewhere[0])], 'top')).toEqual([]);

    const duplicated = [cards[0], { ...cards[1], uuid: cards[0].uuid }, cards[2]];
    expect(planLibraryReorder(deckRoom(duplicated), 'player1', [reference(duplicated[2])], 'top')).toEqual([]);
  });

  it('treats a missing zone revision as zero', () => {
    const [a, b] = deckOf(2);
    const legacy = { ...a, state: { ...a.state, zoneRevision: undefined } };
    const room = deckRoom([legacy, b]);

    const plan = planLibraryReorder(room, 'player1', [{ cardUuid: legacy.uuid, zoneRevision: 0 }], 'top');
    expect(plan).toHaveLength(1);
    if (plan[0].type === 'REORDER_LIBRARY') {
      expect(plan[0].order).toEqual([
        { cardUuid: b.uuid, zoneRevision: 0 },
        { cardUuid: legacy.uuid, zoneRevision: 0 },
      ]);
    }

    const shuffle = planLibraryShuffle(room, 'player1', () => 0.5);    if (shuffle[0].type === 'SHUFFLE_LIBRARY') {
      expect(shuffle[0].order).toEqual([
        { cardUuid: legacy.uuid, zoneRevision: 0 },
        { cardUuid: b.uuid, zoneRevision: 0 },
      ]);
    }
  });

  it('applies an exact reorder permutation or reports it unchanged', () => {
    const [a, b, c] = deckOf(3);
    const room = deckRoom([a, b, c]);

    const unchanged = applyLibraryReorder(room, {
      type: 'REORDER_LIBRARY',
      playerId: 'player1',
      order: [reference(a), reference(b), reference(c)],
    });
    expect(unchanged.status).toBe('unchanged');
    expect(unchanged.state).toBe(room);

    const committed = applyLibraryReorder(room, {
      type: 'REORDER_LIBRARY',
      playerId: 'player1',
      order: [reference(c), reference(b), reference(a)],
    });
    expect(committed.status).toBe('committed');
    expect(committed.state.players.player1.deck).toEqual([c, b, a]);
    expect(committed.state).not.toBe(room);
  });

  it('rejects a reorder that does not name the exact permutation', () => {
    const [a, b] = deckOf(2);
    const room = deckRoom([a, b]);
    const result = applyLibraryReorder(room, {
      type: 'REORDER_LIBRARY',
      playerId: 'player1',
      order: [reference(a)],
    });
    expect(result).toEqual({
      status: 'rejected',
      state: room,
      reason: 'Reorder requires the exact current library permutation',
    });
  });

  it('plans a deterministic Fisher-Yates permutation', () => {
    const cards = deckOf(3);
    const room = deckRoom(cards);
    const mutation = planLibraryShuffle(room, 'player1', () => 0.99);
    expect(mutation).toHaveLength(1);
    expect(mutation[0]).toMatchObject({ type: 'SHUFFLE_LIBRARY', playerId: 'player1' });
    if (mutation[0].type === 'SHUFFLE_LIBRARY') {
      expect(mutation[0].order.map((entry) => entry.cardUuid)).toEqual([cards[0].uuid, cards[1].uuid, cards[2].uuid]);
    }

    const swapped = planLibraryShuffle(room, 'player1', () => 0);
    if (swapped[0].type === 'SHUFFLE_LIBRARY') {
      expect(swapped[0].order.map((entry) => entry.cardUuid)).toEqual([cards[1].uuid, cards[2].uuid, cards[0].uuid]);
    }

    expect(planLibraryShuffle(room, 'player9', () => 0)).toEqual([]);
    expect(planLibraryShuffle(deckRoom([]), 'player1', () => 0.5)).toHaveLength(1);
  });

  it('refuses a random source outside the unit interval', () => {
    const room = deckRoom(deckOf(3));
    expect(() => planLibraryShuffle(room, 'player1', () => Number.NaN)).toThrow('Random source must return a number in [0, 1)');
    expect(() => planLibraryShuffle(room, 'player1', () => -0.1)).toThrow('Random source must return a number in [0, 1)');
    expect(() => planLibraryShuffle(room, 'player1', () => 1)).toThrow('Random source must return a number in [0, 1)');
  });

  it('applies a shuffle permutation with one event', () => {
    const [a, b] = deckOf(2);
    const room = deckRoom([a, b]);
    const outcome = applyLibraryShuffle(room, {
      type: 'SHUFFLE_LIBRARY',
      playerId: 'player1',
      order: [reference(b), reference(a)],
    });
    expect(outcome.status).toBe('committed');
    if (outcome.status === 'committed') {
      expect(outcome.state.players.player1.deck).toEqual([b, a]);
      expect(outcome.events).toEqual([
        { eventId: 'LIBRARY_SHUFFLED', roomId: room.roomId, payload: { playerId: 'player1', controllerId: 'player1' } },
      ]);
    }
  });

  it('rejects a shuffle for a missing player or a stale permutation', () => {
    const [a, b] = deckOf(2);
    const room = deckRoom([a, b]);
    expect(
      applyLibraryShuffle(room, { type: 'SHUFFLE_LIBRARY', playerId: 'player9', order: [reference(a), reference(b)] }),
    ).toEqual({ status: 'rejected', state: room, reason: 'Shuffle player does not exist' });
    expect(
      applyLibraryShuffle(room, { type: 'SHUFFLE_LIBRARY', playerId: 'player1', order: [reference(a)] }),
    ).toEqual({ status: 'rejected', state: room, reason: 'Shuffle requires the exact current library permutation' });
  });
});
