// tests/engine/state-machine.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { StateMachine } from '../../src/engine/state-machine';
import { GameEngine } from '../../src/engine/game-engine';
import { gameReducer } from '../../src/engine/game-reducer';
import type { GameEvent } from '../../src/engine/event-bus';
import type { GameMutation } from '../../src/types/game-mutation.types';
import type { GameRoom } from '../../src/types/game.room.types';
import type { Phase } from '../../src/types/game.state.types';
import { instantiateCard } from '../../src/library/card-factory';

function createTestRoom(): GameRoom {
  return {
    roomId: 'room-1',
    player1Id: 'player1',
    player2Id: 'player2',
    players: {
      player1: { id: 'player1', life: 20, mana: { red: 0, blue: 0, green: 0, black: 0, white: 0, yellow: 0 }, deck: [], hand: [], graveyard: [] },
      player2: { id: 'player2', life: 20, mana: { red: 0, blue: 0, green: 0, black: 0, white: 0, yellow: 0 }, deck: [], hand: [], graveyard: [] },
    },
    phase: 'stateTurnStart',
    status: 'waiting',
    engineState: 'waiting_for_player',
    activeTurnPlayerId: 'player1',
    priorityPlayerId: null,
    lastPassedPlayerId: null,
    battlefield: [],
    continuousEffectPool: [],
    stack: [],
    combat: [],
    rpsState: { status: 'pending', playedCards: {} },
  };
}

