import { describe, expect, it } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { captureSourceInformation } from '../../src/engine/source-information';
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

  it('uses the injected UUID source for generated choices and stack objects', () => {
    let calls = 0;
    const room = createTestRoom();
    const card = room.players.player1.hand[0];
    card.blueprint = {
      ...card.blueprint,
      modes: [{
        id: 'gain', label: 'Gain life',
        effects: [{ action: 'MODIFY_LIFE', params: { amount: 1 }, targeting: { type: 'self', required: false } }],
      }],
    };
    const engine = new GameEngine(room, { uuid: () => `runtime-${++calls}` });
    engine.initRoom();

    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid }).success).toBe(true);
    expect(engine.roomState.pendingChoice?.id).toMatch(/^runtime-/);
    expect(engine.executePlayerAction('player1', 'choose', {
      choiceId: engine.roomState.pendingChoice!.id,
      choices: ['gain'],
    }).success).toBe(true);
    expect(engine.roomState.stack[0].uuid).toMatch(/^runtime-/);
    engine.dispose();
  });

  it('uses the injected UUID source for delayed registrations and their triggers', () => {
    let calls = 0;
    const room = createTestRoom();
    const source = room.players.player1.hand.pop()!;
    source.state = { ...source.state, zone: 'battlefield', controllerId: 'player1' };
    room.battlefield = [source];
    const engine = new GameEngine(room, { uuid: () => `runtime-${++calls}` });
    engine.initRoom();

    engine.applyMutations([{ type: 'ADD_DELAYED_TRIGGER', registration: {
      id: '', source: structuredClone(source), sourceInfo: captureSourceInformation(room, source),
      controllerId: 'player1', lifetime: 'once',
      ability: {
        id: 'end', type: 'triggered', triggerCondition: 'END_OF_TURN', castSpeed: 'instant',
        effect: { action: 'MODIFY_LIFE', params: { amount: 1 }, targeting: { type: 'self', required: false } },
      },
    } }]);
    expect(engine.roomState.delayedTriggers?.[0].id).toMatch(/^runtime-/);

    engine.applyMutations([{ type: 'SET_PHASE', phase: 'stateEndPhase' }]);
    expect(engine.roomState.stack[0].uuid).toMatch(/^runtime-/);
    engine.dispose();
  });
});
