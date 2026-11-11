import { afterEach, describe, expect, it } from 'vitest';
import { parseCardDefinition } from '@card-game/engine/rules/parse';
import { applyCostRules } from '@card-game/engine/rules/runtime/costs';
import { GameEngine } from '@engine/game-engine';
import { playCardHandler } from '@engine/handlers/play-card-handler';
import { OptionService } from '@engine/option-service';
import { canPrepareTrigger, availableTriggerModes, triggerTargetGroups } from '@engine/trigger-preparation';
import { planTriggerScheduling, applyTriggerChoice } from '@engine/trigger-scheduler';
import { offerResolutionPayment, answerResolutionPayment } from '@engine/resolution-payments';
import { MutationCommitter } from '@engine/mutation-committer';
import { captureSourceInformation } from '@engine/source-information';
import { EventBus } from '@engine/event-bus';
import { newTurnHistory } from '@engine/turn-history';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';
import { instantiateCard } from '@library/card-factory';
import type { CardInstance } from '@shared/card.types';
import type { GameRoom } from '@shared/game.room.types';
import type { GameMutation } from '@shared/game-mutation.types';
import type { StackEffect, StackObject, TriggeredStackObject } from '@shared/effect.types';
import type { PaymentContinuation } from '@shared/choice.types';
import type { ReplacementDefinition } from '@shared/proposed-event.types';
import type { TriggerQueue } from '@shared/trigger.types';

const engines: GameEngine[] = [];
afterEach(() => engines.splice(0).forEach((engine) => engine.dispose()));

function defined(id: string, extra: Record<string, unknown>): CardInstance {
  const blueprint = parseCardDefinition({ schemaVersion: 1, id, name: id, cardTypes: ['Artifact'], ...extra });
  return { ...creature(id, 'player1'), blueprint };
}

function battlefieldRule(rules: unknown[]): CardInstance {
  return defined('rules-source', { abilities: [{ id: 'passive', type: 'static', rules }] });
}

function rawBattlefieldRule(rules: unknown[]): CardInstance {
  const card = creature('raw-rules-source', 'player1');
  card.blueprint = {
    ...card.blueprint,
    abilities: [{ id: 'passive', type: 'static', rules, effects: [] }],
  } as unknown as CardInstance['blueprint'];
  return card;
}

function handCard(blueprintExtra: Record<string, unknown> = {}): CardInstance {
  const card = creature('hand-card', 'player1');
  card.state = { ...card.state, zone: 'hand', zoneRevision: 0 };
  card.blueprint = {
    ...card.blueprint,
    castRequirements: { allowedZones: ['hand'], speed: 'sorcery', cost: {} },
    ...blueprintExtra,
  } as CardInstance['blueprint'];
  return card;
}

describe('cast cost rules', () => {
  const rule = (id: string, operation: unknown, extra: Record<string, unknown> = {}) => ({
    id,
    family: 'costs',
    action: 'cast',
    scope: { cardTypes: ['Creature'] },
    operation,
    ...extra,
  });

  it('sets, increases and reduces mana requirements', () => {
    const room = createTestRoom();
    const target = handCard();
    room.players.player1.hand = [target];
    room.battlefield = [
      battlefieldRule([
        rule('set', { type: 'mana.set_base', color: 'red', amount: 3 }),
        rule('tax', { type: 'mana.increase', color: 'red', amount: 2 }),
        rule('discount', { type: 'mana.reduce', color: 'red', amount: 1 }),
      ]),
    ];
    const result = applyCostRules(room, 'player1', target, { mana: { red: 1 } });
    expect(result.cost.mana).toEqual({ red: 4 });
    expect(result.uses).toHaveLength(0);
  });

  it('reduces an absent mana colour from zero instead of producing NaN', () => {
    const room = createTestRoom();
    const target = handCard();
    room.players.player1.hand = [target];
    room.battlefield = [
      battlefieldRule([rule('discount', { type: 'mana.reduce', color: 'blue', amount: 1 })]),
    ];
    const result = applyCostRules(room, 'player1', target, { mana: { red: 1 } });
    expect(result.cost.mana).toEqual({ red: 1, blue: 0 });
  });

  it('skips rules whose condition is false', () => {
    const room = createTestRoom();
    const target = handCard();
    room.players.player1.hand = [target];
    room.battlefield = [
      battlefieldRule([
        rule('healthy', { type: 'mana.increase', color: 'generic', amount: 4 }, {
          condition: { op: 'gte', left: { path: 'controller.life' }, right: 100 },
        }),
      ]),
    ];
    expect(applyCostRules(room, 'player1', target, { mana: { generic: 1 } }).cost.mana).toEqual({ generic: 1 });
  });

  it('rejects non-integer modifier amounts and unsafe totals', () => {
    const room = createTestRoom();
    const target = handCard();
    room.players.player1.hand = [target];
    room.battlefield = [
      rawBattlefieldRule([rule('bad', { type: 'mana.increase', color: 'generic', amount: { numeric: { kind: 'query', id: 'missing', args: {} } } })]),
    ];
    expect(() => applyCostRules(room, 'player1', target, {})).toThrow(/Invalid cost modifier value/);
    room.battlefield = [
      rawBattlefieldRule([rule('huge', { type: 'mana.increase', color: 'generic', amount: Number.MAX_SAFE_INTEGER })]),
    ];
    expect(() => applyCostRules(room, 'player1', target, { mana: { generic: 1 } })).toThrow(
      /Modified mana cost exceeds safe range/,
    );
  });
});

