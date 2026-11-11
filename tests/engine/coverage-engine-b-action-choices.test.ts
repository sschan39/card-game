import { describe, expect, it } from 'vitest';
import { applyActionChoice, prepareActionChoice } from '@engine/action-choices';
import type { ActionContinuation, ChoiceAnswer } from '@shared/choice.types';
import type { CardInstance } from '@shared/card.types';
import type { GameRoom } from '@shared/game.room.types';
import { parseCardDefinition } from '@library/card-parser';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';

const state = (over: Record<string, unknown> = {}) => ({
  zone: 'hand',
  zoneRevision: 0,
  ownerId: 'player1',
  controllerId: 'player1',
  isTapped: false,
  damageTaken: 0,
  summoningSickness: false,
  attackedThisTurn: false,
  counters: {},
  ...over,
});

function spell(uuid: string, definition: Record<string, unknown>): CardInstance {
  return {
    uuid,
    blueprint: parseCardDefinition({ schemaVersion: 1, id: uuid, name: uuid, cardTypes: ['Spell'], ...definition } as never),
    state: state() as never,
  } as CardInstance;
}

function artifact(uuid: string, extra: Record<string, unknown> = {}, controllerId = 'player1'): CardInstance {
  const card = creature(uuid, controllerId);
  card.blueprint = parseCardDefinition({
    schemaVersion: 1,
    id: uuid,
    name: uuid,
    cardTypes: ['Artifact'],
    ...extra,
  } as never);
  return card;
}

function withAbilities(card: CardInstance, abilities: unknown[]): CardInstance {
  card.blueprint = { ...card.blueprint, abilities } as never;
  return card;
}

const manaAbility = (over: Record<string, unknown> = {}) => ({
  id: 'm',
  type: 'activated',
  castSpeed: 'instant',
  cost: { tap: true },
  effect: { action: 'ADD_MANA', params: { color: 'red', amount: 1 }, tags: [], targeting: { type: 'self', required: false } },
  ...over,
});

const drawSpell = () =>
  spell('drawer', {
    manaCost: '{R}',
    onCastEffects: [{ action: 'DRAW', params: { amount: 1 }, targeting: { type: 'self', required: false } }],
  });

function roomWith(...cards: CardInstance[]): GameRoom {
  const room = createTestRoom();
  room.battlefield = cards;
  return room;
}

describe('prepareActionChoice', () => {
  it('refuses numeric declarations on a mana ability', () => {
    const source = withAbilities(artifact('numeric'), [manaAbility({ numericDeclarations: [{ name: 'X', min: 0, max: 3 }] })]);
    expect(prepareActionChoice(roomWith(source), 'player1', 'tapForMana', { cardUuid: 'numeric' })).toEqual({
      kind: 'reject',
      error: 'Mana abilities cannot declare numeric bindings',
    });
  });

  it('asks for a target group and falls back to a single target', () => {
    const room = roomWith(creature('prey', 'player2'));
    room.players.player1.hand = [
      spell('zap', {
        manaCost: '{R}',
        onCastEffects: [
          { action: 'DEAL_DAMAGE', params: { amount: 1 }, targeting: { type: 'permanent', required: true, minTargets: 1 } },
        ],
      }),
    ];
    const prepared = prepareActionChoice(room, 'player1', 'cast_spell', { cardUuid: 'zap' });
    expect(prepared).toMatchObject({ kind: 'prompt', choice: { kind: 'targets', min: 1, max: 1 } });
  });

  it('requires a list of mana activations', () => {
    const room = roomWith();
    room.players.player1.hand = [drawSpell()];
    expect(prepareActionChoice(room, 'player1', 'cast_spell', { cardUuid: 'drawer', manaActivations: 'nope' as never })).toEqual({
      kind: 'reject',
      error: 'manaActivations must be an array',
    });
  });

  it('surfaces the rejection of a nested mana activation', () => {
    const source = withAbilities(artifact('tap-me'), [manaAbility()]);
    const room = roomWith(source);
    room.players.player1.hand = [drawSpell()];
    expect(
      prepareActionChoice(room, 'player1', 'cast_spell', {
        cardUuid: 'drawer',
        manaActivations: [{ cardUuid: 'tap-me', abilityId: 'm', costRoute: { kind: 'base' } }],
      }),
    ).toEqual({ kind: 'reject', error: 'Mana abilities do not support cost routes' });
  });

  it('does not prompt for a mana ability with nothing left to ask', () => {
    const source = withAbilities(artifact('quiet'), [manaAbility()]);
    expect(prepareActionChoice(roomWith(source), 'player1', 'tapForMana', { cardUuid: 'quiet' })).toEqual({ kind: 'none' });
  });

  it('rejects a material cost the board cannot satisfy', () => {
    const source = withAbilities(artifact('ritual'), [
      {
        id: 'r',
        type: 'activated',
        castSpeed: 'instant',
        cost: { tap: true, destroyMaterials: { filter: {}, manaValueGreaterThan: 3 } },
        effect: { action: 'ADD_MANA', params: { color: 'red', amount: 1 }, tags: [], targeting: { type: 'self', required: false } },
      },
    ]);
    expect(prepareActionChoice(roomWith(source), 'player1', 'activate_ability', { cardUuid: 'ritual', abilityId: 'r' })).toEqual({
      kind: 'reject',
      error: 'Not enough eligible materials',
    });
  });
});

