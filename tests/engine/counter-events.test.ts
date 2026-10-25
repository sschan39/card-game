import { afterEach, describe, expect, it } from 'vitest';
import { GameEngine } from '@engine/game-engine';
import { EffectRegistry } from '@engine/effect-registry';
import { normalizeCard } from '@library/card-parser';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';
import { registerReplacementOperation } from '@engine/replacement-rules';
import { captureSourceInformation } from '@engine/source-information';
import type { StackEffect, StackObject } from '@shared/effect.types';

declare module '@shared/proposed-event.types' {
  interface ReplacementOperationMap { test_counter_double: { type: 'test_counter_double' } }
}
const engines: GameEngine[] = [];
const cleanups: (() => void)[] = [];
afterEach(() => { engines.splice(0).forEach(engine => engine.dispose()); cleanups.splice(0).forEach(stop => stop()); });
function fixture(watch = true, initial = 0) {
  const source = creature('source', 'player1'); const target = creature('target', 'player2');
  target.state.counters.charge = initial;
  const observer = creature('observer', 'player1');
  observer.blueprint = normalizeCard({ id: 'counter-observer', cardTypes: ['Creature'], power: 2, toughness: 4,
    abilities: [{ id: 'own-placement', type: 'triggered', triggerCondition: 'ON_COUNTER_CHANGED',
      trigger: { subject: 'any', controller: 'self', condition: { all: [
        { op: 'eq', left: { path: 'event.payload.counterType' }, right: 'charge' },
        { op: 'gt', left: { path: 'event.payload.amount' }, right: 0 },
      ] } }, effectId: 'MODIFY_LIFE', params: { amount: 1 }, targeting: { type: 'self', required: false } }] });
  const engine = new GameEngine(createTestRoom({ battlefield: [source, target, ...(watch ? [observer] : [])] }));
  engine.initRoom(); engines.push(engine);
  const object: StackObject = { type: 'activated', uuid: 'counter-ability', source, controllerId: 'player1', countered: false, effects: [] };
  const change = (amount: number, action = 'ADD_COUNTER') => {
    const effect: StackEffect = { action, params: { amount, counterType: 'charge' }, tags: [],
      targeting: { type: 'permanent', required: true }, targets: [{ targetType: 'permanent', cardUuid: target.uuid, zoneRevision: 0 }] };
    return EffectRegistry[action](engine.roomState, object, effect);
  };
  return { engine, source, target, change };
}
const counterEvents = (engine: GameEngine) => engine.drainEventBatches().flatMap(batch => batch.events).filter(event => event.eventId === 'COUNTER_CHANGED');