describe('play card handler guards', () => {
  function handRoom(card: CardInstance): GameRoom {
    const room = createTestRoom();
    room.players.player1.hand = [card];
    return room;
  }

  it('requires a card and an announceable spell', () => {
    const room = createTestRoom();
    expect(playCardHandler.validate(room, 'player1', {})).toMatchObject({ reason: 'cardUuid is required' });
    expect(playCardHandler.propose(room, 'player1', {})).toMatchObject({ reason: 'cardUuid is required' });

    const invalidCost = handCard({
      castRequirements: { allowedZones: ['hand'], speed: 'sorcery', cost: { mana: { generic: { numeric: { kind: 'binding', name: 'x' } } } } },
    });
    expect(playCardHandler.validate(handRoom(invalidCost), 'player1', { cardUuid: invalidCost.uuid })).toMatchObject({
      reason: 'Numeric binding has no retained owner in this definition',
    });
    expect(playCardHandler.propose(handRoom(invalidCost), 'player1', { cardUuid: invalidCost.uuid })).toMatchObject({
      reason: 'Numeric binding has no retained owner in this definition',
    });
  });

  it('requires declared numbers and cost routes', () => {
    const numbered = handCard({
      numericDeclarations: [{ name: 'x', min: 0, max: 3 }],
    });
    expect(playCardHandler.validate(handRoom(numbered), 'player1', { cardUuid: numbered.uuid })).toMatchObject({
      reason: 'Choose all declared numbers',
    });
    const routed = handCard({
      castRequirements: {
        allowedZones: ['hand'],
        speed: 'sorcery',
        cost: {},
        alternativeCosts: [{ id: 'alt', label: 'Alt', cost: { life: 3 } }],
      },
    });
    expect(playCardHandler.validate(handRoom(routed), 'player1', { cardUuid: routed.uuid })).toMatchObject({
      reason: 'Choose a cost route',
    });
    expect(playCardHandler.propose(handRoom(routed), 'player1', { cardUuid: routed.uuid })).toMatchObject({
      reason: 'Choose a cost route',
    });
  });

  it('rejects unaffordable costs before building a stack object', () => {
    const expensive = handCard({
      castRequirements: { allowedZones: ['hand'], speed: 'sorcery', cost: { mana: { red: 9 } } },
    });
    const room = handRoom(expensive);
    room.players.player1.mana = { red: 0, green: 0, blue: 0, white: 0, yellow: 0, black: 0 };
    expect(playCardHandler.propose(room, 'player1', { cardUuid: expensive.uuid })).toMatchObject({ success: false });
  });

  it('rejects invalid modes, targets and divisions', () => {
    const target = () => creature('opponent-creature', 'player2');
    const division = {
      action: 'MODIFY_STATS',
      params: { amount: 3 },
      choice: { kind: 'distribution', total: 3, field: 'amount' },
      targeting: { type: 'permanent', controller: 'opponent', required: true, minTargets: 2, maxTargets: 2 },
    };
    const room = () => {
      const r = createTestRoom();
      r.battlefield = [target()];
      return r;
    };
    const badModes = handCard({ modes: [{ id: 'a', label: 'A', effects: [] }], modeCount: { min: 1, max: 1 } });
    expect(playCardHandler.validate(handRoom(badModes), 'player1', { cardUuid: badModes.uuid, modes: ['bogus'] })).toMatchObject({
      reason: 'Select valid modes',
    });
    expect(playCardHandler.propose(handRoom(badModes), 'player1', { cardUuid: badModes.uuid, modes: ['bogus'] })).toMatchObject({
      reason: 'Select valid modes',
    });

    const targeted = handCard({ onCastEffects: [division] });
    const missing = handRoom(targeted);
    missing.battlefield = [target()];
    expect(
      playCardHandler.validate(missing, 'player1', {
        cardUuid: targeted.uuid,
        targets: [{ targetType: 'permanent', cardUuid: 'missing' }],
      }),
    ).toMatchObject({ success: false });
    expect(
      playCardHandler.propose(missing, 'player1', {
        cardUuid: targeted.uuid,
        targets: [{ targetType: 'permanent', cardUuid: 'missing' }],
      }),
    ).toMatchObject({ success: false });

    const distributed = handCard({ onCastEffects: [division] });
    const roomWithTargets = handRoom(distributed);
    const first = creature('victim-1', 'player2');
    const second = creature('victim-2', 'player2');
    roomWithTargets.battlefield = [first, second];
    const action = {
      cardUuid: distributed.uuid,
      targets: [
        { targetType: 'permanent', cardUuid: first.uuid },
        { targetType: 'permanent', cardUuid: second.uuid },
      ],
      distributions: { 'effect-0': { bogus: 3 } },
    };
    expect(playCardHandler.validate(roomWithTargets, 'player1', action)).toMatchObject({ success: false });
    expect(playCardHandler.propose(roomWithTargets, 'player1', action)).toMatchObject({ success: false });
  });

  it('requires declared numbers when proposing', () => {
    const numbered = handCard({ numericDeclarations: [{ name: 'x', min: 0, max: 3 }] });
    expect(playCardHandler.propose(handRoom(numbered), 'player1', { cardUuid: numbered.uuid })).toMatchObject({
      reason: 'Choose all declared numbers',
    });
  });

  it('proposes a spell without a stack uuid', () => {
    const card = handCard();
    const room = handRoom(card);
    const result = playCardHandler.propose(room, 'player1', { cardUuid: card.uuid });
    expect(result.success).toBe(true);
    expect(result.success && result.stackObject?.uuid).toBe('');
  });

  it('resolves trivially', () => {
    expect(playCardHandler.resolve!(createTestRoom(), { uuid: 'x' } as StackObject)).toEqual({ success: true });
  });
});

