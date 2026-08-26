import { describe, it, expect, beforeEach } from 'vitest';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '../../src/library/card-factory';
import { rpsPlayHandler } from '../../src/engine/handlers/rps-play-handler';
import { gameReducer } from '../../src/engine/game-reducer';
import type { GameMutation } from '../../src/types/game-mutation.types';
import type { GameRoom } from '../../src/types/game.room.types';
import { resolveRPS } from '../../src/engine/room-factory';

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

describe('resolveRPS', () => {
  function roomWithChoices(c1: string, c2: string): GameRoom {
    const r = createTestRoom({
      currentPhase: 'RPS',
      rpsState: { status: 'pending', playedCards: { player1: c1, player2: c2 } },
    });
    // Populate each hand with the RPS cards NOT played (the played card is gone).
    const remaining1 = ['rock', 'paper', 'scissors'].filter(id => id !== c1);
    const remaining2 = ['rock', 'paper', 'scissors'].filter(id => id !== c2);
    r.players['player1'].hand = remaining1.map(id => {
      const card = instantiateCard(id);
      card.state.zone = 'hand';
      card.state.ownerId = 'player1';
      card.state.controllerId = 'player1';
      return card;
    });
    r.players['player2'].hand = remaining2.map(id => {
      const card = instantiateCard(id);
      card.state.zone = 'hand';
      card.state.ownerId = 'player2';
      card.state.controllerId = 'player2';
      return card;
    });
    return r;
  }

  it('player1 wins when rock beats scissors', () => {
    const room = roomWithChoices('rock', 'scissors');
    const mutations = resolveRPS(room);
    expect(mutations).toContainEqual({ type: 'SET_TURN', playerId: 'player1' });
    expect(mutations).toContainEqual({ type: 'SET_PHASE', phase: 'stateTurnStart' });
    expect(mutations).toContainEqual({ type: 'SET_RPS_STATUS', status: 'resolved' });
  });

  it('player2 wins when scissors beats paper', () => {
    const room = roomWithChoices('paper', 'scissors');
    const mutations = resolveRPS(room);
    expect(mutations).toContainEqual({ type: 'SET_TURN', playerId: 'player2' });
  });

  it('player2 wins when paper beats rock', () => {
    const room = roomWithChoices('rock', 'paper');
    const mutations = resolveRPS(room);
    expect(mutations).toContainEqual({ type: 'SET_TURN', playerId: 'player2' });
  });

  it('player1 wins on a tie', () => {
    const room = roomWithChoices('rock', 'rock');
    const mutations = resolveRPS(room);
    expect(mutations).toContainEqual({ type: 'SET_TURN', playerId: 'player1' });
  });

  it('discards all remaining RPS cards from both hands', () => {
    const room = roomWithChoices('rock', 'paper');
    // player1 still holds paper+scissors; player2 still holds rock+scissors
    const mutations = resolveRPS(room);
    const moveMutations = mutations.filter(m => m.type === 'MOVE_CARD');
    // 2 remaining in p1 hand + 2 remaining in p2 hand = 4
    expect(moveMutations.length).toBe(4);
  });
});