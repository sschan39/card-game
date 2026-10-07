import { describe, it, expect, beforeEach } from 'vitest';
import { TriggerManager, discoverTriggers } from '../../src/engine/trigger-manager';
import { EventBus } from '../../src/engine/event-bus';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '../../src/library/card-factory';
import type { GameMutation } from '../../src/types/game-mutation.types';
import type { GameRoom } from '../../src/types/game.room.types';
import type { CardInstance, CardAbility } from '../../src/types/card.types';

/**
 * Instantiate a card with a per-test blueprint clone. The card factory caches
 * blueprints, so mutating `card.blueprint` directly would leak across tests.
 */
function makeCard(overrides: {
  abilities?: CardAbility[];
  onEnterEffects?: CardInstance['blueprint']['onEnterEffects'];
  controllerId?: string;
  zone?: CardInstance['state']['zone'];
} = {}): CardInstance {
  const card = instantiateCard('empire-servant');
  (card as any).blueprint = {
    ...card.blueprint,
    abilities: overrides.abilities ?? [],
    onEnterEffects: overrides.onEnterEffects,
  };
  card.state.zone = overrides.zone ?? 'battlefield';
  card.state.controllerId = overrides.controllerId ?? 'player1';
  card.state.ownerId = card.state.controllerId;
  return card;
}

function triggeredAbility(triggerCondition: string): CardAbility {
  return {
    type: 'triggered',
    triggerCondition,
    effect: { action: 'DRAW', params: { amount: 1 }, tags: [], targeting: { type: 'self', required: false } },
    castSpeed: 'instant',
  } as CardAbility;
}