describe('option service payment branches', () => {
  it('disables a cast whose announcement cannot resolve', () => {
    const room = createTestRoom();
    const invalidCost = handCard({
      castRequirements: { allowedZones: ['hand'], speed: 'sorcery', cost: { mana: { generic: { numeric: { kind: 'binding', name: 'x' } } } } },
    });
    invalidCost.state = { ...invalidCost.state, zone: 'hand', controllerId: 'player1' };
    room.players.player1.hand = [invalidCost];
    const options = new OptionService().getOptions(room, 'player1', invalidCost.uuid, 'hand');
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ actionId: 'cast_spell', disabled: true });
  });

  it('describes numbered spells with the alternative payment text', () => {
    const room = createTestRoom();
    const numbered = handCard({ numericDeclarations: [{ name: 'x', min: 0, max: 3 }] });
    room.players.player1.hand = [numbered];
    const options = new OptionService().getOptions(room, 'player1', numbered.uuid, 'hand');
    expect(options[0].description).toBe('Announce and pay the complete cost');
  });

  it('offers tap, untap and malformed mana abilities symbolically', () => {
    const room = createTestRoom();
    const land = instantiateCard('land-red');
    land.state = { ...land.state, zone: 'battlefield', controllerId: 'player1', ownerId: 'player1', isTapped: false };
    const untapper = defined('untapper', {
      cardTypes: ['Artifact'],
      abilities: [
        {
          id: 'produce-blue',
          type: 'activated',
          castSpeed: 'instant',
          cost: { mana: {}, tap: false, untap: true, life: 0, discard: 0, sacrifice: false },
          effect: { action: 'ADD_MANA', params: { color: 'blue', amount: 1 }, targeting: { type: 'self', required: false } },
        },
      ],
    });
    untapper.state = { ...untapper.state, zone: 'battlefield', isTapped: true };
    const malformed = creature('malformed', 'player1');
    malformed.state = { ...malformed.state, zone: 'battlefield', isTapped: false };
    malformed.blueprint = {
      ...malformed.blueprint,
      abilities: [
        {
          id: 'produce-none',
          type: 'activated',
          castSpeed: 'instant',
          cost: { mana: {}, tap: true, untap: false, life: 0, discard: 0, sacrifice: false },
          effect: { action: 'ADD_MANA', params: { colors: 'red', amount: 1 }, targeting: { type: 'self', required: false } },
        },
      ],
    } as CardInstance['blueprint'];
    room.battlefield = [land, untapper, malformed];
    const options = new OptionService().getOptions(room, 'player1', land.uuid, 'battlefield');
    expect(options.some((option) => option.label.startsWith('Tap: add 1 red mana'))).toBe(true);
    const untapOptions = new OptionService().getOptions(room, 'player1', untapper.uuid, 'battlefield');
    expect(untapOptions.some((option) => option.label.startsWith('Untap: add 1 blue mana'))).toBe(true);
    expect(new OptionService().getOptions(room, 'player1', malformed.uuid, 'battlefield').some((option) => option.actionId === 'tapForMana')).toBe(false);
  });

  it('reports an unavailable counter payment and a disabled activation', () => {
    const room = createTestRoom();
    const land = instantiateCard('land-red');
    land.state = { ...land.state, zone: 'battlefield', controllerId: 'player1', ownerId: 'player1', isTapped: false };
    land.blueprint = {
      ...land.blueprint,
      abilities: [
        {
          id: 'counter-mana',
          type: 'activated',
          castSpeed: 'instant',
          cost: { mana: {}, tap: true, untap: false, life: 0, discard: 0, sacrifice: false, removeCounters: [{ counterType: 'charge', amount: 5, from: 'battlefield' }] },
          effect: { action: 'ADD_MANA', params: { color: 'red', amount: 1 }, targeting: { type: 'self', required: false } },
        },
      ],
    };
    const handAbility = handCard({
      abilities: [
        {
          id: 'hand-activate',
          type: 'activated',
          castSpeed: 'sorcery',
          allowedZones: ['hand'],
          cost: { mana: { generic: { numeric: { kind: 'binding', name: 'x' } } }, tap: false, untap: false, life: 0, discard: 0, sacrifice: false },
          additionalCost: { mana: { generic: 1 } },
          effect: { action: 'DRAW', params: { amount: 1 }, targeting: { type: 'self', required: false } },
        },
      ],
    });
    room.battlefield = [land];
    room.players.player1.hand = [handAbility];
    const options = new OptionService().getOptions(room, 'player1', land.uuid, 'battlefield');
    expect(options.some((option) => option.actionId === 'tapForMana')).toBe(true);
    const handOptions = new OptionService().getOptions(room, 'player1', handAbility.uuid, 'hand');
    expect(handOptions.some((option) => option.actionId === 'activate_ability' && option.disabled)).toBe(true);
  });
});

