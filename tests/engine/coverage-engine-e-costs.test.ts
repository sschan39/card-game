import { describe, expect, it } from 'vitest';
import type { ActivatedAbility, CardBlueprint, CardInstance, CardState, CardZone } from '@shared/card.types';
import type { GameRoom } from '@shared/game.room.types';
import type { ActionCost } from '@shared/effect.types';
import type { CounterRemovalCost } from '@shared/counter-cost.types';
import { createTestRoom } from '../helpers/test-room-factory';
import { planActionCosts, planManaActivation } from '@engine/action-costs';
import {
  counterCostCards,
  counterPaymentAnswer,
  counterPaymentOptions,
  planCounterCosts,
} from '@engine/counter-costs';

let uuid = 0;

const blueprintOf = (overrides: Partial<CardBlueprint> = {}): CardBlueprint => ({
  id: 'test-card',
  name: 'Test Card',
  cardTypes: ['Artifact'],
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
    name?: string;
  } = {},
): CardInstance {
  const zone = options.zone ?? 'battlefield';
  const controllerId = options.controllerId ?? 'player1';
  uuid += 1;
  return {
    uuid: `card-${uuid}`,
    blueprint: blueprintOf({ name: options.name ?? 'Test Card', ...options.blueprint }),
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

const sourceCost = (amount: number): CounterRemovalCost => ({ from: 'source', counterType: 'charge', amount });
const fieldCost = (amount: number, filter?: Record<string, unknown>): CounterRemovalCost =>
  ({ from: 'battlefield', counterType: 'charge', amount, ...(filter ? { filter } : {}) }) as CounterRemovalCost;

const manaSource = (overrides: Partial<ActivatedAbility> = {}): ActivatedAbility =>
  ({
    id: 'mana',
    type: 'activated',
    castSpeed: 'instant',
    cost: { tap: true },
    effect: {
      action: 'ADD_MANA',
      params: { color: 'red', amount: 1 },
      tags: [],
      targeting: { type: 'self', required: false },
    },
    ...overrides,
  }) as ActivatedAbility;

describe('direct action costs', () => {
  it('accepts an empty cost', () => {
    const source = makeCard();
    const room = roomWith({ battlefield: [source] });
    expect(planActionCosts(room, 'player1', source)).toEqual({ success: true, mutations: [] });
  });

  it('rejects a malformed cost and a missing payer', () => {
    const source = makeCard();
    const room = roomWith({ battlefield: [source] });
    expect(planActionCosts(room, 'player1', source, { life: -1 })).toEqual({
      success: false,
      reason: 'Invalid action cost',
    });
    expect(planActionCosts(room, 'player1', source, {})).toEqual({ success: true, mutations: [] });
    expect(planActionCosts(room, 'nobody', source, {})).toEqual({ success: false, reason: 'Cannot pay life cost' });
  });

  it('validates and applies a life cost', () => {
    const source = makeCard();
    const room = roomWith({ battlefield: [source] });
    room.players.player1.life = 10;

    const paid = planActionCosts(room, 'player1', source, { life: 4 });
    expect(paid.success).toBe(true);
    if (paid.success) expect(paid.mutations).toEqual([{ type: 'SET_LIFE', playerId: 'player1', amount: 6 }]);

    expect(planActionCosts(room, 'player1', source, { life: 30 })).toEqual({
      success: false,
      reason: 'Cannot pay life cost',
    });
  });

  it('pays a discard-self cost only from the hand at the same revision', () => {
    const handSource = makeCard({ zone: 'hand' });
    const room = roomWith({ battlefield: [] });
    room.players.player1.hand = [handSource];

    const paid = planActionCosts(room, 'player1', handSource, { discardSelf: true });
    expect(paid.success).toBe(true);
    if (paid.success) {
      expect(paid.mutations).toEqual([
        { type: 'MOVE_CARD', cardUuid: handSource.uuid, playerId: 'player1', from: 'hand', to: 'graveyard', reason: 'discard' },
      ]);
    }

    const battlefieldSource = makeCard({ zone: 'battlefield' });
    const battlefieldRoom = roomWith({ battlefield: [battlefieldSource] });
    expect(planActionCosts(battlefieldRoom, 'player1', battlefieldSource, { discardSelf: true })).toEqual({
      success: false,
      reason: 'Cost source is not in your hand',
    });
  });

  it('pays tap and untap costs only in the expected orientation', () => {
    const untapped = makeCard();
    const tapped = makeCard({ state: { isTapped: true } });
    const room = roomWith({ battlefield: [untapped, tapped] });

    const tap = planActionCosts(room, 'player1', untapped, { tap: true });
    expect(tap).toEqual({ success: true, mutations: [{ type: 'TAP_CARD', cardUuid: untapped.uuid }] });
    expect(planActionCosts(room, 'player1', tapped, { tap: true })).toEqual({
      success: false,
      reason: 'Cannot pay orientation cost',
    });

    const untap = planActionCosts(room, 'player1', tapped, { untap: true });
    expect(untap).toEqual({ success: true, mutations: [{ type: 'UNTAP_CARD', cardUuid: tapped.uuid }] });
    expect(planActionCosts(room, 'player1', untapped, { untap: true })).toEqual({
      success: false,
      reason: 'Cannot pay orientation cost',
    });

    const elsewhere = makeCard({ zone: 'hand' });
    expect(planActionCosts(room, 'player1', elsewhere, { tap: true })).toEqual({
      success: false,
      reason: 'Cost source is not on your battlefield',
    });
  });

  it('pays a sacrifice cost for a permanent you control', () => {
    const source = makeCard();
    const room = roomWith({ battlefield: [source] });
    expect(planActionCosts(room, 'player1', source, { sacrifice: true })).toEqual({
      success: true,
      mutations: [{ type: 'SACRIFICE_CARD', cardUuid: source.uuid, zoneRevision: 0 }],
    });
  });

  it('blocks orientation costs for a summoning-sick creature without haste', () => {
    const sick = makeCard({ blueprint: { cardTypes: ['Creature'] }, state: { summoningSickness: true } });
    const hasty = makeCard({ blueprint: { cardTypes: ['Creature'], keywords: ['Haste'] }, state: { summoningSickness: true } });
    const artifact = makeCard({ state: { summoningSickness: true } });
    const room = roomWith({ battlefield: [sick, hasty, artifact] });

    expect(planActionCosts(room, 'player1', sick, { tap: true })).toEqual({
      success: false,
      reason: 'Summoning sickness prevents paying this cost',
    });
    expect(planActionCosts(room, 'player1', hasty, { tap: true }).success).toBe(true);
    expect(planActionCosts(room, 'player1', artifact, { tap: true }).success).toBe(true);
  });

  it('requires an exact, distinct discard selection', () => {
    const source = makeCard();
    const a = makeCard({ zone: 'hand' });
    const b = makeCard({ zone: 'hand' });
    const room = roomWith({ battlefield: [source] });
    room.players.player1.hand = [a, b];

    const paid = planActionCosts(room, 'player1', source, { discard: 2 }, { discardUuids: [a.uuid, b.uuid] });
    expect(paid.success).toBe(true);
    if (paid.success) {
      expect(paid.mutations).toEqual([
        { type: 'MOVE_CARD', cardUuid: a.uuid, playerId: 'player1', from: 'hand', to: 'graveyard', reason: 'discard' },
        { type: 'MOVE_CARD', cardUuid: b.uuid, playerId: 'player1', from: 'hand', to: 'graveyard', reason: 'discard' },
      ]);
    }

    const reject = (selections: Record<string, unknown>) =>
      planActionCosts(room, 'player1', source, { discard: 2 }, selections);
    expect(reject({})).toEqual({ success: false, reason: 'Select the required cards to discard' });
    expect(reject({ discardUuids: [a.uuid] })).toEqual({ success: false, reason: 'Select the required cards to discard' });
    expect(reject({ discardUuids: [a.uuid, a.uuid] })).toEqual({ success: false, reason: 'Select the required cards to discard' });
    expect(reject({ discardUuids: [a.uuid, 4] })).toEqual({ success: false, reason: 'Select the required cards to discard' });
    expect(reject({ discardUuids: 'nope' })).toEqual({ success: false, reason: 'Select the required cards to discard' });
    expect(reject({ discardUuids: [a.uuid, source.uuid] })).toEqual({ success: false, reason: 'Invalid discard selection' });
  });

  it('validates the mana payment against the pool', () => {
    const source = makeCard();
    const room = roomWith({ battlefield: [source] });

    const paid = planActionCosts(room, 'player1', source, { mana: { red: 2 } });
    expect(paid.success).toBe(true);
    if (paid.success) expect(paid.mutations).toEqual([{ type: 'SPEND_MANA', playerId: 'player1', cost: { red: 2 } }]);

    expect(planActionCosts(room, 'player1', source, { mana: { red: 50 } })).toEqual({
      success: false,
      reason: 'Invalid mana payment',
    });
  });

  it('propagates counter payment failures', () => {
    const source = makeCard({ state: { counters: { charge: 1 } } });
    const room = roomWith({ battlefield: [source] });
    expect(planActionCosts(room, 'player1', source, { removeCounters: [sourceCost(2)] })).toEqual({
      success: false,
      reason: 'Not enough counters to pay the complete cost',
    });

    const paid = planActionCosts(room, 'player1', source, { removeCounters: [sourceCost(1)] });
    expect(paid.success).toBe(true);
    if (paid.success) {
      expect(paid.mutations).toEqual([
        { type: 'REMOVE_COUNTER', cardUuid: source.uuid, counterType: 'charge', amount: 1, replacementProcessed: true },
      ]);
    }
  });

  it('pays material destruction costs and rejects unsolicited materials', () => {
    const source = makeCard();
    const material = makeCard({ state: { zoneRevision: 0 } });
    const room = roomWith({ battlefield: [source, material] });
    const cost: ActionCost = { destroyMaterials: { filter: { cardTypes: ['Artifact'] }, manaValueGreaterThan: 0 } };
    material.blueprint = {
      ...material.blueprint,
      castRequirements: { allowedZones: [], speed: 'instant', cost: { mana: { generic: 2 } } },
    };

    const paid = planActionCosts(room, 'player1', source, cost, {
      materialPayments: [{ cardUuid: material.uuid, zoneRevision: 0 }],
    });
    expect(paid.success).toBe(true);
    if (paid.success) expect(paid.mutations).toEqual([{ type: 'DESTROY_CARD', cardUuid: material.uuid, zoneRevision: 0, requiredPayment: true }]);

    expect(planActionCosts(room, 'player1', source, cost, { materialPayments: [] })).toEqual({
      success: false,
      reason: 'Choose one or more ritual materials',
    });
    expect(planActionCosts(room, 'player1', source, {}, { materialPayments: [] })).toEqual({
      success: false,
      reason: 'This action does not require materials',
    });
  });

  it('performs selected mana activations before paying the direct cost', () => {
    const source = makeCard({ blueprint: { abilities: [manaSource()] } });
    const room = roomWith({ battlefield: [source] });

    const result = planActionCosts(room, 'player1', source, { mana: { red: 1 } }, {
      manaActivations: [{ cardUuid: source.uuid }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.mutations.map((mutation) => mutation.type)).toContain('ADD_MANA');
      expect(result.mutations.map((mutation) => mutation.type)).toContain('SPEND_MANA');
    }
  });

  it('rejects malformed mana activation lists', () => {
    const source = makeCard({ blueprint: { abilities: [manaSource()] } });
    const room = roomWith({ battlefield: [source] });
    expect(planActionCosts(room, 'player1', source, {}, { manaActivations: 5 })).toEqual({
      success: false,
      reason: 'manaActivations must be an array',
    });
    expect(planActionCosts(room, 'player1', source, {}, { manaActivations: [5] })).toEqual({
      success: false,
      reason: 'Invalid mana activation selection',
    });
    expect(
      planActionCosts(room, 'player1', source, {}, { manaActivations: [{ manaActivations: [] }] }),
    ).toEqual({ success: false, reason: 'Invalid mana activation selection' });
    expect(
      planActionCosts(room, 'player1', source, {}, { manaActivations: [{ cardUuid: 'missing' }] }),
    ).toEqual({ success: false, reason: 'Card not found on your battlefield' });
  });
});

describe('mana activation planning', () => {
  const single = (overrides: Partial<ActivatedAbility> = {}) =>
    makeCard({ blueprint: { abilities: [manaSource(overrides)] } });

  it('requires the permanent to be a battlefield card you control', () => {
    const room = roomWith({ battlefield: [makeCard()] });
    expect(planManaActivation(room, 'player1', { cardUuid: 'missing' })).toEqual({
      success: false,
      reason: 'Card not found on your battlefield',
    });
    const other = makeCard({ controllerId: 'player2' });
    expect(planManaActivation(roomWith({ battlefield: [other] }), 'player1', { cardUuid: other.uuid })).toEqual({
      success: false,
      reason: 'Card not found on your battlefield',
    });
  });

  it('selects an ability by id, by lone candidate or by index', () => {
    const card = single();
    const room = roomWith({ battlefield: [card] });
    expect(planManaActivation(room, 'player1', { cardUuid: card.uuid }).success).toBe(true);
    expect(planManaActivation(room, 'player1', { cardUuid: card.uuid, abilityId: 'mana' }).success).toBe(true);
    expect(planManaActivation(room, 'player1', { cardUuid: card.uuid, abilityId: 'other' })).toEqual({
      success: false,
      reason: 'Select a valid mana ability',
    });

    const two = makeCard({ blueprint: { abilities: [manaSource(), manaSource({ id: 'mana-2' })] } });
    const twoRoom = roomWith({ battlefield: [two] });
    expect(planManaActivation(twoRoom, 'player1', { cardUuid: two.uuid, abilityIndex: 1 }).success).toBe(true);
    expect(planManaActivation(twoRoom, 'player1', { cardUuid: two.uuid, abilityIndex: 5 })).toEqual({
      success: false,
      reason: 'Select a valid mana ability',
    });
  });

  it('rejects an exhausted use budget and malformed output', () => {
    const limited = single({ limitPerTurn: 1 });
    const room = roomWith({
      battlefield: [limited],
      turnHistory: {
        turnNumber: 1,
        events: [],
        counts: {},
        playerCounts: {},
        uses: { [`${limited.uuid}:0:mana`]: 1 },
        landPlays: {},
      },
    });
    expect(planManaActivation(room, 'player1', { cardUuid: limited.uuid })).toEqual({
      success: false,
      reason: 'Ability use limit reached',
    });

    const malformed = single({ effect: { ...manaSource().effect!, params: { color: 'purple', amount: 1 } } });
    expect(planManaActivation(roomWith({ battlefield: [malformed] }), 'player1', { cardUuid: malformed.uuid })).toEqual({
      success: false,
      reason: 'Invalid mana output',
    });
  });

  it('requires an explicit colour for a multi-colour ability', () => {
    const card = single({ effect: { ...manaSource().effect!, params: { colors: ['red', 'blue'], amount: 1 } } });
    const room = roomWith({ battlefield: [card] });

    expect(planManaActivation(room, 'player1', { cardUuid: card.uuid })).toEqual({
      success: false,
      reason: 'Select a valid mana color',
    });
    expect(planManaActivation(room, 'player1', { cardUuid: card.uuid, manaColor: 'green' })).toEqual({
      success: false,
      reason: 'Select a valid mana color',
    });
    const blue = planManaActivation(room, 'player1', { cardUuid: card.uuid, manaColor: 'blue' });
    expect(blue.success).toBe(true);
    if (blue.success) expect(blue.mutations.some((mutation) => mutation.type === 'ADD_MANA')).toBe(true);
  });

  it('refuses to activate without priority', () => {
    const card = single();
    const room = roomWith({ battlefield: [card], priorityPlayerId: 'player2' });
    expect(planManaActivation(room, 'player1', { cardUuid: card.uuid })).toEqual({
      success: false,
      reason: 'You do not have priority to act right now.',
    });
  });

  it('refuses numeric declarations and cost routes', () => {
    const declared = single({ numericDeclarations: [{ name: 'X', min: 0 }] });
    expect(planManaActivation(roomWith({ battlefield: [declared] }), 'player1', { cardUuid: declared.uuid })).toEqual({
      success: false,
      reason: 'Mana abilities cannot declare numeric bindings',
    });

    const alternative = single({
      alternativeCosts: [{ id: 'alt', label: 'Alt', cost: {} }],
    });
    expect(planManaActivation(roomWith({ battlefield: [alternative] }), 'player1', { cardUuid: alternative.uuid })).toEqual({
      success: false,
      reason: 'Mana abilities do not support cost routes',
    });

    const additional = single({ additionalCost: { life: 1 } });
    expect(planManaActivation(roomWith({ battlefield: [additional] }), 'player1', { cardUuid: additional.uuid })).toEqual({
      success: false,
      reason: 'Mana abilities do not support cost routes',
    });

    const plain = single();
    expect(
      planManaActivation(roomWith({ battlefield: [plain] }), 'player1', { cardUuid: plain.uuid, costRoute: { kind: 'base' } }),
    ).toEqual({ success: false, reason: 'Mana abilities do not support cost routes' });
  });

  it('rejects an unresolvable authored generic cost', () => {
    const card = single({
      cost: { mana: { generic: { numeric: { kind: 'binding', name: 'X' } } } },
    } as Partial<ActivatedAbility>);
    expect(planManaActivation(roomWith({ battlefield: [card] }), 'player1', { cardUuid: card.uuid })).toEqual({
      success: false,
      reason: 'Invalid mana ability cost',
    });
  });

  it('propagates a payment failure from the underlying cost planner', () => {
    const discardCost = makeCard({
      blueprint: { abilities: [manaSource({ cost: { discard: 1 } })] },
    });
    const room = roomWith({ battlefield: [discardCost] });
    room.players.player1.hand = [makeCard({ zone: 'hand' })];
    expect(planManaActivation(room, 'player1', { cardUuid: discardCost.uuid })).toEqual({
      success: false,
      reason: 'Select the required cards to discard',
    });
  });

  it('refuses output that would overflow the pool', () => {
    const card = single();
    const room = roomWith({ battlefield: [card] });
    room.players.player1.mana.red = Number.MAX_SAFE_INTEGER;
    expect(planManaActivation(room, 'player1', { cardUuid: card.uuid })).toEqual({
      success: false,
      reason: 'Mana output exceeds the pool limit',
    });
  });
});

describe('counter cost planning', () => {
  const artifact = (count: number, id?: string) =>
    makeCard({
      ...(id ? { name: id } : {}),
      state: { counters: { charge: count } },
    });

  it('selects eligible controlled incarnations for a clause', () => {
    const source = artifact(2);
    const other = artifact(3);
    const opponent = makeCard({ controllerId: 'player2', state: { counters: { charge: 9 } } });
    const room = roomWith({ battlefield: [source, other, opponent] });

    expect(counterCostCards(room, 'player1', source, sourceCost(1))).toEqual([source]);
    expect(counterCostCards(room, 'player1', source, fieldCost(1))).toEqual([source, other]);
    expect(counterCostCards(room, 'player1', source, fieldCost(1, { ids: [other.blueprint.id] }))).toEqual([source, other]);

    const stale = { ...source, state: { ...source.state, zoneRevision: 4 } };
    expect(counterCostCards(room, 'player1', stale, sourceCost(1))).toEqual([]);

    const filtered = makeCard({ blueprint: { id: 'keeper' }, state: { counters: { charge: 1 } } });
    const filteredRoom = roomWith({ battlefield: [source, filtered] });
    expect(counterCostCards(filteredRoom, 'player1', source, fieldCost(1, { ids: ['keeper'] }))).toEqual([filtered]);
  });

  it('rejects invalid clauses and malformed selections', () => {
    const source = artifact(2);
    const room = roomWith({ battlefield: [source] });
    expect(planCounterCosts(room, 'player1', source, 'nope' as unknown as CounterRemovalCost[])).toEqual({
      success: false,
      reason: 'Invalid counter removal cost',
    });
    expect(planCounterCosts(room, 'player1', source, Array.from({ length: 17 }, () => sourceCost(1)))).toEqual({
      success: false,
      reason: 'Invalid counter removal cost',
    });
    expect(planCounterCosts(room, 'player1', source, [{ from: 'source', counterType: 'charge', amount: 0 }])).toEqual({
      success: false,
      reason: 'Invalid counter removal cost',
    });

    const invalid = (input: unknown) => planCounterCosts(room, 'player1', source, [sourceCost(1)], input);
    expect(invalid(5)).toEqual({ success: false, reason: 'Invalid counter payment selections' });
    expect(invalid([])).toEqual({ success: false, reason: 'Invalid counter payment selections' });
    expect(invalid({ x: [{ cardUuid: source.uuid, zoneRevision: 0, amount: 1 }] })).toEqual({
      success: false,
      reason: 'Invalid counter payment selections',
    });
    expect(invalid({ 1.5: [{ cardUuid: source.uuid, zoneRevision: 0, amount: 1 }] })).toEqual({
      success: false,
      reason: 'Invalid counter payment selections',
    });
    expect(invalid({ 9: [{ cardUuid: source.uuid, zoneRevision: 0, amount: 1 }] })).toEqual({
      success: false,
      reason: 'Invalid counter payment selections',
    });
    expect(invalid({ 0: 5 })).toEqual({ success: false, reason: 'Invalid counter payment selections' });
    expect(invalid({ 0: [] })).toEqual({ success: false, reason: 'Invalid counter payment selections' });
    expect(invalid({ 0: [5] })).toEqual({ success: false, reason: 'Invalid counter payment selections' });
    expect(invalid({ 0: [{ cardUuid: source.uuid, zoneRevision: 0, amount: 1, extra: 1 }] })).toEqual({
      success: false,
      reason: 'Invalid counter payment selections',
    });
    expect(invalid({ 0: [{ cardUuid: '', zoneRevision: 0, amount: 1 }] })).toEqual({
      success: false,
      reason: 'Invalid counter payment selections',
    });
    expect(invalid({ 0: [{ cardUuid: 4, zoneRevision: 0, amount: 1 }] })).toEqual({
      success: false,
      reason: 'Invalid counter payment selections',
    });
    expect(invalid({ 0: [{ cardUuid: source.uuid, zoneRevision: -1, amount: 1 }] })).toEqual({
      success: false,
      reason: 'Invalid counter payment selections',
    });
    expect(invalid({ 0: [{ cardUuid: source.uuid, zoneRevision: 0.5, amount: 1 }] })).toEqual({
      success: false,
      reason: 'Invalid counter payment selections',
    });
    expect(invalid({ 0: [{ cardUuid: source.uuid, zoneRevision: 0, amount: 0 }] })).toEqual({
      success: false,
      reason: 'Invalid counter payment selections',
    });
    expect(invalid({ 0: [{ cardUuid: source.uuid, zoneRevision: 0, amount: 1.5 }] })).toEqual({
      success: false,
      reason: 'Invalid counter payment selections',
    });
    expect(
      invalid({
        0: [
          { cardUuid: source.uuid, zoneRevision: 0, amount: 1 },
          { cardUuid: source.uuid, zoneRevision: 0, amount: 1 },
        ],
      }),
    ).toEqual({ success: false, reason: 'Invalid counter payment selections' });
  });

  it('rejects a corrupt counter inventory', () => {
    const source = artifact(-1);
    const room = roomWith({ battlefield: [source] });
    expect(planCounterCosts(room, 'player1', source, [sourceCost(1)])).toEqual({
      success: false,
      reason: 'Invalid counter inventory',
    });
  });

  it('validates explicit reservations against the shared inventory', () => {
    const source = artifact(5);
    const room = roomWith({ battlefield: [source] });

    expect(
      planCounterCosts(room, 'player1', source, [sourceCost(3)], {
        0: [{ cardUuid: 'missing', zoneRevision: 0, amount: 3 }],
      }),
    ).toEqual({ success: false, reason: 'Counter payment source is stale or ineligible' });

    expect(
      planCounterCosts(room, 'player1', source, [sourceCost(3)], {
        0: [{ cardUuid: source.uuid, zoneRevision: 0, amount: 2 }],
      }),
    ).toEqual({ success: false, reason: 'Pay the exact required number of counters' });

    expect(
      planCounterCosts(room, 'player1', source, [sourceCost(3)], {
        0: [
          { cardUuid: source.uuid, zoneRevision: 0, amount: Number.MAX_SAFE_INTEGER },
          { cardUuid: source.uuid, zoneRevision: 0, amount: 1 },
        ],
      }),
    ).toEqual({ success: false, reason: 'Invalid counter payment selections' });

    expect(
      planCounterCosts(room, 'player1', source, [sourceCost(6)], {
        0: [{ cardUuid: source.uuid, zoneRevision: 0, amount: 6 }],
      }),
    ).toEqual({ success: false, reason: 'Not enough counters to pay the complete cost' });
  });

  it('requires battlefield payment sources unless solving is allowed', () => {
    const source = artifact(2);
    const room = roomWith({ battlefield: [source] });
    expect(planCounterCosts(room, 'player1', source, [fieldCost(1)])).toEqual({
      success: false,
      reason: 'Choose counter payment sources',
    });

    const solved = planCounterCosts(room, 'player1', source, [fieldCost(1)], undefined, true);
    expect(solved.success).toBe(true);
    if (solved.success) {
      expect(solved.payments['0']).toEqual([{ cardUuid: source.uuid, zoneRevision: 0, amount: 1 }]);
      expect(solved.mutations).toEqual([
        { type: 'REMOVE_COUNTER', cardUuid: source.uuid, counterType: 'charge', amount: 1, replacementProcessed: true },
      ]);
    }
  });

  it('reports unpayable and overflowing combined requirements', () => {
    const source = artifact(2);
    const room = roomWith({ battlefield: [source] });
    expect(planCounterCosts(room, 'player1', source, [sourceCost(3)], undefined, true)).toEqual({
      success: false,
      reason: 'Not enough counters to pay the complete cost',
    });

    const huge = artifact(Number.MAX_SAFE_INTEGER);
    const hugeRoom = roomWith({ battlefield: [huge] });
    expect(planCounterCosts(hugeRoom, 'player1', huge, [sourceCost(Number.MAX_SAFE_INTEGER), sourceCost(Number.MAX_SAFE_INTEGER)])).toEqual({
      success: false,
      reason: 'Combined counter cost exceeds the safe range',
    });
  });

  it('coalesces overlapping debits and keeps explicit reservations', () => {
    const source = artifact(4);
    const room = roomWith({ battlefield: [source] });

    const solved = planCounterCosts(room, 'player1', source, [fieldCost(1), fieldCost(1)], undefined, true);
    expect(solved.success).toBe(true);
    if (solved.success) {
      expect(solved.payments['0']).toHaveLength(1);
      expect(solved.payments['1']).toHaveLength(1);
      expect(solved.mutations).toHaveLength(1);
      expect(solved.mutations[0]).toMatchObject({ type: 'REMOVE_COUNTER', amount: 2 });
    }

    const mixed = planCounterCosts(
      room,
      'player1',
      source,
      [fieldCost(1), fieldCost(2)],
      { 0: [{ cardUuid: source.uuid, zoneRevision: 0, amount: 1 }] },
      true,
    );
    expect(mixed.success).toBe(true);
    if (mixed.success) {
      expect(mixed.payments['1']).toEqual([{ cardUuid: source.uuid, zoneRevision: 0, amount: 2 }]);
      expect(mixed.mutations).toHaveLength(1);
      expect(mixed.mutations[0]).toMatchObject({ type: 'REMOVE_COUNTER', amount: 3 });
    }
  });

  it('reports the available counters and reservations in payment options', () => {
    const source = artifact(3);
    const other = artifact(2);
    const room = roomWith({ battlefield: [source, other] });

    const plain = counterPaymentOptions(room, 'player1', source, fieldCost(1));
    expect(plain).toEqual([
      { id: `${source.uuid}:0`, value: { cardUuid: source.uuid, zoneRevision: 0 }, limit: 3, label: 'Test Card — 3 charge counters' },
      { id: `${other.uuid}:0`, value: { cardUuid: other.uuid, zoneRevision: 0 }, limit: 2, label: 'Test Card — 2 charge counters' },
    ]);

    const selfReserved = counterPaymentOptions(room, 'player1', source, fieldCost(1), {
      costs: [sourceCost(2)],
      payments: {},
      index: 1,
    });
    expect(selfReserved.map((option) => option.limit)).toEqual([1, 2]);

    const fieldReserved = counterPaymentOptions(room, 'player1', source, fieldCost(1), {
      costs: [fieldCost(1)],
      payments: { 0: [{ cardUuid: other.uuid, zoneRevision: 0, amount: 1 }] },
      index: 1,
    });
    expect(fieldReserved.map((option) => option.limit)).toEqual([3, 1]);

    const otherType = counterPaymentOptions(room, 'player1', source, fieldCost(1), {
      costs: [{ from: 'battlefield', counterType: 'fade', amount: 1 }],
      payments: {},
      index: 1,
    });
    expect(otherType.map((option) => option.limit)).toEqual([3, 2]);

    const exhausted = counterPaymentOptions(room, 'player1', source, fieldCost(1), {
      costs: [sourceCost(3)],
      payments: {},
      index: 1,
    });
    expect(exhausted.map((option) => option.label)).toEqual(['Test Card — 2 charge counters']);
  });

  it('converts a distribution answer into explicit payment references', () => {
    const reference = { cardUuid: 'a', zoneRevision: 0 };
    expect(counterPaymentAnswer({ values: [reference], allocations: { 'a:0': 2 } })).toEqual([
      { cardUuid: 'a', zoneRevision: 0, amount: 2 },
    ]);
    expect(counterPaymentAnswer({ values: [reference] })).toEqual([{ cardUuid: 'a', zoneRevision: 0, amount: 0 }]);
  });
});
