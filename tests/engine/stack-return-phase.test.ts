// tests/engine/stack-return-phase.test.ts
// Regression: when the last stack item resolves and the stack empties, the room
// must return to the phase it was in before the stack opened (previousPhase) and
// the active player must regain priority. Previously resolveTopOfStack() never
// performed this return, leaving the game stuck in phase 'Stack' with
// priorityPlayerId === null so every further action was rejected (deadlock).
import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { createTestRoom } from '../helpers/test-room-factory';
import { registerAction } from '../../src/engine/action-registry';
import { playCardHandler } from '../../src/engine/handlers/play-card-handler';
import { instantiateCard } from '../../src/library/card-factory';
import type { GameRoom } from '../../src/types/game.room.types';

describe('GameEngine stack-empty phase return', () => {
  let room: GameRoom;
  let engine: GameEngine;

  beforeEach(() => {
    room = createTestRoom({ currentPhase: 'stateMainPhase', priorityPlayerId: 'player1' });
    registerAction('cast_spell', playCardHandler);
    engine = new GameEngine(room);
    engine.initRoom();
  });

  it('casts a spell into the stack (phase -> Stack, previousPhase recorded)', () => {
    const card = engine.roomState.players['player1'].hand[0];
    const cast = engine.proposeAndStack('player1', 'cast_spell', { cardUuid: card.uuid });

    expect(cast.success).toBe(true);
    expect(engine.roomState.currentPhase).toBe('Stack');
    expect(engine.roomState.previousPhase).toBe('stateMainPhase');
    expect(engine.roomState.stack.length).toBe(1);
  });

  it('returns to the previous phase and restores priority when the stack empties', () => {
    const card = engine.roomState.players['player1'].hand[0];
    engine.proposeAndStack('player1', 'cast_spell', { cardUuid: card.uuid });

    const resolve = engine.resolveTopOfStack();
    expect(resolve.success).toBe(true);

    // Stack emptied.
    expect(engine.roomState.stack.length).toBe(0);

    // The game must return to the phase it was in before the stack opened.
    expect(engine.roomState.currentPhase).toBe('stateMainPhase');

    // The active player must regain priority so play can continue.
    expect(engine.roomState.priorityPlayerId).toBe('player1');
    expect(engine.roomState.previousPhase).toBeNull();
  });

  it('restores priority so the active player can act immediately after', () => {
    // Give player1 a second card so a follow-up cast is possible.
    const extra = instantiateCard('empire-servant');
    extra.state.zone = 'hand';
    extra.state.ownerId = 'player1';
    extra.state.controllerId = 'player1';
    engine.roomState.players['player1'].hand.push(extra);

    const card = engine.roomState.players['player1'].hand[0];
    engine.proposeAndStack('player1', 'cast_spell', { cardUuid: card.uuid });
    engine.resolveTopOfStack();

    // A follow-up action must succeed (previously rejected: no priority).
    const secondCard = engine.roomState.players['player1'].hand.find(c => c.uuid !== card.uuid)!;
    const second = engine.proposeAndStack('player1', 'cast_spell', { cardUuid: secondCard.uuid });
    expect(second.success).toBe(true);
  });
});