describe('trigger preparation bounds', () => {
  function triggerRoom(): GameRoom {
    const room = createTestRoom();
    room.battlefield = [creature('trigger-source', 'player1')];
    return room;
  }

  function triggered(overrides: Partial<TriggeredStackObject> = {}): TriggeredStackObject {
    return {
      uuid: 'trigger',
      type: 'triggered',
      controllerId: 'player1',
      source: creature('trigger-source', 'player1'),
      effects: [],
      countered: false,
      ...overrides,
    } as TriggeredStackObject;
  }

  it('defaults untargeted instructions and accepts zero divisions', () => {
    const room = triggerRoom();
    const groups = triggerTargetGroups([
      { action: 'MODIFY_STATS', params: {}, tags: [], targets: [] } as StackEffect,
      {
        action: 'MODIFY_STATS',
        params: {},
        tags: [],
        targets: [],
        choice: { kind: 'distribution', total: 0 },
        targeting: { type: 'permanent', required: true, minTargets: 0 },
      } as StackEffect,
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].targeting).toMatchObject({ minTargets: 0, maxTargets: 0 });
    expect(canPrepareTrigger(room, triggered())).toBe(true);
  });

  it('returns no modes for an ability-less trigger', () => {
    const room = triggerRoom();
    expect(availableTriggerModes(room, triggered())).toEqual([]);
  });

  it('prepares trigger modes only when a complete set is feasible', () => {
    const room = triggerRoom();
    room.battlefield = [];
    const effect = {
      action: 'MODIFY_STATS',
      params: { damage: 1 },
      targeting: { type: 'permanent', required: true, minTargets: 1, maxTargets: 1 },
    };
    const object = triggered({
      ability: {
        id: 'modal',
        type: 'triggered',
        triggerCondition: 'END_OF_TURN',
        castSpeed: 'instant',
        effect,
        modes: [{ id: 'a', label: 'A', effects: [effect] }],
        modeCount: { min: 1, max: 1 },
      } as TriggeredStackObject['ability'],
    });
    expect(canPrepareTrigger(room, object)).toBe(false);
    expect(availableTriggerModes(room, object)).toEqual([]);
    expect(triggerTargetGroups([])).toEqual([]);
  });
});

