import { describe, expect, it } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { EventBus } from '../../src/engine/event-bus';
import { createTestRoom } from '../helpers/test-room-factory';

function fixture() {
  const room = createTestRoom();
  const card = room.players.player1.hand[0];
  card.blueprint = structuredClone(card.blueprint);
  card.blueprint = { ...card.blueprint, onEnterEffects: [{ action: 'DRAW', params: { amount: 1 }, tags: [], targeting: { type: 'self', required: false } }] };
  const engine = new GameEngine(room);
  // Deliberately retain the original bus to prove removed managers cannot react.
  const bus = (engine as unknown as { eventBus: EventBus }).eventBus;
  const emit = () => bus.emit({ eventId: 'PERMANENT_ENTERED', roomId: room.roomId, payload: { card, controllerId: 'player1' } });
  return { engine, emit };
}

describe('engine lifecycle', () => {
  it('repeated initialization produces exactly one real trigger', () => {
    const { engine, emit } = fixture();
    engine.initRoom();
    engine.initRoom();
    emit();
    engine.applyMutations([]);
    expect(engine.roomState.stack).toHaveLength(1);
    expect(engine.roomState.stack[0].type).toBe('triggered');
  });

  it('repeated disposal removes all trigger listeners even after repeated init', () => {
    const { engine, emit } = fixture();
    engine.initRoom();
    engine.initRoom();
    engine.dispose();
    engine.dispose();
    emit();
    expect(engine.mutationCollector).toEqual([]);
  });

  it('a disposed engine cannot initialize another manager', () => {
    const { engine, emit } = fixture();
    engine.initRoom();
    emit();
    expect(engine.mutationCollector).toHaveLength(1);
    engine.dispose();
    engine.initRoom();
    emit();
    expect(engine.mutationCollector).toEqual([]);
  });
});
