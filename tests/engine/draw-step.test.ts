// tests/engine/draw-step.test.ts
// Turn-start draw: entering stateTurnStart draws one card for the active player.
import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { StateMachine } from '../../src/engine/state-machine';
import { gameReducer } from '../../src/engine/game-reducer';
import { EventBus } from '../../src/engine/event-bus';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '../../src/library/card-factory';
import type { GameRoom } from '../../src/types/game.room.types';
import type { GameMutation } from '../../src/types/game-mutation.types';

describe('DRAW_CARD reducer', () => {
  function apply(room: GameRoom, muts: GameMutation[]): GameRoom {
    return muts.reduce((r, m) => gameReducer(r, m), room);
  }

  it('moves one card from deck to hand by default', () => {
    const room = createTestRoom();
    const card = instantiateCard('empire-servant');
    room.players['player1'].deck.push(card);
    const before = room.players['player1'].deck.length;

    const after = apply(room, [{ type: 'DRAW_CARD', playerId: 'player1' }]);
    expect(after.players['player1'].deck.length).toBe(before - 1);
    expect(after.players['player1'].hand.length).toBe(room.players['player1'].hand.length + 1);
    const drawn = after.players['player1'].hand[after.players['player1'].hand.length - 1];
    expect(drawn.uuid).toBe(card.uuid);
    expect(drawn.state.zone).toBe('hand');
  });

  it('draws the requested amount', () => {
    const room = createTestRoom();
    for (let i = 0; i < 3; i++) room.players['player1'].deck.push(instantiateCard('empire-servant'));
    const after = apply(room, [{ type: 'DRAW_CARD', playerId: 'player1', amount: 2 }]);
    expect(after.players['player1'].deck.length).toBe(1);
    expect(after.players['player1'].hand.length).toBe(room.players['player1'].hand.length + 2);
  });

  it('draws nothing from an empty deck', () => {
    const room = createTestRoom();
    const after = apply(room, [{ type: 'DRAW_CARD', playerId: 'player1', amount: 3 }]);
    expect(after.players['player1'].hand.length).toBe(room.players['player1'].hand.length);
    expect(after.players['player1'].deck.length).toBe(0);
  });

  it('clamps amount to available deck size', () => {
    const room = createTestRoom();
    room.players['player1'].deck.push(instantiateCard('empire-servant'));
    const after = apply(room, [{ type: 'DRAW_CARD', playerId: 'player1', amount: 5 }]);
    expect(after.players['player1'].deck.length).toBe(0);
  });
});

describe('stateTurnStart turn-start draw', () => {
  let room: GameRoom;
  let sm: StateMachine;

  beforeEach(() => {
    room = createTestRoom();
    room.players['player1'].deck.push(instantiateCard('empire-servant'));
    room.players['player2'].deck.push(instantiateCard('empire-servant'));
    room.players['player2'].deck.push(instantiateCard('empire-servant'));
    sm = new StateMachine(room, new EventBus(room.roomId));
  });

  function apply(room: GameRoom, muts: GameMutation[]): GameRoom {
    return muts.reduce((r, m) => gameReducer(r, m), room);
  }

  it('draws one card for the active player when entering stateTurnStart', () => {
    room.currentPhase = 'cleanupStep'; // cleanupStep → stateTurnStart is a legal transition
    const p1Before = room.players['player1'].deck.length;
    room = apply(room, sm.transition(room, 'stateTurnStart'));
    expect(room.players['player1'].deck.length).toBe(p1Before - 1);
    expect(room.players['player1'].hand.length).toBeGreaterThan(0);
  });

  it('endTurn draws for the incoming player after switching', () => {
    const engine = new GameEngine(room);
    engine.endTurn();
    // switchTurn made player2 the active player; entering stateTurnStart drew for player2.
    expect(engine.roomState.activeTurnPlayerId).toBe('player2');
    expect(engine.roomState.players['player2'].deck.length).toBe(1); // 2 - 1 drawn
    expect(engine.roomState.players['player2'].hand.length).toBe(1); // 0 + 1 drawn
  });

  it('does not draw when the deck is empty', () => {
    room.players['player1'].deck = [];
    const engine = new GameEngine(room);
    engine.endTurn();
    // player2 has cards; player1 (outgoing) unaffected by the player2 draw.
    expect(engine.roomState.players['player2'].hand.length).toBe(1);
  });
});