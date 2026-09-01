// tests/engine/state-machine.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StateMachine } from '../../src/engine/state-machine';
import { EventBus } from '../../src/engine/event-bus';
import { gameReducer } from '../../src/engine/game-reducer';
import type { GameEvent } from '../../src/engine/event-bus';
import type { GameMutation } from '../../src/types/game-mutation.types';
import type { GameRoom } from '../../src/types/game.room.types';

function createTestRoom(): GameRoom {
  return {
    roomId: 'room-1',
    player1Id: 'player1',
    player2Id: 'player2',
    players: {
      player1: { id: 'player1', life: 20, mana: { red: 0, blue: 0, green: 0, black: 0, white: 0, colorless: 0 }, deck: [], hand: [], graveyard: [] },
      player2: { id: 'player2', life: 20, mana: { red: 0, blue: 0, green: 0, black: 0, white: 0, colorless: 0 }, deck: [], hand: [], graveyard: [] },
    },
    currentPhase: 'waiting',
    previousPhase: null,
    activeTurnPlayerId: 'player1',
    priorityPlayerId: null,
    lastPassedPlayerId: null,
    battlefield: [],
    continuousEffectPool: [],
    stack: [],
    rpsState: { status: 'pending', playedCards: {} },
  };
}

describe('StateMachine', () => {
  let sm: StateMachine;
  let room: GameRoom;
  let bus: EventBus;
  let events: GameEvent[];

  /** Apply mutations through the pure reducer, committing to `room`. */
  function apply(mutations: GameMutation[]): void {
    for (const m of mutations) {
      room = gameReducer(room, m);
    }
  }

  beforeEach(() => {
    events = [];
    room = createTestRoom();
    bus = new EventBus('room-1');
    bus.on('PHASE_CHANGED', (e) => events.push(e));
    bus.on('TURN_SWITCHED', (e) => events.push(e));
    bus.on('TURN_STARTED', (e) => events.push(e));
    sm = new StateMachine(room, bus);
  });

  describe('initial state', () => {
    it('should start in waiting phase', () => {
      expect(room.currentPhase).toBe('waiting');
    });

    it('should have player1 as current player', () => {
      expect(room.activeTurnPlayerId).toBe('player1');
    });

    it('should start with empty stack', () => {
      expect(room.stack).toEqual([]);
    });
  });

  describe('phase transitions', () => {
    it('should transition to a valid next phase', () => {
      apply(sm.transition(room, 'RPS'));
      expect(room.currentPhase).toBe('RPS');
    });

    it('should emit PHASE_CHANGED on transition', () => {
      apply(sm.transition(room, 'RPS'));
      const phaseEvent = events.find(e => e.eventId === 'PHASE_CHANGED');
      expect(phaseEvent).toBeDefined();
      expect(phaseEvent!.payload.phase).toBe('RPS');
    });

    it('should reject invalid transitions', () => {
      // 'waiting' can only go to 'RPS', not 'stateMainPhase'
      apply(sm.transition(room, 'stateMainPhase'));
      expect(room.currentPhase).toBe('waiting'); // unchanged
    });

    it('should allow Stack transition from any phase when stack is open', () => {
      apply(sm.transition(room, 'RPS'));
      apply(sm.transition(room, 'Stack'));
      expect(room.currentPhase).toBe('Stack');
    });

    it('should reject Stack transition when stack is closed', () => {
      sm.stackOpen = false;
      apply(sm.transition(room, 'RPS'));
      apply(sm.transition(room, 'Stack'));
      expect(room.currentPhase).toBe('RPS'); // unchanged
    });

    it('should save previousPhase when entering Stack', () => {
      apply(sm.transition(room, 'RPS'));
      apply(sm.transition(room, 'Stack'));
      expect(room.previousPhase).toBe('RPS');
    });

    it('should transition through full turn cycle', () => {
      apply(sm.transition(room, 'RPS'));
      apply(sm.transition(room, 'stateTurnStart'));
      expect(room.currentPhase).toBe('stateTurnStart');
      apply(sm.transition(room, 'stateDrawPhase'));
      expect(room.currentPhase).toBe('stateDrawPhase');
      apply(sm.transition(room, 'stateMainPhase'));
      expect(room.currentPhase).toBe('stateMainPhase');
      apply(sm.transition(room, 'stateBattlePhase'));
      expect(room.currentPhase).toBe('stateBattlePhase');
      apply(sm.transition(room, 'endCombat'));
      expect(room.currentPhase).toBe('endCombat');
      apply(sm.transition(room, 'stateEndPhase'));
      expect(room.currentPhase).toBe('stateEndPhase');
      apply(sm.transition(room, 'cleanupStep'));
      expect(room.currentPhase).toBe('cleanupStep');
      apply(sm.transition(room, 'stateTurnStart'));
      expect(room.currentPhase).toBe('stateTurnStart');
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
      apply(sm.transition(room, 'RPS'));
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
      apply(sm.transition(room, 'RPS'));
      apply(sm.transition(room, 'stateTurnStart'));
      apply(sm.transition(room, 'stateDrawPhase'));
      apply(sm.transition(room, 'stateMainPhase'));
    });

    it('should give priority to a player', () => {
      apply(sm.givePriorityTo('player1'));
      expect(room.priorityPlayerId).toBe('player1');
      expect(sm.waitingForResponse).toBe(true);
    });

    it('should emit PRIORITY_GIVEN', () => {
      bus.on('PRIORITY_GIVEN', (e) => events.push(e));
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

    it('should resolve phase when both players pass consecutively', () => {
      apply(sm.givePriorityTo('player1'));
      apply(sm.passPriority(room, 'player1').mutations); // player1 passes
      // priority switches to player2
      expect(room.priorityPlayerId).toBe('player2');
      apply(sm.passPriority(room, 'player2').mutations); // player2 passes
      // both passed, phase should resolve
      expect(sm.waitingForResponse).toBe(false);
      expect(room.priorityPlayerId).toBeNull();
    });
  });

  describe('stack management', () => {
    beforeEach(() => {
      apply(sm.transition(room, 'RPS'));
      apply(sm.transition(room, 'stateTurnStart'));
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

    it('should transition to Stack state when adding to stack', () => {
      const stackObj = makeStackObj('stack-1', 'player1');
      apply([{ type: 'PUSH_STACK', stackObject: stackObj }]);
      apply(sm.addToStack(room, stackObj));
      expect(room.currentPhase).toBe('Stack');
    });

    it('should emit STACK_UPDATED when adding to stack', () => {
      bus.on('STACK_UPDATED', (e) => events.push(e));
      const stackObj = makeStackObj('stack-1', 'player1');
      apply([{ type: 'PUSH_STACK', stackObject: stackObj }]);
      apply(sm.addToStack(room, stackObj));
      const stackEvent = events.find(e => e.eventId === 'STACK_UPDATED');
      expect(stackEvent).toBeDefined();
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
      room.players['player1'].mana = { red: 3, blue: 2, green: 0, black: 0, white: 0, colorless: 1 };
      room.battlefield.push({
        uuid: 'creature-1',
        blueprint: { id: 'test', name: 'Test', cardTypes: ['Creature'], castRequirements: { allowedZones: ['hand'], cost: {} }, rulesText: '', abilities: [] },
        state: { zone: 'battlefield', ownerId: 'player1', controllerId: 'player1', isTapped: true, summoningSickness: true, damageTaken: 0, counters: {} },
      } as any);
      // Also add opponent's tapped creature — should NOT untap
      room.battlefield.push({
        uuid: 'creature-2',
        blueprint: { id: 'test2', name: 'Test2', cardTypes: ['Creature'], castRequirements: { allowedZones: ['hand'], cost: {} }, rulesText: '', abilities: [] },
        state: { zone: 'battlefield', ownerId: 'player2', controllerId: 'player2', isTapped: true, summoningSickness: true, damageTaken: 0, counters: {} },
      } as any);

      apply(sm.transition(room, 'RPS'));
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
      expect(room.players['player1'].mana).toEqual({ red: 0, blue: 0, green: 0, black: 0, white: 0, colorless: 0 });
    });
  });
});