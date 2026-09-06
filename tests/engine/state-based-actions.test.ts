import { describe, it, expect, beforeEach } from 'vitest';
import { createTestRoom } from '../helpers/test-room-factory';
import { checkStateBasedActions } from '../../src/engine/state-based-actions';
import { gameReducer } from '../../src/engine/game-reducer';
import { instantiateCard } from '../../src/library/card-factory';
import type { GameRoom } from '../../src/types/game.room.types';
import type { GameMutation } from '../../src/types/game-mutation.types';

function apply(room: GameRoom, mutations: GameMutation[]): GameRoom {
  let r = room;
  for (const m of mutations) {
    r = gameReducer(r, m);
  }
  return r;
}

describe('checkStateBasedActions', () => {
  let room: GameRoom;

  beforeEach(() => {
    room = createTestRoom();
  });

  it('returns empty array when no creatures are damaged', () => {
    const creature = instantiateCard('empire-servant');
    creature.state.zone = 'battlefield';
    creature.state.ownerId = 'player1';
    creature.state.controllerId = 'player1';
    room.battlefield.push(creature);

    const result = checkStateBasedActions(room);
    expect(result).toEqual([]);
  });

  it('destroys a creature when damageTaken >= toughness', () => {
    const creature = instantiateCard('empire-servant'); // 1/1
    creature.state.zone = 'battlefield';
    creature.state.ownerId = 'player1';
    creature.state.controllerId = 'player1';
    creature.state.damageTaken = 1; // damageTaken (1) >= toughness (1)
    room.battlefield.push(creature);

    const result = checkStateBasedActions(room);
    expect(result.length).toBeGreaterThan(0);
    const destroyMutations = result.filter(m => m.type === 'MOVE_CARD' && m.from === 'battlefield' && m.to === 'graveyard');
    expect(destroyMutations.length).toBe(1);
    expect(destroyMutations[0]).toMatchObject({
      type: 'MOVE_CARD',
      cardUuid: creature.uuid,
      from: 'battlefield',
      to: 'graveyard',
    });
  });

  it('does not destroy a creature when damageTaken < toughness', () => {
    const creature = instantiateCard('empire-servant'); // 1/1
    creature.state.zone = 'battlefield';
    creature.state.ownerId = 'player1';
    creature.state.controllerId = 'player1';
    creature.state.damageTaken = 0;
    room.battlefield.push(creature);

    const result = checkStateBasedActions(room);
    const destroyMutations = result.filter(m => m.type === 'MOVE_CARD' && m.from === 'battlefield' && m.to === 'graveyard');
    expect(destroyMutations.length).toBe(0);
  });

  it('destroys multiple damaged creatures in one check', () => {
    const c1 = instantiateCard('empire-servant'); // 1/1
    c1.state.zone = 'battlefield';
    c1.state.ownerId = 'player1';
    c1.state.controllerId = 'player1';
    c1.state.damageTaken = 2;
    room.battlefield.push(c1);

    const c2 = instantiateCard('empire-servant'); // 1/1
    c2.state.zone = 'battlefield';
    c2.state.ownerId = 'player2';
    c2.state.controllerId = 'player2';
    c2.state.damageTaken = 1;
    room.battlefield.push(c2);

    const result = checkStateBasedActions(room);
    const destroyMutations = result.filter(m => m.type === 'MOVE_CARD' && m.from === 'battlefield' && m.to === 'graveyard');
    expect(destroyMutations.length).toBe(2);
  });

  it('returns game-over signal when a player has life <= 0', () => {
    room.players['player1'].life = 0;

    const result = checkStateBasedActions(room);
    const gameOverMutations = result.filter(m => m.type === 'SET_PHASE' && m.phase === 'gameOver');
    expect(gameOverMutations.length).toBe(1);
  });

  it('returns game-over signal when a player has negative life', () => {
    room.players['player2'].life = -5;

    const result = checkStateBasedActions(room);
    const gameOverMutations = result.filter(m => m.type === 'SET_PHASE' && m.phase === 'gameOver');
    expect(gameOverMutations.length).toBe(1);
  });

  it('does not return game-over when both players have positive life', () => {
    room.players['player1'].life = 20;
    room.players['player2'].life = 1;

    const result = checkStateBasedActions(room);
    const gameOverMutations = result.filter(m => m.type === 'SET_PHASE' && m.phase === 'gameOver');
    expect(gameOverMutations.length).toBe(0);
  });

  it('respects toughness from continuous effects (via CardCharacteristicService)', () => {
    const creature = instantiateCard('empire-servant'); // 1/1
    creature.state.zone = 'battlefield';
    creature.state.ownerId = 'player1';
    creature.state.controllerId = 'player1';
    creature.state.damageTaken = 2;
    room.battlefield.push(creature);

    // Add a continuous effect giving +0/+2 (toughness becomes 3)
    room.continuousEffectPool.push({
      source: 'emblem',
      layer: 7,
      effect: { type: 'STAT_DELTA', toughness: 2 },
      scope: { cardUuid: creature.uuid },
      duration: 'PERMANENT',
    });

    // damageTaken (2) < toughness (1 + 2 = 3) → should NOT be destroyed
    const result = checkStateBasedActions(room);
    const destroyMutations = result.filter(m => m.type === 'MOVE_CARD' && m.from === 'battlefield' && m.to === 'graveyard');
    expect(destroyMutations.length).toBe(0);
  });
});