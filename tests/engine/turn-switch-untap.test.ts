// tests/engine/turn-switch-untap.test.ts
// Regression: ending a turn must switch the active player BEFORE the incoming
// player's untap/refill step. The old server flow ran stateTurnStart (untap/
// refill) first and switchTurn() after, so the OUTGOING player got untapped and
// refilled while the INCOMING player started their turn still tapped and dry.
//
// The fix introduces GameEngine.endTurn() which sequences:
//   stateEndPhase -> cleanupStep -> switchTurn -> stateTurnStart
// and server.ts delegates to it.
import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { ActionRegistry } from '../../src/engine/action-registry';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '../../src/library/card-factory';
import type { GameRoom } from '../../src/types/game.room.types';

describe('GameEngine.endTurn untap/refill order', () => {
  let room: GameRoom;
  let engine: GameEngine;

  function addControlledCreature(controllerId: 'player1' | 'player2'): string {
    const creature = instantiateCard('empire-servant');
    creature.state.zone = 'battlefield';
    creature.state.ownerId = controllerId;
    creature.state.controllerId = controllerId;
    creature.state.isTapped = true;            // permanent is tapped during opponent's turn
    creature.state.summoningSickness = false;
    room.battlefield.push(creature);
    return creature.uuid;
  }

  beforeEach(() => {
    Object.keys(ActionRegistry).forEach((k) => delete ActionRegistry[k]);
    room = createTestRoom();
    engine = new GameEngine(room);
    engine.initRoom();
    room.currentPhase = 'stateMainPhase';
  });

  it('switches the active player to the opponent when the turn ends', () => {
    const result = engine.endTurn();
    expect(result.mutations.length).toBeGreaterThan(0);
    expect(engine.roomState.activeTurnPlayerId).toBe('player2');
  });

  it('untaps the incoming player\'s permanents at the start of their turn', () => {
    addControlledCreature('player1');
    addControlledCreature('player2');

    engine.endTurn();

    expect(engine.roomState.activeTurnPlayerId).toBe('player2');
    const p2Card = engine.roomState.battlefield.find((c) => c.state.controllerId === 'player2')!;
    expect(p2Card).toBeDefined();
    expect(p2Card.state.isTapped).toBe(false);  // incoming player's creature untapped
  });

  it('refills (resets) the incoming player\'s mana pool', () => {
    const p2 = room.players['player2'];
    p2.mana = { red: 3, blue: 0, green: 0, black: 0, white: 0, colorless: 0 };
    // put a tapped player2 permanent so the untap step definitely runs
    addControlledCreature('player2');

    engine.endTurn();

    expect(engine.roomState.players['player2'].mana.red).toBe(0);
    expect(engine.roomState.players['player2'].mana.blue).toBe(0);
  });
});