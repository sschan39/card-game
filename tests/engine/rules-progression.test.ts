import { answerSingleRecipientCombat } from '../helpers/combat-fixture';
import { describe, expect, it, vi } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { EventBus } from '../../src/engine/event-bus';
import { instantiateCard } from '../../src/library/card-factory';
import { createTestRoom } from '../helpers/test-room-factory';
import type { CardInstance, TriggerEvent } from '../../src/types/card.types';
import type { StackObject } from '../../src/types/effect.types';

function permanent(trigger?: TriggerEvent, ownerId = 'player1'): CardInstance {
  const base = instantiateCard('empire-servant');
  return { ...base,
    state: { ...base.state, zone: 'battlefield', ownerId, controllerId: ownerId, summoningSickness: false },
    blueprint: { ...base.blueprint, abilities: trigger ? [{ type: 'triggered', triggerCondition: trigger,
      castSpeed: 'instant', effect: { action: 'DRAW', params: { amount: 0 }, tags: [], targeting: { type: 'self', required: false } } }] : [] },
  };
}

function engineFor(room = createTestRoom()) {
  const engine = new GameEngine(room);
  engine.initRoom();
  const bus = (engine as unknown as { eventBus: EventBus }).eventBus;
  return { engine, bus, room };
}

function inertStack(source: CardInstance): StackObject {
  return { uuid: 'trigger', type: 'triggered', controllerId: 'player1', source, effects: [], countered: false };
}