describe('trigger scheduling', () => {
  function triggerRoom(): GameRoom {
    const room = createTestRoom();
    room.battlefield = [creature('trigger-source', 'player1')];
    return room;
  }

  function triggered(overrides: Partial<TriggeredStackObject> = {}): TriggeredStackObject {
    return {
      uuid: 'trigger',
      type: 'triggered',
      controllerId: 'player1',
      source: creature('trigger-source', 'player1'),
      effects: [],
      countered: false,
      ...overrides,
    } as TriggeredStackObject;
  }

  function queue(entries: TriggerQueue['entries']): TriggerQueue {
    return { entries, resumePriority: 'player1' };
  }

  const entry = (object: TriggeredStackObject, selections: Record<string, unknown> = {}) => ({
    object,
    selections,
    ordered: false,
  });

  const requiredTarget = {
    action: 'MODIFY_STATS',
    params: { damage: 1 },
    targeting: { type: 'permanent', required: true, minTargets: 1, maxTargets: 1 },
  };

  it('does nothing without a queue and releases priority with an empty one', () => {
    const room = triggerRoom();
    expect(planTriggerScheduling(room)).toEqual({ mutations: [] });
    room.triggerQueue = queue([]);
    expect(planTriggerScheduling(room).mutations.map((mutation) => mutation.type)).toEqual([
      'SET_TRIGGER_QUEUE',
      'SET_PRIORITY',
      'SET_ENGINE_STATE',
      'SET_LAST_PASSED',
    ]);
  });

  it('drops triggers that can no longer be prepared', () => {
    const room = triggerRoom();
    room.battlefield = [];
    const bad = triggered({ uuid: 'bad', effects: [requiredTarget as unknown as StackEffect] });
    const good = triggered({ uuid: 'good' });
    room.triggerQueue = queue([entry(bad), entry(good)]);
    const result = planTriggerScheduling(room);
    expect(result.mutations).toEqual([
      { type: 'SET_TRIGGER_QUEUE', queue: queue([entry(good)]) },
    ]);
  });

  it('pushes a fully prepared trigger onto the stack', () => {
    const room = triggerRoom();
    room.triggerQueue = queue([entry(triggered())]);
    const result = planTriggerScheduling(room);
    expect(result.mutations.map((mutation) => mutation.type)).toEqual(['PUSH_STACK', 'SET_TRIGGER_QUEUE']);
  });

  it('drops a mode menu that cannot be completed', () => {
    const room = triggerRoom();
    const ability = {
      id: 'modal',
      type: 'triggered',
      triggerCondition: 'END_OF_TURN',
      castSpeed: 'instant',
      effect: { action: 'DRAW', params: { amount: 1 }, targeting: { type: 'self', required: false } },
      modes: [
        { id: 'same', label: 'A', effects: [] },
        { id: 'same', label: 'B', effects: [] },
      ],
      modeCount: { min: 1, max: 1 },
    };
    room.triggerQueue = queue([entry(triggered({ ability: ability as never }))]);
    expect(planTriggerScheduling(room).mutations).toEqual([
      { type: 'SET_TRIGGER_QUEUE', queue: queue([]) },
    ]);
  });

  it('drops selections that do not resolve to modes', () => {
    const room = triggerRoom();
    room.triggerQueue = queue([
      entry(triggered({ ability: { id: 'plain', type: 'triggered', triggerCondition: 'END_OF_TURN', castSpeed: 'instant' } as never }), {
        modes: ['bogus'],
      }),
    ]);
    expect(planTriggerScheduling(room).mutations).toEqual([
      { type: 'SET_TRIGGER_QUEUE', queue: queue([]) },
    ]);
  });

  it('offers optional and required target prompts with default bounds', () => {
    const room = triggerRoom();
    const ability = (targeting: Record<string, unknown>) => ({
      id: 'targeted',
      type: 'triggered',
      triggerCondition: 'END_OF_TURN',
      castSpeed: 'instant',
      effect: { action: 'MODIFY_STATS', params: { damage: 1 }, targeting },
    });
    room.triggerQueue = queue([entry(triggered({ ability: ability({ type: 'permanent', required: true }) as never }))]);
    const required = planTriggerScheduling(room);
    expect(required.choice).toMatchObject({ kind: 'targets', min: 1, max: 1 });

    room.triggerQueue = queue([entry(triggered({ ability: ability({ type: 'player', required: false }) as never }))]);
    const optional = planTriggerScheduling(room);
    expect(optional.choice).toMatchObject({ kind: 'targets', min: 0, max: 1 });
  });

  it('drops triggers whose supplied targets are illegal', () => {
    const room = triggerRoom();
    room.battlefield = [];
    room.triggerQueue = queue([
      entry(triggered({ ability: { id: 't', type: 'triggered', triggerCondition: 'END_OF_TURN', castSpeed: 'instant', effect: requiredTarget } as never }), {
        targetGroups: [{ id: 'effect-0', targets: [{ targetType: 'permanent', cardUuid: 'missing' }] }],
      }),
    ]);
    expect(planTriggerScheduling(room).mutations).toEqual([
      { type: 'SET_TRIGGER_QUEUE', queue: queue([]) },
    ]);
  });

  it('requests distributions with player and permanent labels', () => {
    const room = triggerRoom();
    const victim = creature('victim', 'player2');
    room.battlefield.push(victim);
    const effect = {
      action: 'MODIFY_STATS',
      params: { amount: 3 },
      choice: { kind: 'distribution', total: 3, field: 'amount' },
      targeting: { type: 'any', required: false, minTargets: 0, maxTargets: 4 },
    };
    const ability = { id: 'divided', type: 'triggered', triggerCondition: 'END_OF_TURN', castSpeed: 'instant', effect };
    room.triggerQueue = queue([
      entry(triggered({ ability: ability as never }), {
        targetGroups: [
          {
            id: 'effect-0',
            targets: [
              { targetType: 'player', playerId: 'player2' },
              { targetType: 'permanent', cardUuid: 'victim' },
            ],
          },
        ],
      }),
    ]);
    const result = planTriggerScheduling(room);
    expect(result.choice?.kind).toBe('distribution');
    expect(result.choice?.kind === 'distribution' && result.choice.options.map((option) => option.label)).toEqual([
      'player2',
      'victim',
    ]);
  });

  it('drops triggers whose targets cannot be completed', () => {
    const room = triggerRoom();
    const ability = {
      id: 'twin',
      type: 'triggered',
      triggerCondition: 'END_OF_TURN',
      castSpeed: 'instant',
      effect: { action: 'MODIFY_STATS', params: { damage: 1 }, targeting: { type: 'permanent', required: true, minTargets: 2, maxTargets: 2 } },
    };
    room.triggerQueue = queue([entry(triggered({ ability: ability as never }))]);
    expect(planTriggerScheduling(room).mutations).toEqual([
      { type: 'SET_TRIGGER_QUEUE', queue: queue([]) },
    ]);
  });

  it('drops an impossible distribution', () => {
    const room = triggerRoom();
    const effect = {
      action: 'MODIFY_STATS',
      params: { amount: 1 },
      choice: { kind: 'distribution', total: 1, field: 'amount' },
      targeting: { type: 'player', required: false, minTargets: 0, maxTargets: 1 },
    };
    const ability = { id: 'divided', type: 'triggered', triggerCondition: 'END_OF_TURN', castSpeed: 'instant', effect };
    room.triggerQueue = queue([
      entry(triggered({ ability: ability as never }), { targetGroups: [{ id: 'effect-0', targets: [] }] }),
    ]);
    expect(planTriggerScheduling(room).mutations).toEqual([
      { type: 'SET_TRIGGER_QUEUE', queue: queue([]) },
    ]);

    room.triggerQueue = queue([
      entry(triggered({ ability: ability as never }), {
        targetGroups: [{ id: 'effect-0', targets: [{ targetType: 'player', playerId: 'player2' }] }],
        distributions: { 'effect-0': 'bad' },
      }),
    ]);
    expect(planTriggerScheduling(room).mutations).toEqual([
      { type: 'SET_TRIGGER_QUEUE', queue: queue([]) },
    ]);
  });

  it('folds answers back into the queue', () => {
    const room = triggerRoom();
    const first = triggered({ uuid: 'first' });
    const second = triggered({ uuid: 'second' });
    room.triggerQueue = queue([entry(first), entry(second)]);
    const continuation = (field: string, extra: Record<string, unknown> = {}) => ({
      type: 'trigger',
      field,
      triggerUuid: 'first',
      ...extra,
    });
    const choice = (field: string, extra: Record<string, unknown> = {}) =>
      ({ kind: 'options', id: 'c', playerId: 'player1', prompt: '', min: 1, max: 1, options: [], continuation: continuation(field, extra) }) as never;
    expect(applyTriggerChoice(room, choice('modes') as never, { values: ['a'] })).toMatchObject({
      entries: [{ selections: { modes: ['a'] } }, {}],
    });
    expect(applyTriggerChoice(room, choice('order') as never, { values: ['second'] })).toMatchObject({
      entries: [{ object: { uuid: 'second' }, ordered: true }, { object: { uuid: 'first' } }],
    });
    expect(
      applyTriggerChoice(room, choice('targetGroups', { groupId: 'effect-0' }) as never, {
        values: [{ targetType: 'player', playerId: 'player2' }],
      }),
    ).toMatchObject({ entries: [{ selections: { targetGroups: [{ id: 'effect-0' }] } }, {}] });
    expect(
      applyTriggerChoice(room, choice('distributions', { groupId: 'effect-0' }) as never, { values: [], allocations: { a: 2 } }),
    ).toMatchObject({ entries: [{ selections: { distributions: { 'effect-0': { a: 2 } } } }, {}] });
    expect(() => applyTriggerChoice(room, { kind: 'options', continuation: { type: 'action' } } as never, { values: [] })).toThrow(
      /Expected trigger scheduling choice/,
    );
    expect(() => applyTriggerChoice({ ...room, triggerQueue: undefined }, choice('modes') as never, { values: [] })).toThrow(
      /Expected trigger scheduling choice/,
    );
  });
});

