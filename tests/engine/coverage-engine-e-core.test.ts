import { describe, expect, it, vi } from 'vitest';
import type {
  ActivatedAbility,
  CardAbility,
  CardBlueprint,
  CardInstance,
  CardState,
  CardZone,
  TriggerFilter,
  TriggeredAbility,
} from '@shared/card.types';
import type { CardSnapshot } from '@shared/card.types';
import type { GameRoom } from '@shared/game.room.types';
import type { StackObject, TriggeringEvent } from '@shared/effect.types';
import type { GameMutation } from '@shared/game-mutation.types';
import type { GameEvent } from '@shared/game-event.types';
import type { KillOutcome } from '@shared/change-cause.types';
import { createTestRoom } from '../helpers/test-room-factory';
import { abilityUseKey, emptyEventCounts, HISTORY_EVENTS, newTurnHistory, recordRuleEvent } from '@engine/turn-history';
import { abilityLimitReached } from '@engine/turn-history';
import { isManaAbility, manaAbilities, manaOutput } from '@engine/mana-abilities';
import { immediateAction, isImmediateAction } from '@engine/mechanics/immediate-actions';
import { resolveStackHandler } from '@engine/handlers/resolve-stack-handler';
import { runRulesCheckpoint } from '@engine/rules-checkpoint';
import { ActionService } from '@engine/action-service';
import { ActionRegistry } from '@engine/action-registry';
import { EventBus } from '@engine/event-bus';
import { triggerMatches } from '@engine/trigger-matching';
import { print } from 'node:util';

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
    isToken?: boolean;
  } = {},
): CardInstance {
  const zone = options.zone ?? 'battlefield';
  const controllerId = options.controllerId ?? 'player1';
  uuid += 1;
  return {
    uuid: `card-${uuid}`,
    isToken: options.isToken,
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

const damageEffect = (amount = 1) => ({
  action: 'MODIFY_LIFE',
  params: { amount },
  tags: [],
  targeting: { type: 'self' as const, required: false },
});

const manaAbility = (overrides: Partial<ActivatedAbility> = {}): ActivatedAbility => ({
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
} as ActivatedAbility);

const triggeredAbility = (overrides: Partial<TriggeredAbility> = {}): TriggeredAbility => ({
  id: 'triggered',
  type: 'triggered',
  castSpeed: 'instant',
  triggerCondition: 'ON_DIE',
  effect: damageEffect(),
  ...overrides,
} as TriggeredAbility);

describe('turn history', () => {
  it('tracks every rules-relevant event id', () => {
    expect(HISTORY_EVENTS).toContain('PERMANENT_ENTERED');
    expect(Object.keys(emptyEventCounts())).toEqual([...HISTORY_EVENTS]);
    expect(Object.values(emptyEventCounts()).every((count) => count === 0)).toBe(true);

    const history = newTurnHistory(3);
    expect(history).toMatchObject({ turnNumber: 3, events: [], playerCounts: {}, uses: {}, landPlays: {} });
    expect(history.counts.PERMANENT_ENTERED).toBe(0);
  });

  it('attributes an event to its controller, player or current player', () => {
    const base = newTurnHistory(1);
    const byController = recordRuleEvent(base, { eventId: 'PERMANENT_ENTERED', payload: { controllerId: 'player1' } });
    expect(byController.playerCounts.player1.PERMANENT_ENTERED).toBe(1);
    expect(byController.counts.PERMANENT_ENTERED).toBe(1);

    const twice = recordRuleEvent(byController, { eventId: 'PERMANENT_ENTERED', payload: { controllerId: 'player1' } });
    expect(twice.playerCounts.player1.PERMANENT_ENTERED).toBe(2);
    expect(twice.counts.PERMANENT_ENTERED).toBe(2);

    const byPlayer = recordRuleEvent(base, { eventId: 'CARD_DRAWN', payload: { playerId: 'player2' } });
    expect(byPlayer.playerCounts.player2.CARD_DRAWN).toBe(1);

    const byCurrent = recordRuleEvent(base, { eventId: 'LIFE_LOST', payload: { currentPlayer: 'player2' } });
    expect(byCurrent.playerCounts.player2.LIFE_LOST).toBe(1);
  });

  it('records no player when the payload names none', () => {
    const base = newTurnHistory(1);
    const anonymous = recordRuleEvent(base, { eventId: 'DAMAGE_TAKEN', payload: {} });
    expect(anonymous.playerCounts).toEqual({});

    const numeric = recordRuleEvent(base, { eventId: 'LIFE_GAINED', payload: { controllerId: 7 } });
    expect(numeric.playerCounts).toEqual({});
  });

  it('credits each distinct killer once for a creature kill', () => {
    const killed = recordRuleEvent(newTurnHistory(1), {
      eventId: 'CREATURE_KILLED',
      payload: {
        outcome: {
          victim: { cardUuid: 'x', zoneRevision: 0 },
          reason: 'lethal',
          causes: [{ controllerId: 'player1' }, { controllerId: 'player1' }, {}],
        } satisfies KillOutcome,
      },
    });
    expect(killed.playerCounts.player1.CREATURE_KILLED).toBe(1);
    expect(killed.counts.CREATURE_KILLED).toBe(1);
  });

  it('ignores events that the history does not track', () => {
    const base = newTurnHistory(1);
    expect(recordRuleEvent(base, { eventId: 'MUTATION_APPLIED', payload: { controllerId: 'player1' } })).toBe(base);
  });

  it('reports an exhausted ability budget as reached', () => {
    const room = roomWith({ turnHistory: newTurnHistory(1) });
    const card = makeCard();
    const ability = triggeredAbility({ limitPerTurn: 1 });
    expect(abilityLimitReached(room, card, ability)).toBe(false);

    const used: GameRoom = {
      ...room,
      turnHistory: { ...newTurnHistory(1), uses: { [abilityUseKey(card, 'triggered')]: 1 } },
    };
    expect(abilityLimitReached(used, card, ability)).toBe(true);
  });
});

describe('mana abilities', () => {
  it('recognizes only simple activated mana production', () => {
    expect(isManaAbility(manaAbility())).toBe(true);

    const noEffect = { ...manaAbility(), effect: undefined, effects: [] } as unknown as ActivatedAbility;
    expect(isManaAbility(noEffect)).toBe(false);
    expect(isManaAbility(manaAbility({ type: 'triggered' } as unknown as Partial<ActivatedAbility>))).toBe(false);
    expect(
      isManaAbility(manaAbility({ effect: { ...manaAbility().effect!, action: 'DRAW' } })),
    ).toBe(false);
    expect(
      isManaAbility(manaAbility({ effect: { ...manaAbility().effect!, targeting: { type: 'permanent', required: false } } })),
    ).toBe(false);
    expect(
      isManaAbility(manaAbility({ effect: { ...manaAbility().effect!, targeting: { type: 'self', required: true } } })),
    ).toBe(false);
    expect(
      isManaAbility(manaAbility({ effect: { ...manaAbility().effect!, targeting: { type: 'self', required: false, all: true } } })),
    ).toBe(false);
    expect(isManaAbility(manaAbility({ cost: { tap: true, loyalty: 1 } }))).toBe(false);
  });

  it('lists mana abilities with their index, preferring live characteristics', () => {
    const card = makeCard({ blueprint: { abilities: [triggeredAbility(), manaAbility()] } });
    const withoutRoom = manaAbilities(card);
    expect(withoutRoom.map((entry) => entry.abilityIndex)).toEqual([1]);

    const room = roomWith({ battlefield: [card] });
    expect(manaAbilities(card, room).map((entry) => entry.ability.id)).toEqual(['mana']);
  });

  it('falls back to the plain-land ability only when no ability is defined', () => {
    const blankLand = makeCard({ blueprint: { cardTypes: ['Land'], abilities: [] } });
    expect(manaAbilities(blankLand)).toHaveLength(1);
    expect(manaAbilities(blankLand)[0].ability.id).toBe('produce-yellow');

    const definedLand = makeCard({ blueprint: { cardTypes: ['Land'], abilities: [triggeredAbility()] } });
    expect(manaAbilities(definedLand)).toEqual([]);
  });

  it('reads the colours and amount an activated ability produces', () => {
    expect(manaOutput(manaAbility())).toEqual({ colors: ['red'], amount: 1 });

    const noEffect = { ...manaAbility(), effect: undefined } as unknown as ActivatedAbility;
    expect(manaOutput(noEffect)).toBeUndefined();

    const colorsForm = manaAbility({
      effect: { ...manaAbility().effect!, params: { colors: ['red', 'red', 'blue'], amount: 2 } },
    });
    expect(manaOutput(colorsForm)).toEqual({ colors: ['red', 'blue'], amount: 2 });

    const defaultAmount = manaAbility({ effect: { ...manaAbility().effect!, params: { color: 'blue' } } });
    expect(manaOutput(defaultAmount)).toEqual({ colors: ['blue'], amount: 1 });
  });

  it('rejects malformed mana output', () => {
    const malformed = (params: Record<string, unknown>) =>
      manaOutput(manaAbility({ effect: { ...manaAbility().effect!, params } }));

    expect(malformed({ colors: 'red', amount: 1 })).toBeUndefined();
    expect(malformed({ colors: [], amount: 1 })).toBeUndefined();
    expect(malformed({ colors: ['purple'], amount: 1 })).toBeUndefined();
    expect(malformed({ color: 'red', amount: 1.5 })).toBeUndefined();
    expect(malformed({ color: 'red', amount: 0 })).toBeUndefined();
  });
});

describe('immediate actions', () => {
  it('honours an explicit immediate flag on a non-spell object', () => {
    const room = roomWith();
    const source = makeCard();
    const object = {
      uuid: 'ability',
      type: 'triggered',
      controllerId: 'player1',
      source,
      ability: triggeredAbility({ immediate: true }),
      effects: [],
      countered: false,
    } as StackObject;
    expect(isImmediateAction(room, object)).toBe(true);
    expect(immediateAction(room, object)).toEqual({ ...object, immediate: true });
  });

  it('does not grant immediate to an ordinary non-spell ability', () => {
    const source = makeCard();
    const room = roomWith({ battlefield: [source] });
    const object = {
      uuid: 'ability',
      type: 'triggered',
      controllerId: 'player1',
      source,
      ability: triggeredAbility(),
      effects: [],
      countered: false,
    } as StackObject;
    expect(isImmediateAction(room, object)).toBe(false);
  });

  it('grants a spell immediate when its controller has an immediate-granting permanent', () => {
    const source = makeCard({ zone: 'stack', blueprint: { cardTypes: ['Creature'] } });
    const granter = makeCard({ blueprint: { keywords: ['ImmediateFriendlyCreatures'] } });
    const otherGranter = makeCard({ controllerId: 'player2', blueprint: { keywords: ['ImmediateFriendlyCreatures'] } });
    const object = {
      uuid: 'spell',
      type: 'spell',
      controllerId: 'player1',
      source,
      effects: [],
      countered: false,
    } as StackObject;

    expect(isImmediateAction(roomWith({ stack: [object], battlefield: [granter] }), object)).toBe(true);
    expect(isImmediateAction(roomWith({ stack: [object], battlefield: [otherGranter] }), object)).toBe(false);

    const nonCreature = makeCard({ zone: 'stack', blueprint: { cardTypes: ['Spell'] } });
    const spellObject = { ...object, source: nonCreature } as StackObject;
    expect(isImmediateAction(roomWith({ stack: [spellObject], battlefield: [granter] }), spellObject)).toBe(false);
  });

  it('prefers the live hand copy of a resolving spell', () => {
    const stackCopy = makeCard({ zone: 'stack' });
    const handCopy = { ...stackCopy, state: { ...stackCopy.state, zone: 'hand' as const } };
    const room = roomWith();
    room.players.player1.hand.push(handCopy);
    const object = {
      uuid: 'spell',
      type: 'spell',
      controllerId: 'player1',
      source: stackCopy,
      effects: [],
      countered: false,
    } as StackObject;

    expect(immediateAction(room, object).source).toBe(handCopy);

    room.players.player1.hand.length = 0;
    expect(immediateAction(room, object).source).toBe(stackCopy);
  });
});

describe('resolve stack handler', () => {
  it('rejects an empty stack and accepts a non-empty one', () => {
    const room = roomWith();
    expect(resolveStackHandler.validate(room, 'player1', {})).toEqual({
      success: false,
      phase: 'validate',
      reason: 'Stack is empty!',
    });

    const nonEmpty = roomWith({
      stack: [{
        uuid: 's',
        type: 'activated',
        controllerId: 'player1',
        source: makeCard(),
        ability: manaAbility(),
        effects: [],
        countered: false,
      }],
    });
    expect(resolveStackHandler.validate(nonEmpty, 'player1', {})).toEqual({ success: true });
    expect(resolveStackHandler.propose(nonEmpty, 'player1', {})).toEqual({ success: true });
    expect(resolveStackHandler.resolve!(nonEmpty, nonEmpty.stack[0])).toEqual({ success: true });
  });
});

describe('rules checkpoint', () => {
  const terminal = () => roomWith({ status: 'gameOver' });

  it('suspends while a choice is pending', () => {
    const room = roomWith({ pendingChoice: { id: 'c', playerId: 'player1', kind: 'number', prompt: '', range: { min: 0 }, continuation: { type: 'action', actionId: 'a', data: {}, field: 'payment' } } });
    const boundary = {
      getRoom: () => room,
      apply: vi.fn(() => [] as GameMutation[]),
      takePending: vi.fn(() => [] as GameMutation[]),
    };
    expect(runRulesCheckpoint(boundary)).toEqual([]);
    expect(boundary.takePending).not.toHaveBeenCalled();
  });

  it('discards queued work once the game is over', () => {
    const takePending = vi.fn(() => [] as GameMutation[]);
    expect(runRulesCheckpoint({ getRoom: terminal, apply: vi.fn(() => []), takePending })).toEqual([]);
    expect(takePending).toHaveBeenCalledTimes(1);

    const outcomeRoom = roomWith({ outcome: { type: 'win', winnerId: 'player1', losses: [] } });
    expect(
      runRulesCheckpoint({ getRoom: () => outcomeRoom, apply: vi.fn(() => []), takePending: vi.fn(() => []) }),
    ).toEqual([]);
  });

  it('applies state-based actions before draining queued work', () => {
    let room = roomWith();
    room.players.player1.life = 0;
    const applied: GameMutation[][] = [];
    const changes: GameMutation[] = [{ type: 'SET_LIFE', playerId: 'player1', amount: 20 }];
    const boundary = {
      getRoom: () => room,
      apply: vi.fn((mutations: GameMutation[]) => {
        applied.push(mutations);
        room = { ...room, players: { ...room.players, player1: { ...room.players.player1, life: 20 } } };
        return changes;
      }),
      takePending: () => [],
    };

    const result = runRulesCheckpoint(boundary);
    expect(result).toEqual(changes);
    expect(applied[0][0]).toMatchObject({ type: 'END_GAME' });
  });

  it('drains queued work before asking for newly discovered triggers', () => {
    let room = roomWith();
    const pending: GameMutation[] = [{ type: 'SET_PHASE', phase: 'upkeepStep' }];
    const calls: GameMutation[][] = [];
    let took = false;
    const schedule = vi.fn(() => [] as GameMutation[]);

    const result = runRulesCheckpoint({
      getRoom: () => room,
      apply: (mutations) => {
        calls.push(mutations);
        return mutations;
      },
      takePending: () => {
        if (took) return [];
        took = true;
        room = { ...room, phase: 'stateMainPhase' };
        return pending;
      },
      schedule,
    });

    expect(result).toEqual(pending);
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it('keeps working through newly scheduled triggers', () => {
    const scheduled: GameMutation[] = [{ type: 'SET_PHASE', phase: 'upkeepStep' }];
    let scheduledOnce = false;
    const result = runRulesCheckpoint({
      getRoom: () => roomWith(),
      apply: (mutations) => mutations,
      takePending: () => [],
      schedule: () => {
        if (scheduledOnce) return [];
        scheduledOnce = true;
        return scheduled;
      },
    });
    expect(result).toEqual(scheduled);
  });

  it('settles without a schedule hook and with no queued work', () => {
    const result = runRulesCheckpoint({ getRoom: () => roomWith(), apply: () => [], takePending: () => [] });
    expect(result).toEqual([]);
  });

  it('refuses state-based actions that make no progress', () => {
    expect(() =>
      runRulesCheckpoint({ getRoom: () => roomWith({ outcome: undefined, players: { ...roomWith().players, player1: { ...roomWith().players.player1, life: 0 } } }), apply: () => [], takePending: () => [] }),
    ).toThrow('State-based actions made no progress');
  });

  it('passes the pending mutations into the state-based check', () => {
    const getPending = vi.fn(() => [{ type: 'SET_PHASE', phase: 'upkeepStep' }] as GameMutation[]);
    const result = runRulesCheckpoint({
      getRoom: () => roomWith(),
      apply: () => [],
      takePending: () => [],
      getPending,
    });
    expect(result).toEqual([]);
    expect(getPending).toHaveBeenCalled();
  });
});

describe('action service', () => {
  const handler = (validateSuccess: boolean, proposeSuccess: boolean) => ({
    validate: () => (validateSuccess ? { success: true as const } : { success: false as const, phase: 'validate' as const, reason: 'invalid' }),
    propose: () => (proposeSuccess ? { success: true as const, mutations: [] } : { success: false as const, phase: 'propose' as const, reason: 'cannot propose' }),
  });

  it('initializes the trigger manager once and tears it down once', () => {
    const bus = new EventBus('room');
    const collector: GameMutation[] = [];
    const service = new ActionService(bus, collector, () => 'uuid');
    const room = roomWith();

    service.initRoom(() => room);
    service.initRoom(() => room);
    expect((service as unknown as { triggerManager: unknown }).triggerManager).not.toBeNull();

    service.destroyRoom();
    expect((service as unknown as { triggerManager: unknown }).triggerManager).toBeNull();
    expect(collector).toEqual([]);

    // A destroyed service cannot be re-initialized.
    service.initRoom(() => room);
    expect((service as unknown as { triggerManager: unknown }).triggerManager).toBeNull();
  });

  it('tears down without a trigger manager', () => {
    const collector: GameMutation[] = [{ type: 'SET_PHASE', phase: 'upkeepStep' }];
    const service = new ActionService(new EventBus('room'), collector, () => 'uuid', undefined, new ActionRegistry());
    service.destroyRoom();
    expect(collector).toEqual([]);
  });

  it('routes known actions through validate then propose', () => {
    const service = new ActionService(
      new EventBus('room'),
      [],
      () => 'uuid',
      undefined,
      new ActionRegistry({ ok: handler(true, true), invalid: handler(false, true), blocked: handler(true, false) }),
    );
    const room = roomWith();

    expect(service.handleAction(room, 'player1', 'ok', {})).toEqual({ success: true, mutations: [] });
    expect(service.handleAction(room, 'player1', 'invalid', {})).toMatchObject({ success: false, phase: 'validate' });
    expect(service.handleAction(room, 'player1', 'blocked', {})).toMatchObject({ success: false, phase: 'propose' });
    expect(service.handleAction(room, 'player1', 'missing', {})).toMatchObject({ success: false, phase: 'validate' });
  });

  it('proposes and stacks only successful actions', () => {
    const service = new ActionService(
      new EventBus('room'),
      [],
      () => 'uuid',
      undefined,
      new ActionRegistry({ ok: handler(true, true), blocked: handler(true, false) }),
    );
    const room = roomWith();
    expect(service.proposeAndStack(room, 'player1', 'ok', {})).toEqual({ success: true, mutations: [] });
    expect(service.proposeAndStack(room, 'player1', 'blocked', {})).toMatchObject({ success: false });
  });

  it('plans the top of an empty stack as a failure', () => {
    const service = new ActionService(new EventBus('room'), [], () => 'uuid');
    expect(service.resolveTopOfStack(roomWith())).toEqual({
      success: false,
      phase: 'resolve',
      reason: 'Stack is empty',
    });
  });

  it('plans the resolution of the top stack object', () => {
    const source = makeCard();
    const card = makeCard();
    const room = roomWith({
      stack: [{
        uuid: 'top',
        type: 'activated',
        controllerId: 'player1',
        source: card,
        ability: manaAbility(),
        effects: [],
        countered: false,
      }],
      battlefield: [source],
    });
    const service = new ActionService(new EventBus('room'), [], () => 'uuid');
    const result = service.resolveTopOfStack(room);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Array.isArray(result.mutations)).toBe(true);
      expect(result.resolution?.stackObj.uuid).toBe('top');
    }
  });
});

describe('trigger matching', () => {
  const source = (overrides: Partial<CardInstance> = {}, state: Partial<CardState> = {}) => {
    const card = makeCard({ blueprint: { subTypes: ['Servant'] }, ...overrides });
    card.state = { ...card.state, ...state };
    return card;
  };
  const event = (eventId: string, payload: Record<string, unknown> = {}, cause?: GameEvent['cause']): GameEvent => ({
    eventId,
    roomId: 'room',
    payload,
    ...(cause ? { cause } : {}),
  });
  const snapshotOf = (card: CardInstance): CardSnapshot => ({ card, power: 1, toughness: 1 });

  it('matches an event card by identity', () => {
    const card = source();
    expect(triggerMatches(event('PERMANENT_ENTERED', { card }), card)).toBe(true);
    expect(triggerMatches(event('PERMANENT_ENTERED', { card: source() }), card)).toBe(false);
  });

  it('prefers recorded characteristics for an explicit subject snapshot', () => {
    const card = source();
    const subject = {
      ...snapshotOf(card),
      card: {
        ...card,
        lastKnownCharacteristics: {
          cardTypes: ['Land'],
          subTypes: ['Shrine'],
          controllerId: 'player1',
          name: 'Recorded',
          abilities: [],
          keywords: [],
          colors: [],
          power: 1,
          toughness: 1,
          superTypes: [],
          castRequirements: { allowedZones: [], speed: 'instant' as const },
          rulesText: '',
          id: 'recorded',
        },
      },
    };
    expect(triggerMatches(event('PERMANENT_ENTERED', { card }), card, { cardTypes: ['Land'] }, 'player1', undefined, subject)).toBe(true);
    expect(triggerMatches(event('PERMANENT_ENTERED', { card }), card, { subTypes: ['Shrine'] }, 'player1', undefined, subject)).toBe(true);
    expect(triggerMatches(event('PERMANENT_ENTERED', { card }), card, { subTypes: ['Servant'] }, 'player1', undefined, subject)).toBe(false);
  });

  it('uses the blueprint when a subject snapshot carries no recorded characteristics', () => {
    const card = source();
    expect(triggerMatches(event('PERMANENT_ENTERED', { card }), card, { cardTypes: ['Creature'] }, 'player1', undefined, snapshotOf(card))).toBe(true);
    expect(triggerMatches(event('PERMANENT_ENTERED', { card }), card, { subTypes: ['Servant'] }, 'player1', undefined, snapshotOf(card))).toBe(true);
  });

  it('treats a missing cause and missing zone revision conservatively', () => {
    const sourceless = makeCard({ state: { zoneRevision: undefined } });
    const causeWithoutSource = { id: 'c', rootId: 'c', kind: 'effect' as const };
    expect(triggerMatches(event('DAMAGE_TAKEN', { controllerId: 'player1' }, causeWithoutSource), sourceless, { cause: 'self' })).toBe(false);

    const matching = makeCard({ state: { zoneRevision: undefined } });
    const sameCause = { id: 'c', rootId: 'c', kind: 'effect' as const, source: snapshotOf(matching) };
    expect(triggerMatches(event('DAMAGE_TAKEN', { controllerId: 'player1' }, sameCause), matching, { cause: 'self' })).toBe(true);

    const differentCause = { ...sameCause, source: snapshotOf(makeCard({ state: { zoneRevision: undefined } })) };
    expect(triggerMatches(event('DAMAGE_TAKEN', { controllerId: 'player1' }, differentCause), matching, { cause: 'self' })).toBe(false);
  });

  it('matches killers only against the stated cause relation', () => {
    const victim = source();
    const killer = source();
    const killOutcome = (causes: unknown[]): KillOutcome => ({
      victim: { cardUuid: victim.uuid, zoneRevision: 0 },
      reason: 'lethal',
      causes: causes as KillOutcome['causes'],
    });
    const selfCause = { id: 'c', rootId: 'c', kind: 'effect' as const, source: snapshotOf(killer), controllerId: 'player1' };

    expect(triggerMatches(event('CREATURE_KILLED', { card: victim, outcome: killOutcome([selfCause]) }), killer)).toBe(true);
    expect(
      triggerMatches(event('CREATURE_KILLED', { card: victim, outcome: killOutcome([selfCause]) }), killer, { cause: 'controller' }),
    ).toBe(true);
    expect(
      triggerMatches(event('CREATURE_KILLED', { card: victim, outcome: killOutcome([]) }), killer, { cause: 'controller' }),
    ).toBe(false);
    expect(triggerMatches(event('CREATURE_KILLED', { card: victim, outcome: killOutcome([]) }), killer, { cause: 'any' })).toBe(true);

    const stale = { ...selfCause, source: { ...snapshotOf(killer), card: { ...killer, state: { ...killer.state, zoneRevision: 4 } } } };
    expect(triggerMatches(event('CREATURE_KILLED', { card: victim, outcome: killOutcome([stale]) }), killer)).toBe(false);
  });

  it('uses the event cause for ordinary events', () => {
    const card = source();
    const cause = { id: 'c', rootId: 'c', kind: 'effect' as const, controllerId: 'player2' };
    expect(triggerMatches(event('DAMAGE_TAKEN', { card }, cause), card, { cause: 'controller' }, 'player1')).toBe(false);
    expect(triggerMatches(event('DAMAGE_TAKEN', { card }, cause), card, { cause: 'controller' }, 'player2')).toBe(true);
  });

  it('defaults player events to self explicitly and card events to the subject', () => {
    const card = source();
    const personal = event('CARD_DRAWN', { card, playerId: 'player1' });
    expect(triggerMatches(personal, card)).toBe(true);
    expect(triggerMatches(personal, card, undefined, 'player2')).toBe(false);

    const damageDealt = event('DAMAGE_DEALT', { card, controllerId: 'player1' });
    expect(triggerMatches(damageDealt, card)).toBe(true);
    expect(triggerMatches(damageDealt, source())).toBe(false);

    const anonymous = event('DAMAGE_DEALT', { controllerId: 'player1' });
    expect(triggerMatches(anonymous, source(), { subject: 'any' })).toBe(true);
  });

  it('filters by subject and controller', () => {
    const card = source();
    const other = source();
    const enter = event('PERMANENT_ENTERED', { card: other, controllerId: 'player1' });

    expect(triggerMatches(enter, card, { subject: 'self' })).toBe(false);
    expect(triggerMatches(enter, card, { subject: 'another' })).toBe(true);
    expect(triggerMatches(enter, other, { subject: 'another' })).toBe(false);
    expect(triggerMatches(event('PERMANENT_ENTERED', { controllerId: 'player1' }), card, { subject: 'another' })).toBe(false);
    expect(triggerMatches(enter, card, { subject: 'any', controller: 'self' }, 'player2')).toBe(false);
    expect(triggerMatches(enter, card, { subject: 'any', controller: 'opponent' }, 'player2')).toBe(true);
    expect(triggerMatches(event('PERMANENT_ENTERED', { controllerId: 'player1' }), card, { subject: 'any', controller: 'opponent' })).toBe(false);
  });

  it('filters by resolved card type and subtype when a room is available', () => {
    const card = source();
    const room = roomWith({ battlefield: [card] });
    const enter = event('PERMANENT_ENTERED', { card, controllerId: 'player1' });

    expect(triggerMatches(enter, card, { cardTypes: ['Creature'] }, 'player1', room)).toBe(true);
    expect(triggerMatches(enter, card, { cardTypes: ['Land'] }, 'player1', room)).toBe(false);
    expect(triggerMatches(enter, card, { subTypes: ['Servant'] }, 'player1', room)).toBe(true);
    expect(triggerMatches(enter, card, { subTypes: ['Shrine'] }, 'player1', room)).toBe(false);
    expect(triggerMatches(enter, card, { cardTypes: ['Creature'] })).toBe(true);
    expect(triggerMatches(enter, card, { subTypes: ['Shrine'] })).toBe(false);
    expect(triggerMatches(event('PERMANENT_ENTERED', { controllerId: 'player1' }), card, { cardTypes: ['Creature'] })).toBe(false);
  });

  it('resolves blueprint characteristics without a room', () => {
    const card = makeCard({ blueprint: { subTypes: undefined } });
    const enter = event('PERMANENT_ENTERED', { card, controllerId: 'player1' });
    expect(triggerMatches(enter, card, { subTypes: ['Servant'] })).toBe(false);
    expect(triggerMatches(enter, card, { cardTypes: ['Creature'] })).toBe(true);
  });
});
