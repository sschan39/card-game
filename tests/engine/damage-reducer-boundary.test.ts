import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { captureSourceInformation } from '@engine/source-information';
import type { DamageAssignment } from '@shared/damage.types';
import type { GameMutation } from '@shared/game-mutation.types';
import type { GameRoom } from '@shared/game.room.types';
import { createTestRoom } from '../helpers/test-room-factory';

type ReduceDamageBatch = (
  room: GameRoom,
  assignments: readonly DamageAssignment[],
  results?: GameMutation[],
) => GameRoom;

function playerDamage(room: GameRoom, playerId = 'player2'): DamageAssignment {
  const source = room.players.player1.hand[0];
  return {
    source: captureSourceInformation(room, source),
    recipient: { kind: 'player', playerId },
    amount: 1,
    combat: false,
  };
}

describe('damage reducer boundary', () => {
  it('owns ordered damage-result reduction in game-reducer', async () => {
    const reducerModule = await import('@engine/game-reducer');
    const reduceDamageBatch = (reducerModule as unknown as { reduceDamageBatch?: ReduceDamageBatch }).reduceDamageBatch;

    expect(reduceDamageBatch).toBeTypeOf('function');
    if (!reduceDamageBatch) return;

    const room = createTestRoom();
    const next = reduceDamageBatch(room, [playerDamage(room)], [
      { type: 'SET_LIFE', playerId: 'player2', amount: 10, replacementProcessed: true },
      { type: 'CHANGE_LIFE', playerId: 'player2', amount: 3, replacementProcessed: true },
    ]);

    expect(next.players.player2.life).toBe(13);
    expect(room.players.player2.life).toBe(20);
  });

  it('returns the original room when every assignment is invalid', async () => {
    const reducerModule = await import('@engine/game-reducer');
    const reduceDamageBatch = (reducerModule as unknown as { reduceDamageBatch?: ReduceDamageBatch }).reduceDamageBatch;

    expect(reduceDamageBatch).toBeTypeOf('function');
    if (!reduceDamageBatch) return;

    const room = createTestRoom();
    expect(reduceDamageBatch(room, [playerDamage(room, 'missing-player')])).toBe(room);
  });

  it('uses an explicit empty result list without planning default damage', async () => {
    const reducerModule = await import('@engine/game-reducer');
    const reduceDamageBatch = (reducerModule as unknown as { reduceDamageBatch?: ReduceDamageBatch }).reduceDamageBatch;

    expect(reduceDamageBatch).toBeTypeOf('function');
    if (!reduceDamageBatch) return;

    const room = createTestRoom();
    const next = reduceDamageBatch(room, [playerDamage(room)], []);

    expect(next).toBe(room);
    expect(next.players.player2.life).toBe(20);
  });

  it('keeps damage-service independent from game-reducer', () => {
    const source = readFileSync(resolve(process.cwd(), 'packages/engine/src/engine/damage-service.ts'), 'utf8');
    expect(source).not.toMatch(/from\s+['"]\.\/game-reducer['"]/);
  });
});