describe('resolution payments', () => {
  function paymentRoom(): GameRoom {
    const room = createTestRoom();
    room.battlefield = [creature('pay-source', 'player1')];
    room.players.player1.hand = [creature('hand-a', 'player1'), creature('hand-b', 'player1')];
    for (const card of room.players.player1.hand) card.state = { ...card.state, zone: 'hand' };
    return room;
  }

  function stack(room: GameRoom, params: Record<string, unknown>): StackObject {
    return {
      uuid: 'pay-stack',
      type: 'spell',
      controllerId: 'player1',
      source: room.battlefield[0],
      effects: [{ action: 'PAY_COST', params, tags: [], targets: [] }],
      countered: false,
    } as StackObject;
  }

  const saved = (object: StackObject, overrides: Partial<PaymentContinuation> = {}): PaymentContinuation => ({
    type: 'resolution',
    stackObj: object,
    effectIndex: 0,
    results: [],
    paymentStage: 'confirm',
    paymentData: {},
    ...overrides,
  });

  it('offers and settles a payable confirmation', () => {
    const room = paymentRoom();
    const object = { ...stack(room, { cost: { life: 1 }, then: [{ action: 'DRAW', params: { amount: 1 }, targeting: { type: 'self', required: false } }] }), numericBindings: { x: 1 } } as StackObject;
    const offer = offerResolutionPayment(room, object, 0, []);
    expect(offer.success && 'pendingChoice' in offer && offer.pendingChoice.kind).toBe('optional');
    if (!offer.success || !('pendingChoice' in offer)) throw new Error('expected a prompt');
    const paid = answerResolutionPayment(room, offer.pendingChoice.continuation as PaymentContinuation, { values: [true] });
    expect(paid.success).toBe(true);
    expect(paid.success && 'mutations' in paid && paid.mutations.some((mutation) => mutation.type === 'SET_LIFE')).toBe(true);
    expect(paid.success && 'continuation' in paid && paid.continuation.stackObj.effects[0]?.instructionId).toBe('0:paid:0');
  });

  it('declines or cancels without paying', () => {
    const room = paymentRoom();
    const object = stack(room, { cost: { life: 1 }, then: [] });
    const offer = offerResolutionPayment(room, object, 0, []);
    if (!offer.success || !('pendingChoice' in offer)) throw new Error('expected a prompt');
    const continuation = offer.pendingChoice.continuation as PaymentContinuation;
    expect(answerResolutionPayment(room, continuation, { values: [false] })).toMatchObject({ success: true });
    expect(answerResolutionPayment(room, continuation, undefined, true)).toMatchObject({ success: true });
  });

  it('settles a paid cost that requires a discard selection', () => {
    const room = paymentRoom();
    const object = stack(room, { cost: { discard: 1 }, then: [] });
    const offer = offerResolutionPayment(room, object, 0, []);
    if (!offer.success || !('pendingChoice' in offer)) throw new Error('expected a prompt');
    const confirmed = answerResolutionPayment(room, offer.pendingChoice.continuation as PaymentContinuation, { values: [true] });
    if (!confirmed.success || !('pendingChoice' in confirmed)) throw new Error('expected a discard prompt');
    expect(confirmed.pendingChoice.kind).toBe('discard');
    const discarded = answerResolutionPayment(room, confirmed.pendingChoice.continuation as PaymentContinuation, {
      values: ['hand-a'],
    });
    expect(discarded.success).toBe(true);
    expect(discarded.success && 'mutations' in discarded && discarded.mutations.some((mutation) => mutation.type === 'MOVE_CARD')).toBe(true);
  });

  it('routes a payment through a bogus mana payment selection', () => {
    const room = paymentRoom();
    room.players.player1.mana = { red: 1, green: 0, blue: 0, white: 0, yellow: 0, black: 0 };
    const object = stack(room, { cost: { mana: { red: 1 } }, then: [] });
    const offer = offerResolutionPayment(room, object, 0, []);
    if (!offer.success || !('pendingChoice' in offer)) throw new Error('expected a prompt');
    const continuation = {
      ...(offer.pendingChoice.continuation as PaymentContinuation),
      paymentData: { payment: {} },
    } as PaymentContinuation;
    expect(answerResolutionPayment(room, continuation, { values: [true] })).toMatchObject({
      success: false,
      reason: 'Invalid mana payment',
    });
  });

  it('applies a nested mana ability answer and reports preparation failures', () => {
    const room = paymentRoom();
    const object = stack(room, { cost: { life: 1 }, then: [] });
    const continuation = saved(object, {
      paymentStage: 'mana_ability',
      manaActivationIndex: 0,
      manaChoice: { type: 'action', actionId: 'tapForMana', data: { cardUuid: 'missing' }, field: 'discardUuids' } as never,
      paymentData: { manaActivations: [{ cardUuid: 'missing' }, { cardUuid: 'missing-2' }] },
    });
    expect(answerResolutionPayment(room, continuation, { values: ['hand-a'] })).toMatchObject({
      success: false,
      reason: 'Card not found on your battlefield',
    });
  });

  it('rejects collections of mana activations that are not a list', () => {
    const room = paymentRoom();
    const object = stack(room, { cost: { life: 1 }, then: [] });
    const continuation = saved(object, { paymentData: { manaActivations: 'nope' as never } });
    expect(answerResolutionPayment(room, continuation, { values: [true] })).toMatchObject({
      success: false,
      reason: 'Too many mana activations in one payment',
    });
  });
});

