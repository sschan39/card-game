// tests/engine/upkeep-trigger.test.ts
// Upkeep triggers: when the turn passes to a new player (TURN_SWITCHED), every
// permanent they control with a BEGIN_UPKEEP triggered ability fires. The
// triggered StackObject resolves through the normal stack pipeline. Closes the
// round-15 structural gap (ARCHITECTURE: "Upkeep/phase triggers").
import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { createTestRoom } from '../helpers/test-room-factory';
import { v4 as uuidv4 } from 'uuid';
import type { GameRoom } from '../../src/types/game.room.types';
import type { CardBlueprint, CardInstance, TriggeredAbility } from '../../src/types/card.types';

/** A 1/1 creature whose controller pays 3 life at the beginning of their upkeep. */
function makeUpkeepLifeTaker(controllerId: string): CardInstance {
  const trigger: TriggeredAbility = {
    type: 'triggered',
    triggerCondition: 'BEGIN_UPKEEP',
    effect: { effectId: 'MODIFY_LIFE', params: { amount: -3 } },
    castSpeed: 'instant',
  };
  const blueprint: CardBlueprint = {
    id: 'upkeep-pain',
    name: 'Blood Tithe',
    cardTypes: ['Creature'],
    castRequirements: { allowedZones: ['hand'], speed: 'sorcery' },
    rulesText: 'At the beginning of your upkeep, you lose 3 life.',
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

describe('GameEngine upkeep triggers', () => {
  let room: GameRoom;
  let engine: GameEngine;

  beforeEach(() => {
    room = createTestRoom({ currentPhase: 'stateMainPhase', priorityPlayerId: 'player1' });
    engine = new GameEngine(room);
    engine.initRoom(); // wire TriggerManager TURN_SWITCHED listener
  });

  it('fires a BEGIN_UPKEEP trigger for the incoming active player', () => {
    // Player2 controls a creature that makes them lose 3 life at upkeep.
    room.battlefield.push(makeUpkeepLifeTaker('player2'));
    const p2LifeBefore = engine.roomState.players['player2'].life;

    // Player1 ends their turn → turn switches to player2 → player2's upkeep.
    const end = engine.endTurn();
    expect(end.success).toBe(true);
    expect(engine.roomState.activeTurnPlayerId).toBe('player2');

    // The upkeep trigger was queued onto the stack.
    expect(engine.roomState.stack.length).toBe(1);
    expect(engine.roomState.stack[0].type).toBe('triggered');

    // Resolve it → player2 loses 3 life.
    engine.resolveTopOfStack();
    expect(engine.roomState.players['player2'].life).toBe(p2LifeBefore - 3);
    expect(engine.roomState.stack.length).toBe(0);
  });

  it('does not fire upkeep triggers for the player who is NOT taking the turn', () => {
    // Opponent (player2) control… but player1 controls upkeep-pain too:
    // only the incoming player's triggers fire.
    room.battlefield.push(makeUpkeepLifeTaker('player1'));
    room.battlefield.push(makeUpkeepLifeTaker('player2'));
    const p2LifeBefore = engine.roomState.players['player2'].life;

    engine.endTurn(); // active becomes player2
    expect(engine.roomState.activeTurnPlayerId).toBe('player2');

    // Only player2's trigger (one card) — but player1's also has one. Both are
    // on the battlefield, only the incoming controller's fires.
    expect(engine.roomState.stack.length).toBe(1);

    engine.resolveTopOfStack();
    // player2 lost life; player1 did not (their upkeep did not begin).
    expect(engine.roomState.players['player2'].life).toBe(p2LifeBefore - 3);
    expect(engine.roomState.players['player1'].life).toBe(20);
  });

  it('produces no upkeep trigger when the incoming player controls nothing with one', () => {
    const p2LifeBefore = engine.roomState.players['player2'].life;
    engine.endTurn();
    expect(engine.roomState.stack.length).toBe(0);
    expect(engine.roomState.players['player2'].life).toBe(p2LifeBefore);
  });
});