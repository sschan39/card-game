// tests/engine/end-of-turn-trigger.test.ts
// End-of-turn triggers: when the active player's turn is ending (TURN_ENDING,
// fired by switchTurn just before the switch), every permanent they control
// with an END_OF_TURN triggered ability fires. The triggered StackObject
// resolves through the normal stack pipeline. Closes the round-16 structural
// gap (ARCHITECTURE: "Upkeep/phase triggers").
import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { createTestRoom } from '../helpers/test-room-factory';
import { v4 as uuidv4 } from 'uuid';
import type { GameRoom } from '../../src/types/game.room.types';
import type { CardBlueprint, CardInstance, TriggeredAbility } from '../../src/types/card.types';

/** A 1/1 creature whose controller loses 3 life at end of their own turn. */
function makeEndTurnLifeTaker(controllerId: string): CardInstance {
  const trigger: TriggeredAbility = {
    type: 'triggered',
    triggerCondition: 'END_OF_TURN',
    effect: { effectId: 'MODIFY_LIFE', params: { amount: -3 } },
    castSpeed: 'instant',
  };
  const blueprint: CardBlueprint = {
    id: 'end-turn-pain',
    name: 'Mind Grinder',
    cardTypes: ['Creature'],
    castRequirements: { allowedZones: ['hand'], speed: 'sorcery' },
    rulesText: 'At the beginning of your end step, you lose 3 life.',
    power: 1,
    toughness: 1,
    abilities: [trigger],
  };
  return {
    uuid: uuidv4(),
    blueprint,
    state: {
      zone: 'battlefield',
      ownerId: controllerId,
      controllerId,
      isTapped: false,
      summoningSickness: false,
      damageTaken: 0,
      counters: {},
    },
  };
}

describe('GameEngine end-of-turn triggers', () => {
  let room: GameRoom;
  let engine: GameEngine;

  beforeEach(() => {
    room = createTestRoom({ currentPhase: 'stateMainPhase', priorityPlayerId: 'player1' });
    engine = new GameEngine(room);
    engine.initRoom(); // wire TriggerManager TURN_ENDING listener
  });

  it('fires an END_OF_TURN trigger for the outgoing active player', () => {
    // Player1 controls a creature that makes them lose 3 life at end of turn.
    room.battlefield.push(makeEndTurnLifeTaker('player1'));
    const p1LifeBefore = engine.roomState.players['player1'].life;

    // Player1 ends their turn → the END_OF_TURN trigger fires before switch.
    const end = engine.endTurn();
    expect(end.success).toBe(true);
    expect(engine.roomState.activeTurnPlayerId).toBe('player2');
    expect(engine.roomState.stack.length).toBe(1);
    expect(engine.roomState.stack[0].type).toBe('triggered');

    // Resolve it → the outgoing controller (player1) loses 3 life.
    engine.resolveTopOfStack();
    expect(engine.roomState.players['player1'].life).toBe(p1LifeBefore - 3);
    expect(engine.roomState.stack.length).toBe(0);
  });

  it('only fires END_OF_TURN triggers for the player whose turn is ending', () => {
    // Both players control an end-turn life-taker. Ending player1's turn must
    // trigger only player1's card, not player2's (player2's end step is later).
    room.battlefield.push(makeEndTurnLifeTaker('player1'));
    room.battlefield.push(makeEndTurnLifeTaker('player2'));
    const p1LifeBefore = engine.roomState.players['player1'].life;

    engine.endTurn();
    expect(engine.roomState.stack.length).toBe(1);

    engine.resolveTopOfStack();
    expect(engine.roomState.players['player1'].life).toBe(p1LifeBefore - 3);
    expect(engine.roomState.players['player2'].life).toBe(20);
  });

  it('produces no end-of-turn trigger when the outgoing player controls nothing with one', () => {
    const p1LifeBefore = engine.roomState.players['player1'].life;
    engine.endTurn();
    expect(engine.roomState.stack.length).toBe(0);
    expect(engine.roomState.players['player1'].life).toBe(p1LifeBefore);
  });
});