describe('mutation committer', () => {
  function committer(room: GameRoom, collector: GameMutation[] = []) {
    return new MutationCommitter(room, new EventBus(room.roomId), collector, () => 'generated-id', () => undefined);
  }

  it('honours an already finished game without applying mutations', () => {
    const room = createTestRoom();
    room.status = 'gameOver';
    const subject = committer(room);
    expect(subject.commit([{ type: 'SET_LIFE', playerId: 'player1', amount: 5 }], { kind: 'command' })).toEqual([]);
    expect(subject.roomState.players.player1.life).toBe(20);
  });

  it('parks a state-based replacement decision', () => {
    const room = createTestRoom();
    const victim = creature('victim', 'player1');
    victim.state.damageTaken = 9;
    room.battlefield = [victim];
    room.replacementEffects = [
      { id: 'protect-a', label: 'Protect A', match: { kinds: ['destroy'] }, operation: { type: 'cancel_event' } },
      { id: 'protect-b', label: 'Protect B', match: { kinds: ['destroy'] }, operation: { type: 'cancel_event' } },
    ] as ReplacementDefinition[];
    const subject = committer(room);
    subject.commit([{ type: 'DESTROY_CARD', cardUuid: victim.uuid, zoneRevision: 0 }], { kind: 'state-based-action' });
    expect(subject.roomState.engineState).toBe('state_based_actions');
    expect(subject.roomState.pendingChoice).toBeTruthy();
  });

  it('retains departing battlefield sources and ignores vanished cards', () => {
    const room = createTestRoom();
    const departing = creature('departing', 'player1');
    room.battlefield = [departing];
    const collector: GameMutation[] = [
      {
        type: 'PUSH_STACK',
        stackObject: {
          uuid: 'pending',
          type: 'triggered',
          controllerId: 'player1',
          source: { ...departing },
          effects: [],
          countered: false,
        } as StackObject,
      } as GameMutation,
    ];
    const subject = committer(room, collector);
    const applied = subject.commit(
      [{ type: 'MOVE_CARD', cardUuid: departing.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' }],
      { kind: 'command' },
    );
    const pending = collector.find((mutation) => mutation.type === 'PUSH_STACK');
    expect(pending && pending.type === 'PUSH_STACK' && pending.stackObject.sourceInfo).toBeTruthy();
    expect(applied.length).toBeGreaterThanOrEqual(1);

    const stale = committer(createTestRoom());
    expect(
      stale.commit(
        [{ type: 'MOVE_CARD', cardUuid: 'not-on-board', playerId: 'player1', from: 'battlefield', to: 'graveyard' }],
        { kind: 'command' },
      ),
    ).toEqual([]);
  });

  it('prefers an attached source snapshot over recapturing the departing card', () => {
    const room = createTestRoom();
    const departing = creature('snapshotted', 'player1');
    room.battlefield = [departing];
    const collector: GameMutation[] = [
      {
        type: 'PUSH_STACK',
        stackObject: {
          uuid: 'pending-snapshot',
          type: 'triggered',
          controllerId: 'player1',
          source: { ...departing },
          effects: [],
          countered: false,
        } as StackObject,
      } as GameMutation,
    ];
    const subject = committer(room, collector);
    subject.commit(
      [{
        type: 'MOVE_CARD', cardUuid: departing.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard',
        sourceSnapshot: captureSourceInformation(room, departing),
      }],
      { kind: 'command' },
    );
    const pending = collector.find((mutation) => mutation.type === 'PUSH_STACK');
    expect(pending && pending.type === 'PUSH_STACK' && pending.stackObject.sourceInfo).toBeTruthy();
  });

  it('recaptures a departing source when the prepared batch omits its snapshot', () => {
    const room = createTestRoom();
    const departing = creature('prepared', 'player1');
    room.battlefield = [departing];
    const collector: GameMutation[] = [
      {
        type: 'PUSH_STACK',
        stackObject: {
          uuid: 'prepared-pending',
          type: 'triggered',
          controllerId: 'player1',
          source: { ...departing },
          effects: [],
          countered: false,
        } as StackObject,
      } as GameMutation,
    ];
    const subject = committer(room, collector);
    (subject as unknown as { commitPreparedMutations(value: unknown, cause: unknown): unknown })
      .commitPreparedMutations(
        [{ type: 'MOVE_CARD', cardUuid: departing.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' }],
        { kind: 'command' },
      );
    const pending = collector.find((mutation) => mutation.type === 'PUSH_STACK');
    expect(pending && pending.type === 'PUSH_STACK' && pending.stackObject.sourceInfo).toBeTruthy();
  });

  it('rebuilds turn history when a batch replaces it and records uses without one', () => {
    const room = createTestRoom();
    room.turnNumber = undefined;
    room.turnHistory = newTurnHistory(9);
    const subject = committer(room);
    subject.commit([{ type: 'SET_TURN_HISTORY', history: undefined as never }], { kind: 'command' });
    expect(subject.roomState.turnHistory).toBeUndefined();
    const applied = subject.drainEventBatches();
    expect(applied).toHaveLength(1);
  });
});

it('leaves resolution bookkeeping untouched when a resolution carries no mutations', () => {
  const engine = new GameEngine(createTestRoom());
  engine.initRoom();
  engines.push(engine);
  const before = structuredClone(engine.roomState);
  const result = (engine as unknown as { commitResolution(value: unknown): unknown }).commitResolution({ success: true });
  expect(result).toMatchObject({ success: true });
  expect(engine.roomState.stack).toEqual(before.stack);
  expect(engine.roomState.pendingChoice).toEqual(before.pendingChoice);
});
