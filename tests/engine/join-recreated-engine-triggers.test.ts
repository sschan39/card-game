import { describe, it, expect } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { registerAction } from '../../src/engine/action-registry';
import { playCardHandler } from '../../src/engine/handlers/play-card-handler';
import { createTestRoom } from '../helpers/test-room-factory';
import type { GameRoom } from '../../src/types/game.room.types';
import type { EffectDefinition } from '../../src/types/effect.types';

/**
 * Regression: server.ts joinRoom re-creates a fresh GameEngine once player2
 * joins. That fresh engine has its OWN EventBus, and the TriggerManager's ETB
 * listeners only subscribe when initRoom() is called. If the join path fails
 * to call initRoom(), PERMANENT_ENTERED triggers silently stop firing once the
 * real two-player game is underway.
 *
 * This test reproduces the exactly server lifecycle: create room + engine +
 * initRoom (player1), then re-create the engine after player2 joins, resolving a
 * creature with an onEnter effect, and asserts the ETB triggered stack fires.
 */
function recreateEngineAsJoinDoes(room: GameRoom, callInitRoom: boolean): GameEngine {
  // Mirrors server.ts joinRoom: `const engine = new GameEngine(room)` then,
  // with the fix, `engine.initRoom()`.
  const engine = new GameEngine(room);
  if (callInitRoom) engine.initRoom();
  return engine;
}

// Attach an ETB (enter-the-battlefield) effect to a card, as the game's
// creature cards would carry — same pattern as tests/engine/trigger-manager.test.ts.
function attachEnterEffect(card: { blueprint: { onEnterEffects?: unknown } }): void {
  (card.blueprint as { onEnterEffects?: EffectDefinition[] }).onEnterEffects = [
    { action: 'DRAW', params: { amount: 1 }, tags: [], targeting: { type: 'self', required: false } },
  ];
}

describe('joinRoom re-created engine wires ETB triggers (regression)', () => {
  it('restores ETB trigger firing after the engine is re-created on player2 join', () => {
    registerAction('cast_spell', playCardHandler);
    const room: GameRoom = createTestRoom();
    // empire-servant is in player1's hand; give it an onEnter effect and a
    // payable cast cost (players in createTestRoom have red:5 mana).
    const card = room.players.player1.hand[0];
    attachEnterEffect(card);
    card.blueprint.castRequirements.cost = { mana: { red: 1 }, tap: false, life: 0, discard: 0, sacrifice: false };

    // Player1 creates the room and starts the engine (initRoom called).
    const p1Engine = new GameEngine(room);
    p1Engine.initRoom();

    // ---- Player2 joins: server re-creates the engine on the shared room ----
    const joinEngine = recreateEngineAsJoinDoes(room, /* callInitRoom */ true);
    expect(p1Engine).toBeInstanceOf(GameEngine);

    // Put the card on the stack (as the play-card handler does) via this join engine.
    const proposeResult = joinEngine.proposeAndStack('player1', 'cast_spell', {
      cardUuid: card.uuid,
      stackUuid: 'join-etb-uuid',
    });
    expect(proposeResult.success).toBe(true);

    // First resolution: card leaves the stack and enters the battlefield,
    // emitting PERMANENT_ENTERED. If ETB triggers are wired, this pushes a
    // triggered StackObject back onto the stack.
    const resolveResult = joinEngine.resolveTopOfStack();
    expect(resolveResult.success).toBe(true);

    // The card is now on the battlefield...
    const onBattlefield = joinEngine.roomState.battlefield.find((c) => c.uuid === card.uuid);
    expect(onBattlefield).toBeDefined();

    // ...and its ETB effect produced a triggered stack object to resolve.
    const stack = joinEngine.roomState.stack;
    expect(stack.length).toBe(1);
    expect(stack[0].type).toBe('triggered');
    expect(stack[0].source.uuid).toBe(card.uuid);
    expect(stack[0].effects.some((e) => e.action === 'DRAW')).toBe(true);
  });

  it('documents the defect: without initRoom the ETB trigger is lost (no stack pushed)', () => {
    registerAction('cast_spell', playCardHandler);
    const room: GameRoom = createTestRoom();
    const card = room.players.player1.hand[0];
    attachEnterEffect(card);
    card.blueprint.castRequirements.cost = { mana: { red: 1 }, tap: false, life: 0, discard: 0, sacrifice: false };

    // Player1 create is irrelevant to the defect; the JOIN engine omits initRoom.
    const joinEngine = recreateEngineAsJoinDoes(room, /* callInitRoom */ false);

    const proposeResult = joinEngine.proposeAndStack('player1', 'cast_spell', {
      cardUuid: card.uuid,
      stackUuid: 'unwired-etb-uuid',
    });
    expect(proposeResult.success).toBe(true);

    const resolveResult = joinEngine.resolveTopOfStack();
    expect(resolveResult.success).toBe(true);

    // Card entered battlefield but NO triggered stack was produced upstream.
    expect(joinEngine.roomState.stack.length).toBe(0);
  });
});