describe('StateMachine', () => {
  let sm: StateMachine;
  let room: GameRoom;
  let events: GameEvent[];

  /** Exercise the apply boundary that now owns event publication. */
  function apply(mutations: GameMutation[]): void {
    const engine = new GameEngine(room);
    engine.applyMutations(mutations);
    events.push(...engine.drainEventBatches().flatMap(batch => batch.events));
    room = engine.roomState;
    engine.dispose();
  }

  function advance(intent: 'complete' | 'skipToEnd') {
    const engine = new GameEngine(room);
    engine.advancePhase(intent);
    events.push(...engine.drainEventBatches().flatMap(batch => batch.events));
    room = engine.roomState;
    engine.dispose();
  }
  beforeEach(() => {
    events = [];
    room = createTestRoom();
    // Turn/priority scenarios need drawable libraries now that empty draws lose.
    for (const player of Object.values(room.players)) player.deck = Array.from({ length: 8 }, () => {
      const card = instantiateCard('empire-servant');
      card.state = { ...card.state, zone: 'library', ownerId: player.id, controllerId: player.id };
      return card;
    });
    sm = new StateMachine(room);
  });

  describe('initial state', () => {
    it('should start in waiting phase', () => {
      expect(room.status).toBe('waiting');
    });

    it('should have player1 as current player', () => {
      expect(room.activeTurnPlayerId).toBe('player1');
    });

    it('should start with empty stack', () => {
      expect(room.stack).toEqual([]);
    });
  });

  describe('combat step phases', () => {
    it('should expose the five combat step phase names', () => {
      const steps: Phase[] = [
        'beginCombatStep',
        'declareAttackersStep',
        'declareBlockersStep',
        'combatDamageStep',
        'endCombatStep',
      ];
      expect(steps.length).toBe(5);
    });

    it('should transition through all five combat steps in order', () => {
      // Walk to stateMainPhase first.
      apply(sm.transition(room, 'stateTurnStart'));
      apply(sm.transition(room, 'upkeepStep'));
      apply(sm.transition(room, 'stateDrawPhase'));
      apply(sm.transition(room, 'stateMainPhase'));

      apply(sm.transition(room, 'beginCombatStep'));
      expect(room.phase).toBe('beginCombatStep');
      apply(sm.transition(room, 'declareAttackersStep'));
      expect(room.phase).toBe('declareAttackersStep');
      apply(sm.transition(room, 'declareBlockersStep'));
      expect(room.phase).toBe('declareBlockersStep');
      apply(sm.transition(room, 'combatDamageStep'));
      expect(room.phase).toBe('combatDamageStep');
      apply(sm.transition(room, 'endCombatStep'));
      expect(room.phase).toBe('endCombatStep');
    });

    it('should emit dedicated combat events for each step', () => {
      apply(sm.transition(room, 'stateTurnStart'));
      apply(sm.transition(room, 'upkeepStep'));
      apply(sm.transition(room, 'stateDrawPhase'));
      apply(sm.transition(room, 'stateMainPhase'));
      apply(sm.transition(room, 'beginCombatStep'));
      apply(sm.transition(room, 'declareAttackersStep'));
      apply(sm.transition(room, 'declareBlockersStep'));
      apply(sm.transition(room, 'combatDamageStep'));
      apply(sm.transition(room, 'endCombatStep'));

      const ids = events.map(e => e.eventId);
      expect(ids).toContain('COMBAT_BEGIN');
      expect(ids).not.toContain('ATTACKERS_DECLARED');
      expect(ids).not.toContain('BLOCKERS_DECLARED');
      expect(ids).not.toContain('COMBAT_DAMAGE_RESOLVED'); // Combat service, not phase entry, completes damage.
      expect(ids).toContain('COMBAT_ENDED');
    });

    it('does not claim declarations merely because their phase was entered', () => {
      apply(sm.transition(room, 'stateTurnStart'));
      apply(sm.transition(room, 'upkeepStep'));
      apply(sm.transition(room, 'stateDrawPhase'));
      apply(sm.transition(room, 'stateMainPhase'));
      apply(sm.transition(room, 'beginCombatStep'));
      apply(sm.transition(room, 'declareAttackersStep'));
      apply(sm.transition(room, 'declareBlockersStep'));
      apply(sm.transition(room, 'combatDamageStep'));

      const attackers = events.find(e => e.eventId === 'ATTACKERS_DECLARED');
      const blockers = events.find(e => e.eventId === 'BLOCKERS_DECLARED');
      const damage = events.find(e => e.eventId === 'COMBAT_DAMAGE_RESOLVED');
      expect(attackers).toBeUndefined();
      expect(blockers).toBeUndefined();
      expect(damage).toBeUndefined();
    });
  });

  describe('phase transitions', () => {
    it('should transition to a valid next phase', () => {
      apply(sm.transition(room, 'upkeepStep'));
      apply(sm.transition(room, 'stateDrawPhase'));
      expect(room.phase).toBe('stateDrawPhase');
    });

    it('should emit PHASE_CHANGED on transition', () => {
      apply(sm.transition(room, 'upkeepStep'));
      apply(sm.transition(room, 'stateDrawPhase'));
      const phaseEvent = events.find(e => e.eventId === 'PHASE_CHANGED' && e.payload.phase === 'stateDrawPhase');
      expect(phaseEvent).toBeDefined();
      expect(phaseEvent!.payload.phase).toBe('stateDrawPhase');
    });

    it('should reject invalid transitions', () => {
      // stateTurnStart can only go to stateDrawPhase, not stateMainPhase
      apply(sm.transition(room, 'stateMainPhase'));
      expect(room.phase).toBe('stateTurnStart'); // unchanged
    });

    it('should transition through full turn cycle', () => {
      apply(sm.transition(room, 'upkeepStep'));
      apply(sm.transition(room, 'stateDrawPhase'));
      expect(room.phase).toBe('stateDrawPhase');
      apply(sm.transition(room, 'stateMainPhase'));
      expect(room.phase).toBe('stateMainPhase');
      apply(sm.transition(room, 'beginCombatStep'));
      expect(room.phase).toBe('beginCombatStep');
      apply(sm.transition(room, 'declareAttackersStep'));
      expect(room.phase).toBe('declareAttackersStep');
      apply(sm.transition(room, 'declareBlockersStep'));
      expect(room.phase).toBe('declareBlockersStep');
      apply(sm.transition(room, 'combatDamageStep'));
      expect(room.phase).toBe('combatDamageStep');
      apply(sm.transition(room, 'endCombatStep'));
      expect(room.phase).toBe('endCombatStep');
      apply(sm.transition(room, 'postcombatMainPhase'));
      apply(sm.transition(room, 'stateEndPhase'));
      expect(room.phase).toBe('stateEndPhase');
      apply(sm.transition(room, 'cleanupStep'));
      expect(room.phase).toBe('cleanupStep');
      apply(sm.transition(room, 'stateTurnStart'));
      expect(room.phase).toBe('stateTurnStart');
    });

    it('should emit CLEAR_COMBAT when leaving endCombatStep', () => {
      // Seed a combat declaration so we can observe it being cleared.
      room.combat.push({
        uuid: 'combat-1',
        attacker: instantiateCard('empire-servant'),
        attackerPower: 1,
        blockers: [],
      });
      expect(room.combat.length).toBe(1);

      // Walk through the phases to reach endCombatStep legally.
      apply(sm.transition(room, 'upkeepStep'));
      apply(sm.transition(room, 'stateDrawPhase'));
      apply(sm.transition(room, 'stateMainPhase'));
      apply(sm.transition(room, 'beginCombatStep'));
      apply(sm.transition(room, 'declareAttackersStep'));
      apply(sm.transition(room, 'declareBlockersStep'));
      apply(sm.transition(room, 'combatDamageStep'));
      apply(sm.transition(room, 'endCombatStep'));
      expect(room.phase).toBe('endCombatStep');
      apply(sm.transition(room, 'postcombatMainPhase'));
      expect(room.combat.length).toBe(0);
    });
  });

  describe('turn management', () => {
    it('should switch current player', () => {
      apply(sm.switchTurn(room));
      expect(room.activeTurnPlayerId).toBe('player2');
    });

    it('should emit TURN_SWITCHED on switch', () => {
      apply(sm.switchTurn(room));
      const turnEvent = events.find(e => e.eventId === 'TURN_SWITCHED');
      expect(turnEvent).toBeDefined();
      expect(turnEvent!.payload.newPlayer).toBe('player2');
    });

    it('should emit TURN_STARTED when transitioning to stateTurnStart', () => {
      apply(sm.transition(room, 'upkeepStep'));
      apply(sm.transition(room, 'stateDrawPhase'));
      apply(sm.transition(room, 'stateMainPhase'));
      apply(sm.transition(room, 'beginCombatStep'));
      apply(sm.transition(room, 'declareAttackersStep'));
      apply(sm.transition(room, 'declareBlockersStep'));
      apply(sm.transition(room, 'combatDamageStep'));
      apply(sm.transition(room, 'endCombatStep'));
      apply(sm.transition(room, 'postcombatMainPhase'));
      apply(sm.transition(room, 'stateEndPhase'));
      apply(sm.transition(room, 'cleanupStep'));
      apply(sm.transition(room, 'stateTurnStart'));
      const turnEvent = events.find(e => e.eventId === 'TURN_STARTED');
      expect(turnEvent).toBeDefined();
      expect(turnEvent!.payload.currentPlayer).toBe('player1');
    });

    it('should switch back to player1 after two switches', () => {
      apply(sm.switchTurn(room));
      apply(sm.switchTurn(room));
      expect(room.activeTurnPlayerId).toBe('player1');
    });

    it('should correctly report isPlayerTurn', () => {
      expect(sm.isPlayerTurn(room, 'player1')).toBe(true);
      expect(sm.isPlayerTurn(room, 'player2')).toBe(false);
      apply(sm.switchTurn(room));
      expect(sm.isPlayerTurn(room, 'player1')).toBe(false);
      expect(sm.isPlayerTurn(room, 'player2')).toBe(true);
    });
  });

  describe('priority system', () => {
    beforeEach(() => {
      apply(sm.transition(room, 'upkeepStep'));
      apply(sm.transition(room, 'stateDrawPhase'));
      apply(sm.transition(room, 'stateMainPhase'));
    });

    it('should give priority to a player', () => {
      apply(sm.givePriorityTo('player1'));
      expect(room.priorityPlayerId).toBe('player1');
      expect(room.engineState).toBe('waiting_for_player');
    });

    it('should emit PRIORITY_GIVEN', () => {
      apply(sm.givePriorityTo('player1'));
      const priorityEvent = events.find(e => e.eventId === 'PRIORITY_GIVEN');
      expect(priorityEvent).toBeDefined();
      expect(priorityEvent!.payload.playerId).toBe('player1');
    });

    it('should reject passPriority from wrong player', () => {
      apply(sm.givePriorityTo('player1'));
      const result = sm.passPriority(room, 'player2');
      expect(result.success).toBe(false);
    });

    it('should accept passPriority from correct player', () => {
      apply(sm.givePriorityTo('player1'));
      const result = sm.passPriority(room, 'player1');
      expect(result.success).toBe(true);
    });

    it('should advance the phase when both players pass consecutively with an empty stack', () => {
      apply(sm.givePriorityTo('player1'));
      apply(sm.passPriority(room, 'player1').mutations); // player1 passes
      // priority switches to player2
      expect(room.priorityPlayerId).toBe('player2');
      const passed = sm.passPriority(room, 'player2');
      apply(passed.mutations);
      if (passed.success && passed.continuation === 'advance') advance('complete'); // player2 passes
      // both passed with an empty stack → the director advances the phase
      expect(room.phase).not.toBe('stateMainPhase');
      expect(room.engineState).toBe('waiting_for_player');
    });
  });

  describe('stack management', () => {
    beforeEach(() => {
      apply(sm.transition(room, 'upkeepStep'));
      apply(sm.transition(room, 'stateDrawPhase'));
      apply(sm.transition(room, 'stateMainPhase'));
    });

    function makeStackObj(uuid: string, controllerId: string) {
      return {
        uuid,
        type: 'spell' as const,
        controllerId,
        source: { id: 'test', uuid: `card-${uuid}`, name: 'Test Card', cardTypes: ['Spell'] as any, state: { zone: 'stack' as const } as any },
        effects: [] as any[],
        countered: false,
      };
    }

    it('should add item to stack', () => {
      const stackObj = makeStackObj('stack-1', 'player1');
      // Handler pushes to room.stack via PUSH_STACK; addToStack handles phase/event/priority
      apply([{ type: 'PUSH_STACK', stackObject: stackObj }]);
      apply(sm.addToStack(room, stackObj));
      expect(room.stack.length).toBe(1);
      expect(room.stack[0].uuid).toBe('stack-1');
    });

    it('should not change the phase when adding to the stack (Stack is a zone, not a phase)', () => {
      const stackObj = makeStackObj('stack-1', 'player1');
      apply([{ type: 'PUSH_STACK', stackObject: stackObj }]);
      apply(sm.addToStack(room, stackObj));
      expect(room.phase).toBe('stateMainPhase');
    });

    it('should emit STACK_UPDATED when adding to stack', () => {
      const stackObj = makeStackObj('stack-1', 'player1');
      apply([{ type: 'PUSH_STACK', stackObject: stackObj }]);
      apply(sm.addToStack(room, stackObj));
      const stackEvent = events.find(e => e.eventId === 'STACK_UPDATED');
      expect(stackEvent).toBeDefined();
    });

    it('should give priority to the spell controller after addToStack (MTG 116.3d)', () => {
      const stackObj = makeStackObj('stack-1', 'player1');
      apply([{ type: 'PUSH_STACK', stackObject: stackObj }]);
      apply(sm.addToStack(room, stackObj));
      // MTG 116.3d: the player who put the spell on the stack gets priority.
      expect(room.priorityPlayerId).toBe('player1');
    });

    it('should keep the phase unchanged after the stack empties (MTG 116.4)', () => {
      // Adding to the stack does not change the phase.
      const stackObj = makeStackObj('stack-1', 'player1');
      apply([{ type: 'PUSH_STACK', stackObject: stackObj }]);
      apply(sm.addToStack(room, stackObj));
      expect(room.phase).toBe('stateMainPhase');

      // Popping the stack also does not change the phase.
      apply([{ type: 'POP_STACK' }]);
      expect(room.phase).toBe('stateMainPhase');
    });

    it('should resolve stack in LIFO order', () => {
      const obj1 = makeStackObj('stack-1', 'player1');
      const obj2 = makeStackObj('stack-2', 'player2');
      apply([{ type: 'PUSH_STACK', stackObject: obj1 }]);
      apply(sm.addToStack(room, obj1));
      apply([{ type: 'PUSH_STACK', stackObject: obj2 }]);
      apply(sm.addToStack(room, obj2));

      const resolved: string[] = [];
      while (room.stack.length > 0) {
        const item = room.stack[room.stack.length - 1];
        resolved.push(item.uuid);
        apply([{ type: 'POP_STACK' }]);
      }

      expect(resolved).toEqual(['stack-2', 'stack-1']); // LIFO
    });
  });

  describe('untap step', () => {
    it('should untap permanents and reset mana on stateTurnStart', () => {
      // Set up: player1 has a tapped creature on battlefield with mana in pool
      room.players['player1'].mana = { red: 3, blue: 2, green: 0, black: 0, white: 0, yellow: 1 };
      room.battlefield.push({
        uuid: 'creature-1',
        blueprint: { id: 'test', name: 'Test', cardTypes: ['Creature'], power: 1, toughness: 1, castRequirements: { allowedZones: ['hand'], cost: {} }, rulesText: '', abilities: [] },
        state: { zone: 'battlefield', ownerId: 'player1', controllerId: 'player1', isTapped: true, summoningSickness: true, damageTaken: 0, counters: {} },
      } as any);
      // Also add opponent's tapped creature — should NOT untap
      room.battlefield.push({
        uuid: 'creature-2',
        blueprint: { id: 'test2', name: 'Test2', cardTypes: ['Creature'], power: 1, toughness: 1, castRequirements: { allowedZones: ['hand'], cost: {} }, rulesText: '', abilities: [] },
        state: { zone: 'battlefield', ownerId: 'player2', controllerId: 'player2', isTapped: true, summoningSickness: true, damageTaken: 0, counters: {} },
      } as any);

      apply(sm.transition(room, 'upkeepStep'));
      apply(sm.transition(room, 'stateDrawPhase'));
      apply(sm.transition(room, 'stateMainPhase'));
      apply(sm.transition(room, 'beginCombatStep'));
      apply(sm.transition(room, 'declareAttackersStep'));
      apply(sm.transition(room, 'declareBlockersStep'));
      apply(sm.transition(room, 'combatDamageStep'));
      apply(sm.transition(room, 'endCombatStep'));
      apply(sm.transition(room, 'postcombatMainPhase'));
      apply(sm.transition(room, 'stateEndPhase'));
      apply(sm.transition(room, 'cleanupStep'));
      apply(sm.transition(room, 'stateTurnStart'));

      // Player1's creature should be untapped and sickness cleared
      const p1Creature = room.battlefield.find(c => c.state.controllerId === 'player1')!;
      expect(p1Creature.state.isTapped).toBe(false);
      expect(p1Creature.state.summoningSickness).toBe(false);

      // Player2's creature should still be tapped
      const p2Creature = room.battlefield.find(c => c.state.controllerId === 'player2')!;
      expect(p2Creature.state.isTapped).toBe(true);
      expect(p2Creature.state.summoningSickness).toBe(true);

      // Player1's mana should be reset
      expect(room.players['player1'].mana).toEqual({ red: 0, blue: 0, green: 0, black: 0, white: 0, yellow: 0 });
    });

    it('should clear attackedThisTurn on all of active player permanents at turn start', () => {
      // Player1 has a creature that already attacked this turn
      room.battlefield.push({
        uuid: 'creature-1',
        blueprint: { id: 'test', name: 'Test', cardTypes: ['Creature'], power: 1, toughness: 1, castRequirements: { allowedZones: ['hand'], cost: {} }, rulesText: '', abilities: [] },
        state: { zone: 'battlefield', ownerId: 'player1', controllerId: 'player1', isTapped: true, summoningSickness: false, attackedThisTurn: true, damageTaken: 0, counters: {} },
      } as any);
      // Opponent's creature that attacked — should NOT be cleared (not active player's)
      room.battlefield.push({
        uuid: 'creature-2',
        blueprint: { id: 'test2', name: 'Test2', cardTypes: ['Creature'], power: 1, toughness: 1, castRequirements: { allowedZones: ['hand'], cost: {} }, rulesText: '', abilities: [] },
        state: { zone: 'battlefield', ownerId: 'player2', controllerId: 'player2', isTapped: true, summoningSickness: false, attackedThisTurn: true, damageTaken: 0, counters: {} },
      } as any);

      apply(sm.transition(room, 'upkeepStep'));
      apply(sm.transition(room, 'stateDrawPhase'));
      apply(sm.transition(room, 'stateMainPhase'));
      apply(sm.transition(room, 'beginCombatStep'));
      apply(sm.transition(room, 'declareAttackersStep'));
      apply(sm.transition(room, 'declareBlockersStep'));
      apply(sm.transition(room, 'combatDamageStep'));
      apply(sm.transition(room, 'endCombatStep'));
      apply(sm.transition(room, 'postcombatMainPhase'));
      apply(sm.transition(room, 'stateEndPhase'));
      apply(sm.transition(room, 'cleanupStep'));
      apply(sm.transition(room, 'stateTurnStart'));

      // Player1's creature should have attackedThisTurn cleared
      const p1Creature = room.battlefield.find(c => c.state.controllerId === 'player1')!;
      expect(p1Creature.state.attackedThisTurn).toBe(false);

      // Player2's creature should still have attackedThisTurn = true
      const p2Creature = room.battlefield.find(c => c.state.controllerId === 'player2')!;
      expect(p2Creature.state.attackedThisTurn).toBe(true);
    });
  });

  describe('phase director (advancePhase)', () => {
    it('stops at upkeep after automatic untap', () => {
      advance('complete');
      expect(room.phase).toBe('upkeepStep');
      expect(room.priorityPlayerId).toBe('player1');
      expect(room.engineState).toBe('waiting_for_player');
    });
    it('stops at draw before precombat main', () => {
      advance('complete'); advance('complete');
      expect(room.phase).toBe('stateDrawPhase');
      advance('complete'); expect(room.phase).toBe('stateMainPhase');
    });
    it('awaits a declaration with no priority', () => {
      room.phase = 'beginCombatStep'; advance('complete');
      expect(room.phase).toBe('declareAttackersStep');
      expect(room.priorityPlayerId).toBeNull();
      advance('complete'); expect(room.phase).toBe('declareAttackersStep');
    });
    it('awaits defender decision independently of priority', () => {
      room.phase = 'declareAttackersStep'; room.combatDeclarations = { attackers: true, blockers: false };
      const attacker = instantiateCard('empire-servant');
      room.combat = [{ uuid: attacker.uuid, attacker, attackerPower: 1, blockers: [] }];
      advance('complete'); expect(room.phase).toBe('declareBlockersStep');
      expect(room.priorityPlayerId).toBeNull();
    });
    it('stops in postcombat main after end combat', () => {
      room.phase = 'endCombatStep'; advance('complete');
      expect(room.phase).toBe('postcombatMainPhase');
      expect(room.activeTurnPlayerId).toBe('player1');
    });
    it('debug skip completes the turn even from untap', () => {
      advance('skipToEnd'); expect(room.phase).toBe('stateMainPhase');
      expect(room.activeTurnPlayerId).toBe('player2');
    });
    it('untaps only the incoming player during ordinary turn wrap', () => {
      const p1 = instantiateCard('empire-servant'), p2 = instantiateCard('empire-servant');
      p1.state = { ...p1.state, zone: 'battlefield', ownerId: 'player1', controllerId: 'player1', isTapped: true };
      p2.state = { ...p2.state, zone: 'battlefield', ownerId: 'player2', controllerId: 'player2', isTapped: true };
      room.battlefield = [p1, p2]; room.phase = 'stateEndPhase'; advance('complete');
      expect(room.phase).toBe('upkeepStep'); expect(room.activeTurnPlayerId).toBe('player2');
      expect(room.battlefield.find(card => card.uuid === p1.uuid)?.state.isTapped).toBe(true);
      expect(room.battlefield.find(card => card.uuid === p2.uuid)?.state.isTapped).toBe(false);
    });
  });
  describe('CLEAR_DAMAGE mutation', () => {
    it('resets damageTaken to 0 on all battlefield cards', () => {
      const c1 = instantiateCard('empire-servant');
      c1.state.zone = 'battlefield';
      c1.state.damageTaken = 2;
      const c2 = instantiateCard('empire-servant');
      c2.state.zone = 'battlefield';
      c2.state.damageTaken = 1;
      room.battlefield.push(c1, c2);

      const next = gameReducer(room, { type: 'CLEAR_DAMAGE' });
      expect(next.battlefield[0].state.damageTaken).toBe(0);
      expect(next.battlefield[1].state.damageTaken).toBe(0);
    });

    it('cleanupStep clears damage from all battlefield cards', () => {
      const c = instantiateCard('empire-servant');
      c.state.zone = 'battlefield';
      c.state.controllerId = 'player1';
      c.state.damageTaken = 2;
      room.battlefield.push(c);
      room.phase = 'stateEndPhase';

      const mutations = sm.transition(room, 'cleanupStep');
      apply(mutations);

      const card = room.battlefield.find(x => x.uuid === c.uuid);
      expect(card?.state.damageTaken).toBe(0);
    });

    it('buffed creature with damage survives cleanup (order-of-operations)', () => {
      // 2/2 creature with a "+0/+2 until end of turn" buff, took 3 damage
      const c = instantiateCard('empire-servant'); // 1/1 base
      c.state.zone = 'battlefield';
      c.state.controllerId = 'player1';
      c.state.damageTaken = 3;
      room.battlefield.push(c);

      // Simulate a +0/+2 EOT buff in the continuous effect pool
      room.continuousEffectPool.push({
        source: 'test-buff',
        duration: 'END_OF_TURN',
        scope: { type: 'SELF' },
        effect: { type: 'STAT_DELTA', power: 0, toughness: 2 },
      });

      room.phase = 'stateEndPhase';

      const mutations = sm.transition(room, 'cleanupStep');
      apply(mutations);

      // Creature should still be on the battlefield (damage cleared before buff stripped)
      const card = room.battlefield.find(x => x.uuid === c.uuid);
      expect(card).toBeDefined();
      expect(card!.state.damageTaken).toBe(0);
      // Buff should be gone
      expect(room.continuousEffectPool).toHaveLength(0);
    });
  });
});