describe('applyActionChoice', () => {
  const activation = (uuid: string) => ({ cardUuid: uuid, abilityId: 'm' });
  const continuation = (over: Partial<ActionContinuation>): ActionContinuation => ({
    type: 'action',
    actionId: 'cast_spell',
    data: {},
    field: 'targetGroups',
    ...over,
  });

  it('files a counter payment against the nested mana activation', () => {
    const applied = applyActionChoice(
      continuation({
        field: 'counterPayments',
        counterCostIndex: 0,
        manaActivationIndex: 0,
        data: { manaActivations: [activation('a'), activation('b')] },
      }),
      { values: [{ cardUuid: 'spent', zoneRevision: 0 }], allocations: { 'spent:0': 2 } } as ChoiceAnswer,
    );
    expect(applied.manaActivations).toEqual([
      { ...activation('a'), counterPayments: { 0: [{ cardUuid: 'spent', zoneRevision: 0, amount: 2 }] } },
      activation('b'),
    ]);
  });

  it('files a counter payment on the action itself', () => {
    const applied = applyActionChoice(
      continuation({ field: 'counterPayments', counterCostIndex: 1, data: { modes: ['m'] } }),
      { values: [{ cardUuid: 'spent', zoneRevision: 0 }] } as ChoiceAnswer,
    );
    expect(applied).toEqual({
      modes: ['m'],
      counterPayments: { 1: [{ cardUuid: 'spent', zoneRevision: 0, amount: 0 }] },
    });
  });

  it('stores a nested mana allocation at the selected activation', () => {
    const applied = applyActionChoice(
      continuation({ field: 'payment', manaActivationIndex: 1, data: { manaActivations: [activation('a'), activation('b')] } }),
      { values: [], allocations: { red: 2 } } as ChoiceAnswer,
    );
    expect(applied.manaActivations).toEqual([activation('a'), { ...activation('b'), payment: { red: 2 } }]);
  });

  it('appends a chosen target group and records a distribution', () => {
    const room = createTestRoom();
    expect(
      applyActionChoice(continuation({ field: 'targetGroups', groupId: 'g', data: {} }), {
        values: [{ targetType: 'player', playerId: 'player2' }],
      } as ChoiceAnswer),
    ).toEqual({ targetGroups: [{ id: 'g', targets: [{ targetType: 'player', playerId: 'player2' }] }] });

    const distributed = applyActionChoice(continuation({ field: 'distributions', groupId: 'effect-0', data: {} }), {
      values: [],
      allocations: { 'player2': 2 },
    } as ChoiceAnswer);
    expect(distributed).toEqual({ distributions: { 'effect-0': { player2: 2 } } });
    expect(applyActionChoice(continuation({ field: 'targetGroups', groupId: 'g' }), {
      values: [{ targetType: 'player', playerId: room.player2Id }],
    } as ChoiceAnswer).targetGroups).toHaveLength(1);
  });
});


