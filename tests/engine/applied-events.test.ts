import { describe, expect, it, vi } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { EventBus } from '../../src/engine/event-bus';
import { StateMachine } from '../../src/engine/state-machine';
import { resolveEffects } from '../../src/engine/effect-resolver';
import { createTestRoom } from '../helpers/test-room-factory';
import type { StackObject } from '../../src/types/effect.types';
import { instantiateCard } from '../../src/library/card-factory';
import type { CardInstance } from '../../src/types/card.types';

function fixture() {
  const room = createTestRoom();
  const card = room.players.player1.hand.pop()!;
  card.state.zone = 'battlefield';
  card.state.damageTaken = 2;
  room.battlefield = [card];
  const engine = new GameEngine(room);
  return { room, card, engine, bus: (engine as unknown as { eventBus: EventBus }).eventBus };
}

describe('applied event batches', () => {
  it('retains no batch for assignments that do not change state', () => {
    const { engine } = fixture();
    engine.roomState.battlefield[0].state.damageTaken = 0;
    const before = engine.roomState;
    expect(engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player1', amount: 20 }])).toEqual([]);
    expect(engine.roomState).toBe(before);
    expect(engine.drainEventBatches()).toEqual([]);
  });

  it('retains simultaneous departing watchers and characteristic snapshots from the shared before-state', () => {
    const { room, card, engine } = fixture();
    card.state.damageTaken = 0;
    const base = instantiateCard('empire-servant');
    const watcher: CardInstance = { ...base,
      state: { ...base.state, zone: 'battlefield', ownerId: 'player1', controllerId: 'player1' },
      blueprint: { ...base.blueprint, abilities: [{
        type: 'triggered', triggerCondition: 'ON_DIE', castSpeed: 'instant',
        effect: { action: 'DRAW', params: { amount: 0 }, tags: [], targeting: { type: 'self', required: false } },
      }] },
    };
    room.battlefield.push(watcher);
    room.continuousEffectPool.push({ source: watcher.uuid, layer: 7, effect: { type: 'STAT_DELTA', power: 2, toughness: 2 }, scope: { cardTypes: ['Creature'] }, duration: 'WHILE_ON_BATTLEFIELD' });
    engine.initRoom();
    engine.applyMutations([card, watcher].map(permanent => ({ type: 'MOVE_CARD', cardUuid: permanent.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' })));
    const [departures, followup] = engine.drainEventBatches();
    const deaths = departures.events.filter(event => event.eventId === 'PERMANENT_DIED');
    expect(deaths.map(event => event.payload.snapshot.power)).toEqual([3, 3]);
    expect(engine.roomState.stack).toHaveLength(2);
    expect(followup.cause).toMatchObject({ kind: 'trigger', parentBatchId: departures.batchId, eventUuids: deaths.map(event => event.eventUuid) });
  });

  it('publishes resolution metadata after applying a fizzle without changing its source stack object', () => {
    const { card, engine, bus } = fixture();
    card.state.damageTaken = 0;
    const stackObj: StackObject = {
      uuid: 'trigger', type: 'triggered', source: card, controllerId: 'player1', countered: false,
      effects: [{ action: 'MODIFY_STATS', params: { damage: 3 }, tags: [],
        targeting: { type: 'permanent', required: true }, targets: [{ targetType: 'permanent', cardUuid: 'gone' }] }],
    };
    engine.roomState.stack.push(stackObj);
    const received: unknown[] = [];
    bus.on('STACK_ITEM_RESOLVED', event => {
      expect(engine.roomState.stack).toEqual([]);
      received.push(event.payload);
    });
    engine.resolveTopOfStack();
    expect(stackObj.fizzled).toBeUndefined();
    expect(received).toEqual([expect.objectContaining({ effectId: 'MODIFY_STATS', fizzled: true })]);
  });

  it('correlates every phase batch with one player command', () => {
    const { engine } = fixture();
    engine.roomState.battlefield[0].state.damageTaken = 0;
    expect(engine.executePlayerAction('player1', 'end_turn').success).toBe(true);
    const batches = engine.drainEventBatches();
    expect(batches.length).toBeGreaterThan(1);
    expect(new Set(batches.map(batch => batch.command?.commandId)).size).toBe(1);
    expect(batches.every(batch => batch.command?.action === 'end_turn')).toBe(true);
  });

  it('publishes the damage increment after the whole batch has committed', () => {
    const { card, engine, bus } = fixture();
    let lifeAtEvent = 0;
    let amount = 0;
    bus.on('DAMAGE_TAKEN', event => {
      lifeAtEvent = engine.roomState.players.player1.life;
      amount = event.payload.amount as number;
    });
    engine.applyMutations([
      { type: 'SET_DAMAGE', cardUuid: card.uuid, amount: 5 },
      { type: 'SET_LIFE', playerId: 'player1', amount: 19 },
    ]);
    expect(amount).toBe(3);
    expect(lifeAtEvent).toBe(19);
  });

  it('does not report damage when its total decreases or the mutation fails', () => {
    const { card, engine, bus } = fixture();
    const listener = vi.fn();
    bus.on('DAMAGE_TAKEN', listener);
    engine.applyMutations([{ type: 'SET_DAMAGE', cardUuid: card.uuid, amount: 0 }]);
    engine.applyMutations([{ type: 'SET_DAMAGE', cardUuid: 'missing', amount: 9 }]);
    expect(listener).not.toHaveBeenCalled();
  });

  it('uses one before-room for simultaneous departure snapshots', () => {
    const { room, card, engine } = fixture();
    engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' }]);
    const [batch] = engine.drainEventBatches();
    expect(batch.before).toBe(room);
    expect(batch.after.battlefield).toHaveLength(0);
    expect(batch.events.find(event => event.eventId === 'PERMANENT_DIED')?.payload).toMatchObject({
      snapshot: { card: { uuid: card.uuid, state: { damageTaken: 2 } } },
    });
    expect(batch.events.every(event => event.batchId === batch.batchId)).toBe(true);
    expect(engine.drainEventBatches()).toEqual([]);
  });

  it('keeps rejected commands out of the committed timeline', () => {
    const { engine } = fixture();
    expect(engine.executePlayerAction('player1', 'unknown').success).toBe(false);
    expect(engine.drainEventBatches()).toEqual([]);
  });

  it('does not publish phase or effect events during planning', () => {
    const { room, card, bus } = fixture();
    const emit = vi.spyOn(bus, 'emit');
    new StateMachine(room).advancePhase(room, 'complete');
    const stack: StackObject = { uuid: 'ability', type: 'triggered', source: card, controllerId: 'player1', countered: false, effects: [] };
    resolveEffects(room, stack);
    expect(emit).not.toHaveBeenCalled();
  });
});