describe('TriggerManager', () => {
  let room: GameRoom;
  let eventBus: EventBus;
  let collector: GameMutation[];

  beforeEach(() => {
    room = createTestRoom();
    eventBus = new EventBus(room.roomId);
    collector = [];
  });

  it('should push a triggered StackObject when PERMANENT_ENTERED fires with onEnterEffects', () => {
    new TriggerManager(eventBus, collector, () => 'triggered-uuid-1', () => room);

    const card = makeCard({
      onEnterEffects: [
        { action: 'DRAW', params: { amount: 1 }, tags: [], targeting: { type: 'self', required: false } },
      ],
    });
    room.battlefield.push(card);

    eventBus.emit({
      eventId: 'PERMANENT_ENTERED',
      roomId: room.roomId,
      payload: { card, controllerId: 'player1' },
    });

    expect(collector.length).toBe(1);
    const mutation = collector[0];
    expect(mutation.type).toBe('PUSH_STACK');
    if (mutation.type === 'PUSH_STACK') {
      const triggered = mutation.stackObject;
      expect(triggered.type).toBe('triggered');
      expect(triggered.uuid).toBe('triggered-uuid-1');
      expect(triggered.effects.length).toBe(1);
      expect(triggered.effects[0].action).toBe('DRAW');
    }
  });

  it('should not push a StackObject when card has no onEnterEffects', () => {
    new TriggerManager(eventBus, collector, () => 'triggered-uuid-2', () => room);

    const card = makeCard();
    room.battlefield.push(card);

    eventBus.emit({
      eventId: 'PERMANENT_ENTERED',
      roomId: room.roomId,
      payload: { card, controllerId: 'player1' },
    });

    expect(collector.length).toBe(0);
  });

  it('should auto-target self for effects with type=self', () => {
    new TriggerManager(eventBus, collector, () => 'triggered-uuid-3', () => room);

    const card = makeCard({
      controllerId: 'player2',
      onEnterEffects: [
        { action: 'DRAW', params: { amount: 1 }, tags: [], targeting: { type: 'self', required: false } },
      ],
    });
    room.battlefield.push(card);

    eventBus.emit({
      eventId: 'PERMANENT_ENTERED',
      roomId: room.roomId,
      payload: { card, controllerId: 'player2' },
    });

    expect(collector.length).toBe(1);
    const mutation = collector[0];
    expect(mutation.type).toBe('PUSH_STACK');
    if (mutation.type === 'PUSH_STACK') {
      const triggered = mutation.stackObject;
      expect(triggered.controllerId).toBe('player2');
      // Self-targeting auto-fills the controller as target
      expect(triggered.effects[0].targets.length).toBe(1);
      expect(triggered.effects[0].targets[0].targetType).toBe('player');
      expect(triggered.effects[0].targets[0].playerId).toBe('player2');
    }
  });

  it('should push a triggered StackObject when ATTACK_DECLARED fires with ON_ATTACK ability', () => {
    new TriggerManager(eventBus, collector, () => 'triggered-uuid-attack', () => room);

    const card = makeCard({ abilities: [triggeredAbility('ON_ATTACK')] });
    room.battlefield.push(card);

    eventBus.emit({
      eventId: 'ATTACK_DECLARED',
      roomId: room.roomId,
      payload: { card, controllerId: 'player1' },
    });

    expect(collector.length).toBe(1);
    const mutation = collector[0];
    expect(mutation.type).toBe('PUSH_STACK');
    if (mutation.type === 'PUSH_STACK') {
      expect(mutation.stackObject.type).toBe('triggered');
      expect(mutation.stackObject.effects[0].action).toBe('DRAW');
      // TriggeredStackObject.ability is populated for ON_ATTACK triggers
      expect(mutation.stackObject.ability).toBeDefined();
      expect(mutation.stackObject.ability?.type).toBe('triggered');
      expect(mutation.stackObject.ability?.triggerCondition).toBe('ON_ATTACK');
    }
  });

  it('should unregister all listeners after dispose()', () => {
    const manager = new TriggerManager(eventBus, collector, () => 'triggered-uuid-dispose', () => room);

    const card = makeCard({
      onEnterEffects: [
        { action: 'DRAW', params: { amount: 1 }, tags: [], targeting: { type: 'self', required: false } },
      ],
    });
    room.battlefield.push(card);

    // Before dispose: the listener fires and pushes a trigger.
    eventBus.emit({
      eventId: 'PERMANENT_ENTERED',
      roomId: room.roomId,
      payload: { card, controllerId: 'player1' },
    });
    expect(collector.length).toBe(1);

    // After dispose: the listener is gone, so no new triggers are pushed.
    manager.dispose(eventBus);
    collector.length = 0;
    eventBus.emit({
      eventId: 'PERMANENT_ENTERED',
      roomId: room.roomId,
      payload: { card, controllerId: 'player1' },
    });
    expect(collector.length).toBe(0);
  });

  it('should fire ON_DIE trigger when PERMANENT_DIED event is emitted', () => {
    new TriggerManager(eventBus, collector, () => 'triggered-uuid-die', () => room);

    const card = makeCard({ abilities: [triggeredAbility('ON_DIE')] });
    room.battlefield.push(card);

    eventBus.emit({
      eventId: 'PERMANENT_DIED',
      roomId: room.roomId,
      payload: { card, controllerId: 'player1' },
    });

    const pushMutations = collector.filter(m => m.type === 'PUSH_STACK');
    expect(pushMutations.length).toBe(1);
    const stackObj = (pushMutations[0] as any).stackObject;
    expect(stackObj.type).toBe('triggered');
    expect(stackObj.source.uuid).toBe(card.uuid);
  });

  it('should fire ON_DAMAGE_TAKEN trigger when DAMAGE_TAKEN event is emitted', () => {
    new TriggerManager(eventBus, collector, () => 'triggered-uuid-damage', () => room);

    const card = makeCard({ abilities: [triggeredAbility('ON_DAMAGE_TAKEN')] });
    room.battlefield.push(card);

    eventBus.emit({
      eventId: 'DAMAGE_TAKEN',
      roomId: room.roomId,
      payload: { card, controllerId: 'player1', amount: 3 },
    });

    const pushMutations = collector.filter(m => m.type === 'PUSH_STACK');
    expect(pushMutations.length).toBe(1);
  });

  // -- Watcher / global trigger tests (the refactor's core new capability) --

  it('should fire a watcher trigger when ANOTHER creature enters the battlefield', () => {
    new TriggerManager(eventBus, collector, () => 'triggered-uuid-watcher', () => room);

    // Watcher: a permanent already on the battlefield with ON_ENTER_BATTLEFIELD.
    const watcher = makeCard({ abilities: [triggeredAbility('ON_ENTER_BATTLEFIELD')], controllerId: 'player1' });
    room.battlefield.push(watcher);

    // The creature that enters (different card, different controller)
    const entering = makeCard({ controllerId: 'player2' });
    room.battlefield.push(entering);

    eventBus.emit({
      eventId: 'PERMANENT_ENTERED',
      roomId: room.roomId,
      payload: { card: entering, controllerId: 'player2' },
    });

    // The watcher (not the entering card) should have triggered
    const pushMutations = collector.filter(m => m.type === 'PUSH_STACK');
    expect(pushMutations.length).toBe(1);
    const stackObj = (pushMutations[0] as any).stackObject;
    expect(stackObj.source.uuid).toBe(watcher.uuid);
    expect(stackObj.controllerId).toBe('player1');
  });

  it('should fire BEGIN_UPKEEP triggers on UPKEEP_STARTED (card-less event)', () => {
    new TriggerManager(eventBus, collector, () => 'triggered-uuid-upkeep', () => room);

    const card = makeCard({ abilities: [triggeredAbility('BEGIN_UPKEEP')] });
    room.battlefield.push(card);

    // UPKEEP_STARTED carries no card — the old code dropped it entirely.
    eventBus.emit({
      eventId: 'UPKEEP_STARTED',
      roomId: room.roomId,
      payload: { currentPlayer: 'player1' },
    });

    const pushMutations = collector.filter(m => m.type === 'PUSH_STACK');
    expect(pushMutations.length).toBe(1);
    expect((pushMutations[0] as any).stackObject.source.uuid).toBe(card.uuid);
  });

  it('should fire ON_LIFE_GAIN triggers on LIFE_CHANGED (card-less event)', () => {
    new TriggerManager(eventBus, collector, () => 'triggered-uuid-life', () => room);

    const card = makeCard({ abilities: [triggeredAbility('ON_LIFE_GAIN')] });
    room.battlefield.push(card);

    eventBus.emit({
      eventId: 'LIFE_CHANGED',
      roomId: room.roomId,
      payload: { playerId: 'player1', newLife: 21 },
    });

    const pushMutations = collector.filter(m => m.type === 'PUSH_STACK');
    expect(pushMutations.length).toBe(1);
    expect((pushMutations[0] as any).stackObject.source.uuid).toBe(card.uuid);
  });

  it('should fire a watcher ON_DIE trigger when another creature dies', () => {
    new TriggerManager(eventBus, collector, () => 'triggered-uuid-watcher-die', () => room);

    // Watcher on the battlefield
    const watcher = makeCard({ abilities: [triggeredAbility('ON_DIE')], controllerId: 'player1' });
    room.battlefield.push(watcher);

    // The creature that dies (already removed from battlefield)
    const dead = makeCard({ controllerId: 'player2', zone: 'graveyard' });

    eventBus.emit({
      eventId: 'PERMANENT_DIED',
      roomId: room.roomId,
      payload: { card: dead, controllerId: 'player2' },
    });

    const pushMutations = collector.filter(m => m.type === 'PUSH_STACK');
    expect(pushMutations.length).toBe(1);
    expect((pushMutations[0] as any).stackObject.source.uuid).toBe(watcher.uuid);
  });

  // -- discoverTriggers (read-only discovery) --

  it('discoverTriggers returns pending triggers without touching the stack', () => {
    const card = makeCard({ abilities: [triggeredAbility('ON_ENTER_BATTLEFIELD')] });
    room.battlefield.push(card);

    const pending = discoverTriggers(
      { eventId: 'PERMANENT_ENTERED', roomId: room.roomId, payload: { card, controllerId: 'player1' } },
      { roomId: room.roomId, battlefield: room.battlefield },
    );

    expect(pending.length).toBe(1);
    expect(pending[0].source.uuid).toBe(card.uuid);
    expect(pending[0].controllerId).toBe('player1');
    expect(pending[0].ability?.triggerCondition).toBe('ON_ENTER_BATTLEFIELD');
    // Discovery is read-only: no stack mutations were produced.
    expect(collector.length).toBe(0);
  });

  it('discoverTriggers returns [] for an unmapped event', () => {
    const pending = discoverTriggers(
      { eventId: 'SOME_UNKNOWN_EVENT', roomId: room.roomId, payload: {} },
      { roomId: room.roomId, battlefield: room.battlefield },
    );
    expect(pending).toEqual([]);
  });

  // -- Regression: triggered abilities are NOT hardcoded to target their owner --

  it('honors an explicit opponent-player target instead of defaulting to the controller', () => {
    new TriggerManager(eventBus, collector, () => 'triggered-uuid-opponent', () => room);

    // "When this dies, deal 2 damage to target opponent" — the old
    // buildTriggeredEffects() hardcoded targets to the controller, so this
    // would have wrongly targeted player1 (the controller) instead of player2.
    const card = makeCard({
      controllerId: 'player1',
      abilities: [{
        type: 'triggered',
        triggerCondition: 'ON_DIE',
        effect: {
          action: 'MODIFY_LIFE',
          params: { amount: -2 },
          tags: ['damage'],
          targeting: { type: 'player', controller: 'opponent', required: true, minTargets: 1, maxTargets: 1 },
        },
        castSpeed: 'instant',
      } as CardAbility],
    });
    room.battlefield.push(card);

    eventBus.emit({
      eventId: 'PERMANENT_DIED',
      roomId: room.roomId,
      payload: { card, controllerId: 'player1' },
    });

    const pushMutations = collector.filter(m => m.type === 'PUSH_STACK');
    expect(pushMutations.length).toBe(1);
    const effect = (pushMutations[0] as any).stackObject.effects[0];
    // The effect must NOT be auto-targeted at the controller.
    expect(effect.targets).toEqual([]);
    // The targeting definition is preserved so revalidateTargets can decide
    // legality/fizzle at resolve time.
    expect(effect.targeting).toEqual({ type: 'player', controller: 'opponent', required: true, minTargets: 1, maxTargets: 1 });
    // Tags are preserved (the old builder dropped them).
    expect(effect.tags).toEqual(['damage']);
  });

  it('preserves tags and targeting for a self-targeted triggered ability', () => {
    new TriggerManager(eventBus, collector, () => 'triggered-uuid-self', () => room);

    const card = makeCard({
      controllerId: 'player1',
      abilities: [{
        type: 'triggered',
        triggerCondition: 'ON_DIE',
        effect: {
          action: 'DRAW',
          params: { amount: 1 },
          tags: ['draw'],
          targeting: { type: 'self', required: false },
        },
        castSpeed: 'instant',
      } as CardAbility],
    });
    room.battlefield.push(card);

    eventBus.emit({
      eventId: 'PERMANENT_DIED',
      roomId: room.roomId,
      payload: { card, controllerId: 'player1' },
    });

    const effect = (collector.filter(m => m.type === 'PUSH_STACK')[0] as any).stackObject.effects[0];
    expect(effect.targets).toEqual([{ targetType: 'player', playerId: 'player1' }]);
    expect(effect.tags).toEqual(['draw']);
    expect(effect.targeting).toEqual({ type: 'self', required: false });
  });

  // -- Triggering event is carried through for last-known info --

  it('carries the triggering event onto the stack object', () => {
    new TriggerManager(eventBus, collector, () => 'triggered-uuid-event', () => room);

    const card = makeCard({ abilities: [triggeredAbility('ON_DAMAGE_TAKEN')] });
    room.battlefield.push(card);

    eventBus.emit({
      eventId: 'DAMAGE_TAKEN',
      roomId: room.roomId,
      payload: { card, controllerId: 'player1', amount: 3 },
    });

    const stackObj = (collector.filter(m => m.type === 'PUSH_STACK')[0] as any).stackObject;
    expect(stackObj.triggeringEvent).toBeDefined();
    expect(stackObj.triggeringEvent.eventId).toBe('DAMAGE_TAKEN');
    // Last-known info (the damage amount) survives onto the stack object.
    expect(stackObj.triggeringEvent.payload.amount).toBe(3);
  });

  it('discoverTriggers attaches the event to each pending trigger', () => {
    const card = makeCard({ abilities: [triggeredAbility('ON_ENTER_BATTLEFIELD')] });
    room.battlefield.push(card);

    const pending = discoverTriggers(
      { eventId: 'PERMANENT_ENTERED', roomId: room.roomId, payload: { card, controllerId: 'player1' } },
      { roomId: room.roomId, battlefield: room.battlefield },
    );

    expect(pending.length).toBe(1);
    expect(pending[0].event.eventId).toBe('PERMANENT_ENTERED');
    expect(pending[0].event.payload.card).toBe(card);
  });
});