describe('prepareActionChoice payment prompts', () => {
  it('asks for a mana allocation without demanding targets', () => {
    const room = roomWith();
    const free = spell('free', {
      manaCost: '',
      onCastEffects: [{ action: 'DRAW', params: { amount: 1 }, targeting: { type: 'self', required: false } }],
    });
    // A cost with no mana component leaves the allocation total at zero.
    free.blueprint = {
      ...free.blueprint,
      castRequirements: { allowedZones: ['hand'], cost: { discard: 0 } },
    } as never;
    room.players.player1.hand = [free];
    expect(prepareActionChoice(room, 'player1', 'cast_spell', { cardUuid: 'free', choosePayment: true })).toMatchObject({
      kind: 'prompt',
      choice: { kind: 'payment', total: 0 },
    });
  });

  it('offers an optional target group without requiring a choice', () => {
    const room = roomWith(creature('prey', 'player2'));
    room.players.player1.hand = [
      spell('maybe', {
        manaCost: '{R}',
        onCastEffects: [
          { action: 'DEAL_DAMAGE', params: { amount: 1 }, targeting: { type: 'permanent', required: false, maxTargets: 1 } },
        ],
      }),
    ];
    expect(prepareActionChoice(room, 'player1', 'cast_spell', { cardUuid: 'maybe' })).toMatchObject({
      kind: 'prompt',
      choice: { kind: 'targets', min: 0, max: 1 },
    });
  });

  it('counts a mana colour that carries no requirement', () => {
    const room = roomWith();
    const partial = spell('partial', {
      onCastEffects: [{ action: 'DRAW', params: { amount: 1 }, targeting: { type: 'self', required: false } }],
    });
    partial.blueprint = {
      ...partial.blueprint,
      castRequirements: { allowedZones: ['hand'], cost: { mana: { red: undefined, blue: 1 } } },
    } as never;
    room.players.player1.hand = [partial];
    expect(prepareActionChoice(room, 'player1', 'cast_spell', { cardUuid: 'partial', choosePayment: true })).toMatchObject({
      kind: 'prompt',
      choice: { kind: 'payment', total: 1 },
    });
  });
});

describe('prepareActionChoice payment sequencing', () => {
  it('rechecks a counter payment against the board the mana left behind', () => {
    const altar = withAbilities(artifact('altar'), [
      {
        id: 'sac',
        type: 'activated',
        castSpeed: 'instant',
        cost: { sacrifice: true },
        effect: { action: 'ADD_MANA', params: { color: 'red', amount: 1 }, tags: [], targeting: { type: 'self', required: false } },
      },
    ]);
    altar.state.counters = { charge: 1 };
    const room = roomWith(altar);
    const ritual = spell('ritual', {
      manaCost: '',
      onCastEffects: [{ action: 'DRAW', params: { amount: 1 }, targeting: { type: 'self', required: false } }],
    });
    ritual.blueprint = {
      ...ritual.blueprint,
      castRequirements: {
        allowedZones: ['hand'],
        cost: { removeCounters: [{ counterType: 'charge', amount: 1, from: 'battlefield' }] },
      },
    } as never;
    room.players.player1.hand = [ritual];
    const prepared = prepareActionChoice(room, 'player1', 'cast_spell', {
      cardUuid: 'ritual',
      counterPayments: { 0: [{ cardUuid: 'altar', zoneRevision: 0, amount: 1 }] },
      manaActivations: [{ cardUuid: 'altar', abilityId: 'sac' }],
    });
    expect(prepared).toMatchObject({ kind: 'reject' });
  });
});



describe('prepareActionChoice distributions', () => {
  it('labels a distribution over stack targets', () => {
    const spreader = withAbilities(artifact('spreader'), [
      {
        id: 'spread',
        type: 'activated',
        castSpeed: 'instant',
        cost: { tap: true },
        effect: {
          action: 'COUNTER',
          params: {},
          tags: [],
          targeting: { type: 'stack', required: true, maxTargets: 1 },
          choice: { kind: 'distribution', total: 1 },
        },
      },
    ]);
    const room = roomWith(spreader);
    room.stack = [{ uuid: 'other-spell', type: 'spell', controllerId: 'player2', source: creature('src', 'player2'), effects: [], countered: false }] as never;
    const prepared = prepareActionChoice(room, 'player1', 'activate_ability', {
      cardUuid: 'spreader',
      abilityId: 'spread',
      targets: [{ targetType: 'stack', stackUuid: 'other-spell' }],
    });
    expect(prepared).toMatchObject({ kind: 'prompt', choice: { kind: 'distribution' } });
  });
});