describe('committed counter changes', () => {
  it('attributes placing counters on an opponent card to the effect controller and resolves its observer', () => {
    const { engine, source, target, change } = fixture(); const before = structuredClone(engine.roomState);
    engine.applyMutations(change(2));
    const events = counterEvents(engine);
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ card: { uuid: target.uuid }, controllerId: 'player1', targetControllerId: 'player2',
      source: source.uuid, counterType: 'charge', oldCount: 0, newCount: 2, amount: 2 });
    expect(engine.roomState.turnHistory?.counts.COUNTER_CHANGED).toBe(1);
    expect(engine.roomState.turnHistory?.playerCounts.player1.COUNTER_CHANGED).toBe(1);
    expect(before.battlefield.find(card => card.uuid === target.uuid)?.state.counters.charge).toBe(0);
    expect(engine.roomState.stack.map(object => object.ability?.id)).toEqual(['own-placement']);
    expect(engine.resolveTopOfStack().success).toBe(true);
    expect(engine.roomState.players.player1.life).toBe(21);
  });

  it('reports the actual clamped removal and does not trigger a placement observer', () => {
    const { engine, change } = fixture(true, 2);
    engine.applyMutations(change(7, 'REMOVE_COUNTER'));
    expect(counterEvents(engine)[0]?.payload).toMatchObject({ oldCount: 2, newCount: 0, amount: -2 });
    expect(engine.roomState.stack).toEqual([]);
  });

  it('keeps the ability controller as the actor if its source changes control before resolution', () => {
    const { engine, source, change } = fixture();
    // The ability was created under player1; its source is now controlled by player2.
    source.state.controllerId = 'player2';
    engine.applyMutations(change(1));
    const event = counterEvents(engine)[0];
    expect(event?.payload.controllerId).toBe('player1');
    expect(event?.payload.sourceInfo?.card.state.controllerId).toBe('player2');
    expect(engine.roomState.stack.map(object => object.ability?.id)).toEqual(['own-placement']);
  });

  it.each(['ADD_COUNTER', 'REMOVE_COUNTER'])('does not emit an event for unchanged %s', action => {
    const { engine, change } = fixture();
    engine.applyMutations(change(0, action));
    if (action === 'REMOVE_COUNTER') engine.applyMutations(change(3, action));
    expect(counterEvents(engine)).toEqual([]);
    expect(engine.roomState.stack).toEqual([]);
  });

  it('does not emit a counter event or discover an observer for a cancelled placement', () => {
    const { engine, change } = fixture();
    engine.roomState.replacementEffects = [{ id: 'cancel', label: 'Cancel counters', match: { kinds: ['counter_change'] }, operation: { type: 'cancel_event' } }];
    engine.applyMutations(change(2));
    expect(counterEvents(engine)).toEqual([]); expect(engine.roomState.stack).toEqual([]);
  });

  it('retains causal source through a serialized replacement decision and emits only its final change', () => {
    const stop = registerReplacementOperation('test_counter_double', { applies: (_room, event) => event.kind === 'counter_change',
      replace: (_room, event) => ({ events: event.kind === 'counter_change' ? [{ ...event, amount: event.amount * 2 }] : [event] }) });
    cleanups.push(stop);
    const { engine, change, source } = fixture(false);
    engine.roomState.replacementEffects = ['first', 'second'].map(id => ({ id, label: id, match: { kinds: ['counter_change'] }, operation: { type: 'test_counter_double' } }));
    engine.applyMutations(change(1));
    expect(engine.roomState.pendingChoice?.continuation.type).toBe('replacement');
    expect(counterEvents(engine)).toEqual([]);
    const recovered = new GameEngine(JSON.parse(JSON.stringify(engine.roomState))); recovered.initRoom(); engines.push(recovered);
    expect(recovered.executePlayerAction('player2', 'choose', { choiceId: recovered.roomState.pendingChoice!.id, choices: ['second'] }).success).toBe(true);
    expect(counterEvents(recovered)[0]?.payload).toMatchObject({ source: source.uuid, controllerId: 'player1', oldCount: 0, newCount: 4, amount: 4 });
  });

  it('does not invent a causal controller for a direct rules mutation', () => {
    const { engine, target } = fixture();
    engine.applyMutations([{ type: 'ADD_COUNTER', cardUuid: target.uuid, counterType: 'charge', amount: 1 }]);
    expect(counterEvents(engine)[0]?.payload.controllerId).toBeUndefined();
    expect(engine.roomState.stack).toEqual([]);
  });

  it('attributes damage-derived counter placement to its retained damage source', () => {
    const { engine, source, target } = fixture(false);
    source.blueprint = { ...source.blueprint, keywords: ['Wither'] };
    engine.applyMutations([{ type: 'APPLY_DAMAGE_BATCH', assignments: [{ source: captureSourceInformation(engine.roomState, source),
      recipient: { kind: 'permanent', cardUuid: target.uuid, zoneRevision: 0 }, amount: 1, combat: true }] }]);
    expect(counterEvents(engine)[0]?.payload).toMatchObject({ source: source.uuid, controllerId: 'player1',
      targetControllerId: 'player2', counterType: '-1/-1', oldCount: 0, newCount: 1, amount: 1 });
  });
});
