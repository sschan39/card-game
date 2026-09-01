// tests/engine/game-over.test.ts
// Win-condition rules: detectGameWinner (pure) + engine-level game-over flow.
import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { detectGameWinner } from '../../src/engine/state-machine';
import { registerAction } from '../../src/engine/action-registry';
import { attackHandler } from '../../src/engine/handlers/attack-handler';
import { endTurnHandler } from '../../src/engine/handlers/end-turn-handler';
import { ActionValidator } from '../../src/engine/action-validator';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '../../src/library/card-factory';
import type { GameRoom } from '../../src/types/game.room.types';

describe('detectGameWinner (pure)', () => {
  it('returns null when both players have more than 0 life', () => {
    const room = createTestRoom();
    expect(detectGameWinner(room)).toBeNull();
  });

  it('returns null when only one player exists', () => {
    const room = createTestRoom({ player2Id: null });
    room.players['player1'].life = 0;
    expect(detectGameWinner(room)).toBeNull();
  });

  it('returns the opponent when player1 reaches 0 life', () => {
    const room = createTestRoom();
    room.players['player1'].life = 0;
    expect(detectGameWinner(room)).toBe('player2');
  });

  it('returns the opponent when player2 reaches 0 life', () => {
    const room = createTestRoom();
    room.players['player2'].life = 0;
    expect(detectGameWinner(room)).toBe('player1');
  });

  it('handles negative life below zero', () => {
    const room = createTestRoom();
    room.players['player2'].life = -3;
    expect(detectGameWinner(room)).toBe('player1');
  });

  it('returns higher-life player when both are at or below zero', () => {
    const room = createTestRoom();
    room.players['player1'].life = -2;
    room.players['player2'].life = -5;
    expect(detectGameWinner(room)).toBe('player1');
  });

  it('returns null for a simultaneous double-loss tie', () => {
    const room = createTestRoom();
    room.players['player1'].life = 0;
    room.players['player2'].life = 0;
    expect(detectGameWinner(room)).toBeNull();
  });

  it('returns null when the game has already ended', () => {
    const room = createTestRoom();
    room.currentPhase = 'gameOver';
    room.players['player2'].life = 0;
    expect(detectGameWinner(room)).toBeNull();
  });
});

describe('GameEngine game-over flow', () => {
  let room: GameRoom;
  let engine: GameEngine;

  beforeEach(() => {
    room = createTestRoom();
    engine = new GameEngine(room);
    registerAction('attack', attackHandler);
    // Player1 is attacking; put an untapped, non-sick power-1 creature on the field.
    const creature = instantiateCard('empire-servant');
    creature.state.zone = 'battlefield';
    creature.state.ownerId = 'player1';
    creature.state.controllerId = 'player1';
    creature.state.summoningSickness = false;
    room.battlefield.push(creature);
    // The engine holds the same reference until its first applyMutations, so
    // direct mutation here is observed by the engine.
    room.currentPhase = 'stateBattlePhase';
    room.priorityPlayerId = 'player1';
    // Opponent at 1 life: one point of combat damage should end the game.
    room.players['player2'].life = 1;
  });

  /** The engine reassigns its room immutably; read the live snapshot. */
  function state(): GameRoom {
    return engine.roomState;
  }

  it('transitions to gameOver with the attacker as winner when damage reduces a player to 0 life', () => {
    // 1. Attack → taps creature, pushes MODIFY_LIFE(-1) onto the stack.
    const attack = engine.proposeAndStack('player1', 'attack', { cardUuid: room.battlefield[0].uuid });
    expect(attack.success).toBe(true);
    expect(state().stack.length).toBe(1);

    // 2. Resolve the stack → applies -1 to player2's life, life drops to 0.
    const resolve = engine.resolveTopOfStack();
    expect(resolve.success).toBe(true);

    // 3. Win condition rule fires inside applyMutations.
    expect(state().currentPhase).toBe('gameOver');
    expect(state().winnerId).toBe('player1');
    expect(state().players['player2'].life).toBe(0);
    // Priority is cleared so no further actions are accepted.
    expect(state().priorityPlayerId).toBeNull();
  });

  it('does not end the game prematurely when life stays above zero', () => {
    room.players['player2'].life = 5; // 1 damage → 4, above zero
    const attack = engine.proposeAndStack('player1', 'attack', { cardUuid: room.battlefield[0].uuid });
    expect(attack.success).toBe(true);
    engine.resolveTopOfStack();
    expect(state().currentPhase).not.toBe('gameOver');
    expect(state().winnerId).toBeNull();
    expect(state().players['player2'].life).toBe(4);
  });

  it('does not run the win rule again once the game is over', () => {
    engine.proposeAndStack('player1', 'attack', { cardUuid: room.battlefield[0].uuid });
    engine.resolveTopOfStack();
    expect(state().currentPhase).toBe('gameOver');

    // Further mutation batches must not override the winner or revive the game.
    engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player2', amount: 20 }]);
    expect(state().currentPhase).toBe('gameOver');
    expect(state().winnerId).toBe('player1');
  });
});

describe('game-over action guards', () => {
  let room: GameRoom;

  beforeEach(() => {
    room = createTestRoom();
    registerAction('attack', attackHandler);
    registerAction('end_turn', endTurnHandler);
    // End the game: player2 at 0 life, winner player1.
    room.players['player2'].life = 0;
    room.currentPhase = 'gameOver';
    room.winnerId = 'player1';
    room.priorityPlayerId = null;
  });

  it('blocks casting/activation via ActionValidator once the game is over', () => {
    const card = room.players['player1'].hand[0];
    const result = ActionValidator.canActivate(room, 'player1', card, card.blueprint.castRequirements);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('already over');
  });

  it('blocks attacks once the game is over', () => {
    const creature = instantiateCard('empire-servant');
    creature.state.zone = 'battlefield';
    creature.state.ownerId = 'player1';
    creature.state.controllerId = 'player1';
    creature.state.summoningSickness = false;
    room.battlefield.push(creature);

    const result = attackHandler.validate(room, 'player1', { cardUuid: creature.uuid });
    expect(result.success).toBe(false);
    expect(result.reason).toContain('already over');
  });

  it('blocks ending the turn once the game is over', () => {
    const result = endTurnHandler.validate(room, 'player1', {});
    expect(result.success).toBe(false);
    expect(result.reason).toContain('already over');
  });
});