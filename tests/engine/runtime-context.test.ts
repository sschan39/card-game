import { describe, expect, it } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { createTestRoom } from '../helpers/test-room-factory';

describe('GameEngine runtime context', () => {
  it('uses one injected UUID source for implicit command and batch identities', () => {
    const ids = ['command-1', 'batch-1'];
    const engine = new GameEngine(createTestRoom(), { uuid: () => ids.shift()! });

    engine.withCommandContext('test', 'player1', () => {
      engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player1', amount: 19 }]);
    });

    const [batch] = engine.drainEventBatches();
    expect(batch.command?.commandId).toBe('command-1');
    expect(batch.batchId).toBe('batch-1');
    engine.dispose();
  });

  it('keeps caller-supplied command IDs without consuming a UUID', () => {
    let calls = 0;
    const engine = new GameEngine(createTestRoom(), { uuid: () => `generated-${++calls}` });

    engine.withCommandContext('test', 'player1', () => undefined, 'supplied-command');

    expect(calls).toBe(0);
    engine.dispose();
  });
});
