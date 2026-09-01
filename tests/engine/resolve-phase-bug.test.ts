// tests/engine/resolve-phase-bug.test.ts
// Regression test: resolveCurrentPhase must advance the turn cycle when both
// players pass during a phase that has never entered the Stack, instead of
// stalling the game by trying an invalid transition to stateMainPhase.
import { describe, it, expect, beforeEach } from 'vitest';
import { StateMachine } from '../../src/engine/state-machine';
import { EventBus } from '../../src/engine/event-bus';
import { gameReducer } from '../../src/engine/game-reducer';
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
    stack: [],
    rpsState: { status: 'pending', playedCards: {} },
  };
}

describe('StateMachine resolveCurrentPhase (phase-advance regression)', () => {
  let sm: StateMachine;
  let room: GameRoom;
  let bus: EventBus;

  function apply(mutations: GameMutation[]): void {
    for (const m of mutations) {
      room = gameReducer(room, m);
    }
  }

  /** Walk the turn cycle into the given phase without ever entering Stack. */
  function advanceTo(phase: 'stateDrawPhase' | 'stateMainPhase' | 'stateEndPhase'): void {
    apply(sm.transition(room, 'RPS'));
    apply(sm.transition(room, 'stateTurnStart'));
    if (phase === 'stateTurnStart') return;
    apply(sm.transition(room, 'stateDrawPhase'));
    if (phase === 'stateDrawPhase') return;
    apply(sm.transition(room, 'stateMainPhase'));
    if (phase === 'stateMainPhase') return;
    apply(sm.transition(room, 'stateBattlePhase'));
    apply(sm.transition(room, 'endCombat'));
    apply(sm.transition(room, 'stateEndPhase'));
  }

  beforeEach(() => {
    room = createTestRoom();
    bus = new EventBus('room-1');
    sm = new StateMachine(room, bus);
  });

  it('should advance stateDrawPhase → stateMainPhase when both players pass', () => {
    advanceTo('stateDrawPhase');
    apply(sm.givePriorityTo('player1'));
    apply(sm.passPriority(room, 'player1').mutations); // player1 passes → priority to player2
    apply(sm.passPriority(room, 'player2').mutations); // player2 passes → resolve

    // Phase must have advanced to the next step in the turn cycle.
    expect(room.currentPhase).toBe('stateMainPhase');
    // The active player must receive priority at the start of the new phase,
    // otherwise every subsequent action is rejected (the old behavior left
    // priority null and dead-locked the game until a re-grant that never came).
    expect(room.priorityPlayerId).toBe('player1');
  });

  it('should advance stateMainPhase → stateBattlePhase when both players pass', () => {
    advanceTo('stateMainPhase');
    apply(sm.givePriorityTo('player1'));
    apply(sm.passPriority(room, 'player1').mutations);
    apply(sm.passPriority(room, 'player2').mutations);

    expect(room.currentPhase).toBe('stateBattlePhase');
    expect(room.priorityPlayerId).toBe('player1');
  });

  it('should advance stateEndPhase → cleanupStep when both players pass (no stall)', () => {
    advanceTo('stateEndPhase'); // requires Battle phase in sequence
    apply(sm.givePriorityTo('player1'));
    apply(sm.passPriority(room, 'player1').mutations);
    apply(sm.passPriority(room, 'player2').mutations);

    expect(room.currentPhase).toBe('cleanupStep');
    // Active player keeps priority as the turn continues into the next step.
    expect(room.priorityPlayerId).toBe('player1');
  });

  it('should not leave the game stalled with priority cleared but phase unchanged', () => {
    advanceTo('stateEndPhase');
    apply(sm.givePriorityTo('player1'));
    const p1 = sm.passPriority(room, 'player1');
    expect(p1.success).toBe(true);
    apply(p1.mutations);
    const p2 = sm.passPriority(room, 'player2');
    expect(p2.success).toBe(true);
    apply(p2.mutations);

    // The phase must have moved; a null-previousPhase fallback bug would leave
    // the game stuck on the same phase with no priority player.
    expect(room.currentPhase).not.toBe('stateEndPhase');
    // And the active player must hold priority so the game remains playable.
    expect(room.priorityPlayerId).toBe('player1');
  });
});