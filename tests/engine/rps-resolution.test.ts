// tests/engine/rps-resolution.test.ts
// Regression test for the RPS dead-end bug: the server prompted players to
// choose Rock/Paper/Scissors but no engine method accepted a choice, so a
// match could never leave the RPS phase. `GameEngine.submitRpsChoice` must
// record choices, resolve a winner (or a tie that re-prompts), and transition
// into the actual game on a non-tie.
import { describe, it, expect } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { instantiateCard } from '../../src/library/card-factory';
import type { GameRoom } from '../../src/types/game.room.types';

function createRpsRoom(): GameRoom {
  return {
    roomId: 'room-rps',
    player1Id: 'player1',
    player2Id: 'player2',
    players: {
      player1: { id: 'player1', life: 20, mana: { red: 0, blue: 0, green: 0, black: 0, white: 0, colorless: 0 }, deck: [], hand: [], graveyard: [] },
      player2: { id: 'player2', life: 20, mana: { red: 0, blue: 0, green: 0, black: 0, white: 0, colorless: 0 }, deck: [], hand: [], graveyard: [] },
    },
    currentPhase: 'RPS',
    previousPhase: null,
    activeTurnPlayerId: 'player1',
    priorityPlayerId: null,
    lastPassedPlayerId: null,
    battlefield: [],
    stack: [],
    rpsState: { status: 'pending', playedCards: {} },
    winnerId: null,
    combat: {},
  };
}

function makeEngine(room: GameRoom = createRpsRoom()): GameEngine {
  const engine = new GameEngine(room);
  // Wire trigger manager like the server does after room creation.
  engine.initRoom();
  return engine;
}

describe('GameEngine.submitRpsChoice (RPS dead-end regression)', () => {
  it('records a single player choice without resolving early', () => {
    const engine = makeEngine();
    const result = engine.submitRpsChoice('player1', 'rock');
    expect(result.success).toBe(true);
    expect(result.result?.winner).toBeUndefined();
    expect(engine.roomState.rpsState.playedCards['player1']).toBe('rock');
    expect(engine.roomState.currentPhase).toBe('RPS'); // still in RPS
  });

  it('rejects an unknown choice and a choice from a stranger', () => {
    const engine = makeEngine();
    expect(engine.submitRpsChoice('player1', 'dynamite').success).toBe(false);
    expect(engine.submitRpsChoice('intruder', 'rock').success).toBe(false);
    expect(engine.roomState.rpsState.playedCards['player1']).toBeUndefined();
  });

  it('resolves rock vs scissors with rock winning and starts the game', () => {
    const engine = makeEngine();
    engine.submitRpsChoice('player1', 'rock');
    const result = engine.submitRpsChoice('player2', 'scissors');
    expect(result.success).toBe(true);
    expect(result.result?.winner).toBe('player1');
    expect(engine.roomState.currentPhase).toBe('stateTurnStart'); // left RPS
    expect(engine.roomState.activeTurnPlayerId).toBe('player1'); // winner starts
    expect(engine.roomState.rpsState.status).toBe('resolved');
  });

  it('resolves scissors vs paper with scissors winning', () => {
    const engine = makeEngine();
    engine.submitRpsChoice('player1', 'scissors');
    const result = engine.submitRpsChoice('player2', 'paper');
    expect(result.success).toBe(true);
    expect(result.result?.winner).toBe('player1');
  });

  it('resolves paper vs rock with paper winning for the second player', () => {
    const engine = makeEngine();
    engine.submitRpsChoice('player1', 'rock');
    const result = engine.submitRpsChoice('player2', 'paper');
    expect(result.success).toBe(true);
    expect(result.result?.winner).toBe('player2');
    expect(engine.roomState.activeTurnPlayerId).toBe('player2');
  });

  it('handles a tie by staying in RPS and clearing both choices', () => {
    const engine = makeEngine();
    engine.submitRpsChoice('player1', 'rock');
    const result = engine.submitRpsChoice('player2', 'rock');
    expect(result.success).toBe(true);
    expect(result.result?.tie).toBe(true);
    expect(result.result?.winner).toBeUndefined();
    expect(engine.roomState.currentPhase).toBe('RPS'); // re-prompt
    expect(engine.roomState.rpsState.playedCards).toEqual({}); // cleared
  });

  it('lets players re-pick after a tie and still reach the game', () => {
    const engine = makeEngine();
    engine.submitRpsChoice('player1', 'paper');
    const tie = engine.submitRpsChoice('player2', 'paper');
    expect(tie.result?.tie).toBe(true);
    engine.submitRpsChoice('player1', 'rock');
    const final = engine.submitRpsChoice('player2', 'scissors');
    expect(final.result?.winner).toBe('player1');
    expect(engine.roomState.currentPhase).toBe('stateTurnStart');
  });

  it('ignores a duplicate choice from the same player before resolution', () => {
    const engine = makeEngine();
    engine.submitRpsChoice('player1', 'rock');
    const dup = engine.submitRpsChoice('player1', 'paper');
    expect(dup.success).toBe(false);
    expect(engine.roomState.rpsState.playedCards['player1']).toBe('rock');
  });

  it('draws one card for the winner at the start of their first turn', () => {
    // A real match starts with cards in each deck, so the winner's first
    // turn-start (which reaches stateTurnStart via this path) must draw.
    const room = createRpsRoom();
    room.players['player1'].deck.push(instantiateCard('empire-servant'));
    room.players['player1'].deck.push(instantiateCard('empire-servant'));
    const engine = makeEngine(room);
    engine.submitRpsChoice('player1', 'rock');
    const result = engine.submitRpsChoice('player2', 'scissors');
    expect(result.result?.winner).toBe('player1');
    expect(engine.roomState.players['player1'].deck.length).toBe(1); // 2 - 1 drawn
    expect(engine.roomState.players['player1'].hand.length).toBe(1); // 0 + 1 drawn
  });

  it('grants the winner priority when their first turn begins', () => {
    const engine = makeEngine();
    engine.submitRpsChoice('player1', 'rock');
    engine.submitRpsChoice('player2', 'scissors');
    // Without the turn-start priority grant, canActivate() would reject every
    // action with "You do not have priority" — the exact game lock transition()
    // warns about. The winner must hold priority entering stateTurnStart.
    expect(engine.roomState.priorityPlayerId).toBe('player1');
  });
});