describe('rules progression checkpoint', () => {
  it('settles creature deaths before putting discovered damage triggers onto the stack', () => {
    const { room, engine, bus } = engineFor();
    const card = permanent('ON_DAMAGE_TAKEN');
    room.battlefield = [card];
    const battlefieldSizes: number[] = [];
    bus.on('STACK_UPDATED', event => {
      if (event.payload.newAction) battlefieldSizes.push(engine.roomState.battlefield.length);
    });
    engine.applyMutations([{ type: 'SET_DAMAGE', cardUuid: card.uuid, amount: 1 }]);
    expect(battlefieldSizes).toEqual([0]);
    expect(engine.roomState.stack[0].source.uuid).toBe(card.uuid);
    const batches = engine.drainEventBatches();
    expect(batches.filter(batch => batch.cause.kind !== 'engine').map(batch => batch.cause.kind)).toEqual(['state-based-action', 'trigger']);
  });

  it('settles repeated SBA deaths before scheduling captured death watchers', () => {
    const { room, engine, bus } = engineFor();
    const source = permanent('ON_DIE'); const dependent = permanent('ON_DIE');
    for (const card of [source, dependent]) card.blueprint = { ...card.blueprint, abilities: card.blueprint.abilities.map(ability => ({ ...ability, trigger: { subject: 'any' as const } })) };
    room.battlefield = [source, dependent];
    dependent.state.damageTaken = 1;
    room.continuousEffectPool = [{ source: source.uuid, layer: 7, effect: { type: 'STAT_DELTA', toughness: 1 }, scope: { cardUuid: dependent.uuid }, duration: 'PERMANENT' }];
    const sizes: number[] = [];
    bus.on('STACK_UPDATED', event => { if (event.payload.newAction) sizes.push(engine.roomState.battlefield.length); });
    engine.applyMutations([{ type: 'SET_DAMAGE', cardUuid: source.uuid, amount: 1 }]);
    expect(engine.roomState.battlefield).toEqual([]);
    expect(engine.roomState.pendingChoice?.kind).toBe('ordering');
    const choice = engine.roomState.pendingChoice!;
    expect(engine.executePlayerAction(choice.playerId, 'choose', { choiceId: choice.id, choices: choice.options.map(option => option.id) }).success).toBe(true);
    expect(sizes).toEqual([0, 0, 0]);
    expect(engine.roomState.stack.map(object => object.source.uuid).sort()).toEqual([source.uuid, dependent.uuid, dependent.uuid].sort());
    expect(engine.drainEventBatches().filter(batch => batch.cause.kind === 'state-based-action')).toHaveLength(2);
  });

  it('rejects unrelated commands while an applied event is being processed', () => {
    const { engine, bus } = engineFor();
    let success: boolean | undefined;
    const direct: (string | undefined)[] = [];
    bus.on('LIFE_CHANGED', () => {
      success = engine.executePlayerAction('player1', 'pass_priority').success;
      for (const result of [engine.proposeAndStack('player1', 'declare_attackers', {}),
        engine.handleAction('player1', 'declare_attackers', {}), engine.resolveTopOfStack()]) {
        direct.push(result.success ? undefined : result.reason);
      }
    });
    engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player1', amount: 19 }]);
    expect(success).toBe(false);
    expect(direct).toEqual(Array(3).fill('Rules checkpoint is pending'));
    expect(engine.priorityPlayerId).toBe('player1');
    expect(engine.hasPendingRulesWork).toBe(false);
  });

  it('resets a previous pass when the other player casts an instant', () => {
    const { room, engine } = engineFor();
    const base = instantiateCard('broken-fireball');
    const spell: CardInstance = { ...base,
      state: { ...base.state, zone: 'hand', ownerId: 'player2', controllerId: 'player2' },
      blueprint: { ...base.blueprint, castRequirements: { ...base.blueprint.castRequirements, speed: 'instant', cost: {} } },
    };
    room.players.player2.hand = [spell];
    engine.passPriority('player1');
    expect(engine.executePlayerAction('player2', 'cast_spell', { cardUuid: spell.uuid, targets: [{ targetType: 'player', playerId: 'player1' }] }).success).toBe(true);
    expect(engine.roomState.lastPassedPlayerId).toBeNull();
    engine.passPriority('player2');
    expect(engine.roomState.stack).toHaveLength(1);
    expect(engine.priorityPlayerId).toBe('player1');
    expect(engine.roomState.players.player1.life).toBe(20);
  });

  it('uses the same completion path for ordinary and debug resolution', () => {
    const initial = createTestRoom({ lastPassedPlayerId: 'player2' });
    const source = permanent();
    initial.stack = [inertStack(source), { ...inertStack(source), uuid: 'top' }];
    const ordinary = engineFor(structuredClone(initial)).engine;
    const debug = engineFor(structuredClone(initial)).engine;
    ordinary.passPriority('player1');
    debug.executePlayerAction('player2', 'resolve_stack');
    expect(debug.roomState).toEqual(ordinary.roomState);
    expect(debug.roomState).toMatchObject({ lastPassedPlayerId: null, priorityPlayerId: 'player1', engineState: 'waiting_for_player', phase: 'stateMainPhase' });
  });

  it('stops an automatic chain when turn-start creates a trigger', () => {
    const { room, engine } = engineFor(createTestRoom({ phase: 'cleanupStep' }));
    room.battlefield = [permanent('BEGIN_UPKEEP', 'player2')];
    const draw = instantiateCard('empire-servant');
    draw.state = { ...draw.state, zone: 'library', ownerId: 'player2', controllerId: 'player2' };
    room.players.player2.deck = [draw];
    const mutations = engine.advancePhase('complete');
    expect(engine.phase).toBe('upkeepStep');
    expect(engine.roomState.stack).toHaveLength(1);
    expect(engine.roomState.players.player2.deck).toHaveLength(1);
    expect(mutations.some(mutation => mutation.type === 'SET_PHASE' && mutation.phase === 'stateDrawPhase')).toBe(false);
  });

  it('recomputes the next draw step after an intervening step changes the deck', () => {
    const { room, engine, bus } = engineFor(createTestRoom({ phase: 'cleanupStep' }));
    const draw = instantiateCard('empire-servant');
    draw.state = { ...draw.state, zone: 'library', ownerId: 'player2', controllerId: 'player2' };
    room.players.player2.deck = [draw];
    const sm = (engine as unknown as { stateMachine: import('../../src/engine/state-machine').StateMachine }).stateMachine;
    const planned = vi.spyOn(sm, 'transition');
    bus.on('TURN_STARTED', () => engine.mutationCollector.push({ type: 'MOVE_CARD', cardUuid: draw.uuid, playerId: 'player2', from: 'library', to: 'graveyard' }));
    const mutations = engine.advancePhase('complete');
    expect(engine.roomState.players.player2.hand).toEqual([]);
    expect(mutations.filter(mutation => mutation.type === 'MOVE_CARD' && mutation.to === 'hand')).toEqual([]);
    expect(engine.phase).toBe('upkeepStep');
    engine.passPriority('player2'); engine.passPriority('player1');
    const drawPlan = planned.mock.calls.find(([, phase]) => phase === 'stateDrawPhase');
    expect(drawPlan?.[0].players.player2.deck).toEqual([]);
  });

  it('pauses an attack declaration for triggers and rejects another declaration after resolution', () => {
    const { room, engine } = engineFor(createTestRoom({ phase: 'declareAttackersStep' }));
    const attacker = permanent('ON_ATTACK');
    const other = permanent();
    room.battlefield = [attacker, other];
    expect(engine.executePlayerAction('player1', 'declare_attackers', { attackers: [{ cardUuid: attacker.uuid }] }).success).toBe(true);
    expect(engine.phase).toBe('declareAttackersStep');
    expect(engine.roomState.combatDeclarations?.attackers).toBe(true);
    engine.resolveTopOfStack();
    expect(engine.executePlayerAction('player1', 'declare_attackers', { attackers: [{ cardUuid: other.uuid }] }).success).toBe(false);
    engine.passPriority('player1'); engine.passPriority('player2');
    expect(engine.phase).toBe('declareBlockersStep');
    expect(engine.executePlayerAction('player2', 'declare_blockers', { assignments: [] }).success).toBe(true);
    expect(engine.phase).toBe('declareBlockersStep');
    expect(engine.priorityPlayerId).toBe('player1');
    expect(engine.roomState.combatDeclarations).toEqual({ attackers: true, blockers: true });
  });

  it('preserves pass history when an intervening action is rejected', () => {
    const { engine } = engineFor();
    engine.passPriority('player1');
    expect(engine.executePlayerAction('player2', 'cast_spell', { cardUuid: 'missing' }).success).toBe(false);
    expect(engine.roomState.lastPassedPlayerId).toBe('player1');
  });

  it('accumulates unblocked damage from multiple live attackers', () => {
    const { room, engine } = engineFor(createTestRoom({ phase: 'declareBlockersStep' }));
    room.battlefield = [permanent(), permanent()];
    room.battlefield[0].state.counters['+1/+1'] = 2;
    room.combat = room.battlefield.map(attacker => ({ uuid: attacker.uuid, attacker: structuredClone(attacker), attackerPower: 1, blockers: [] }));
    room.combatDeclarations = { attackers: true, blockers: true };
    engine.advancePhase('complete');
    answerSingleRecipientCombat(engine);
    expect(engine.roomState.players.player2.life).toBe(16);
  });

  it('keeps an attacker blocked after its blocker leaves the battlefield', () => {
    const { room, engine } = engineFor(createTestRoom({ phase: 'declareBlockersStep' }));
    const attacker = permanent(); const blocker = permanent(undefined, 'player2');
    room.battlefield = [attacker];
    room.combat = [{ uuid: attacker.uuid, attacker, attackerPower: 1, blockers: [blocker] }];
    room.combatDeclarations = { attackers: true, blockers: true };
    engine.advancePhase('complete');
    expect(engine.roomState.players.player2.life).toBe(20);
  });

  it('does not deal damage from an attacker that has left the battlefield', () => {
    const { room, engine } = engineFor(createTestRoom({ phase: 'declareBlockersStep' }));
    const attacker = permanent();
    room.players.player1.graveyard.push({ ...attacker, state: { ...attacker.state, zone: 'graveyard' } });
    room.combat = [{ uuid: attacker.uuid, attacker, attackerPower: 1, blockers: [] }];
    room.combatDeclarations = { attackers: true, blockers: true };
    engine.advancePhase('complete');
    expect(engine.roomState.players.player2.life).toBe(20);
  });
});
