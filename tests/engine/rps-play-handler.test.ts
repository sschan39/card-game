import { describe, it, expect, beforeEach } from 'vitest';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '../../src/library/card-factory';
import { rpsPlayHandler } from '../../src/engine/handlers/rps-play-handler';
import { gameReducer } from '../../src/engine/game-reducer';
import type { GameMutation } from '../../src/types/game-mutation.types';
import type { GameRoom } from '../../src/types/game.room.types';

describe('rpsPlayHandler', () => {
  let room: GameRoom;

  /** Apply mutations through the pure reducer, committing to `room`. */
  function apply(mutations: GameMutation[]): void {
    for (const m of mutations) {
      room = gameReducer(room, m);
    }
  }

  /** Build an RPS room: phase=RPS, both hands hold rock/paper/scissors. */
  function makeRPSRoom(): GameRoom {
    const r = createTestRoom({
      currentPhase: 'RPS',
      rpsState: { status: 'pending', playedCards: {} },
    });
    r.players['player1'].hand = [];
    r.players['player2'].hand = [];
    for (const id of ['rock', 'paper', 'scissors']) {
      const c1 = instantiateCard(id);
      c1.state.zone = 'hand';
      c1.state.ownerId = 'player1';
      c1.state.controllerId = 'player1';
      r.players['player1'].hand.push(c1);

      const c2 = instantiateCard(id);
      c2.state.zone = 'hand';
      c2.state.ownerId = 'player2';
      c2.state.controllerId = 'player2';
      r.players['player2'].hand.push(c2);
    }
    return r;
  }

  beforeEach(() => {
    room = makeRPSRoom();
  });

  describe('validate', () => {
    it('rejects when not in RPS phase', () => {
      room.currentPhase = 'stateMainPhase';
      const result = rpsPlayHandler.validate(room, 'player1', { cardUuid: 'x' });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.phase).toBe('validate');
    });

    it('rejects when cardUuid is missing', () => {
      const result = rpsPlayHandler.validate(room, 'player1', {});
      expect(result.success).toBe(false);
    });

    it('rejects when card is not in hand', () => {
      const result = rpsPlayHandler.validate(room, 'player1', { cardUuid: 'nonexistent' });
      expect(result.success).toBe(false);
    });

    it('rejects when player already played', () => {
      room.rpsState.playedCards['player1'] = 'rock';
      const card = room.players['player1'].hand[0];
      const result = rpsPlayHandler.validate(room, 'player1', { cardUuid: card.uuid });
      expect(result.success).toBe(false);
    });

    it('rejects when card is not an RPS card', () => {
      const card = room.players['player1'].hand[0];
      const originalId = card.blueprint.id;
      // Mutating the shared cached blueprint would leak to other tests, so
      // restore it afterwards.
      card.blueprint.id = 'empire-servant';
      try {
        const result = rpsPlayHandler.validate(room, 'player1', { cardUuid: card.uuid });
        expect(result.success).toBe(false);
      } finally {
        card.blueprint.id = originalId;
      }
    });

    it('accepts a valid RPS play', () => {
      const card = room.players['player1'].hand[0];
      const result = rpsPlayHandler.validate(room, 'player1', { cardUuid: card.uuid });
      expect(result.success).toBe(true);
    });
  });

  describe('propose', () => {
    it('records the choice and moves the card to graveyard', () => {
      const card = room.players['player1'].hand[0];
      const result = rpsPlayHandler.propose(room, 'player1', { cardUuid: card.uuid });
      expect(result.success).toBe(true);
      if (!result.success) return;

      apply(result.mutations!);

      expect(room.rpsState.playedCards['player1']).toBe(card.blueprint.id);
      expect(room.players['player1'].hand.find(c => c.uuid === card.uuid)).toBeUndefined();
      expect(room.players['player1'].graveyard.find(c => c.uuid === card.uuid)).toBeDefined();
    });
  });
});