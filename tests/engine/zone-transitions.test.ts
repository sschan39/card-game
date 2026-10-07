import { describe, expect, it, vi } from 'vitest';
import { gameReducer } from '../../src/engine/game-reducer';
import { GameEngine } from '../../src/engine/game-engine';
import { EventBus } from '../../src/engine/event-bus';
import { buildDynamicParams } from '../../src/engine/effect-resolver';
import { SyncService } from '../../src/server/sync-service';
import { applyDeltaChanges } from '../../src/client/store/deltaReducer';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '../../src/library/card-factory';
import type { SpellStackObject } from '../../src/types/effect.types';
import type { GameMutation } from '../../src/types/game-mutation.types';

function fixture() {
  const room = createTestRoom();
  const card = room.players.player1.hand[0];
  card.state = { ...card.state, zone: 'battlefield', damageTaken: 1, counters: { '+1/+1': 2 },
    isTapped: true, attackedThisTurn: true, summoningSickness: true, attachedTo: 'host', controllerId: 'player2' };
  room.players.player1.hand = [];
  room.battlefield = [card];
  return { room, card };
}

function spell(source: ReturnType<typeof instantiateCard>): SpellStackObject {
  return { type: 'spell', uuid: 'spell', source, controllerId: 'player2', effects: [], countered: false };
}

describe('central zone transitions', () => {
  it.each(['hand', 'graveyard', 'library'] as const)('resets active state when leaving for %s and preserves identity/information', to => {
    const { room, card } = fixture();
    const before = structuredClone(card.state);
    const next = gameReducer(room, { type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'battlefield', to });
    const moved = next.players.player1[to === 'library' ? 'deck' : to][0];
    expect(moved.uuid).toBe(card.uuid);
    expect(moved.blueprint).toBe(card.blueprint);
    expect(moved.state).toEqual({ zone: to, ownerId: 'player1', controllerId: 'player1',
      isTapped: false, damageTaken: 0, counters: {}, summoningSickness: false, attackedThisTurn: false });
    expect(card.state).toEqual(before);
    expect(next.battlefield).toEqual([]);
  });

  it('resets creature entry state, with explicit destination controller', () => {
    const { room, card } = fixture();
    const hand = gameReducer(room, { type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'battlefield', to: 'hand' });
    const entered = gameReducer(hand, { type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'hand', to: 'battlefield', controllerId: 'player2' });
    expect(entered.battlefield[0].state).toMatchObject({ controllerId: 'player2', summoningSickness: true, counters: {}, damageTaken: 0, isTapped: false });
  });

  it.each(['missing-player', 'wrong-source', 'same-zone', 'unsupported-zone', 'missing-stack', 'bad-index'])('does not lose/change a card for %s', kind => {
    const { room, card } = fixture();
    const move = { type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'battlefield', to: 'hand' } as GameMutation;
    if (kind === 'missing-player') move.playerId = 'missing';
    if (kind === 'wrong-source') move.from = 'hand';
    if (kind === 'same-zone') move.to = 'battlefield';
    if (kind === 'unsupported-zone') move.to = 'exile' as never;
    if (kind === 'missing-stack') move.to = 'stack';
    if (kind === 'bad-index') move.toIndex = -1;
    expect(gameReducer(room, move)).toBe(room);
  });

  it('moves into the spell stack atomically and preserves its controller on entry', () => {
    const room = createTestRoom();
    const card = room.players.player1.hand[0];
    card.state.counters = { stale: 4 };
    const stacked = gameReducer(room, { type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'hand', to: 'stack', stackObject: spell(card) });
    expect(stacked.players.player1.hand).toHaveLength(0);
    expect(stacked.stack).toHaveLength(1);
    expect(stacked.stack[0].source.state).toMatchObject({ zone: 'stack', controllerId: 'player2', counters: {} });
    const entered = gameReducer(stacked, { type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'stack', to: 'battlefield' });
    expect(entered.stack).toHaveLength(0);
    expect(entered.battlefield[0].state).toMatchObject({ ownerId: 'player1', controllerId: 'player2', summoningSickness: true });
  });

  it('does not move an ability source snapshot as a physical stack card', () => {
    const { room, card } = fixture();
    room.stack = [{ type: 'triggered', uuid: 'trigger', source: card, controllerId: 'player2', effects: [], countered: false }];
    expect(gameReducer(room, { type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'stack', to: 'hand' })).toBe(room);
  });

  it('honors insertion index in the destination array', () => {
    const { room, card } = fixture();
    room.players.player1.hand = [instantiateCard('land-red')];
    const next = gameReducer(room, { type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'battlefield', to: 'hand', toIndex: 0 });
    expect(next.players.player1.hand.map(c => c.uuid)).toEqual([card.uuid, room.players.player1.hand[0].uuid]);
  });

  it('retains pre-reset controller, state and calculated P/T for departure triggers', () => {
    const { room, card } = fixture();
    card.blueprint = { ...card.blueprint, abilities: [{ type: 'triggered', triggerCondition: 'ON_DIE', castSpeed: 'instant',
      effect: { action: 'DRAW', params: { amount: 1, power: 'DYNAMIC:source.power' }, tags: [], targeting: { type: 'self' } } }] };
    room.continuousEffectPool = [{ source: card.uuid, layer: 7, effect: { type: 'STAT_DELTA', power: 4 }, scope: {}, duration: 'WHILE_ON_BATTLEFIELD' }];
    const engine = new GameEngine(room);
    engine.initRoom();
    try {
      engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' }]);
      const trigger = engine.roomState.stack[0];
      expect(trigger.controllerId).toBe('player2');
      const snapshot = trigger.type === 'triggered' ? trigger.triggeringEvent?.payload.snapshot : undefined;
      expect(snapshot).toMatchObject({ power: 7, toughness: 3, card: { state: { zone: 'battlefield', damageTaken: 1, counters: { '+1/+1': 2 } } } });
      expect(engine.roomState.players.player1.graveyard[0].state.counters).toEqual({});
      expect(buildDynamicParams(engine.roomState, trigger, trigger.effects[0]).power).toBe(7);
      card.state.counters['+1/+1'] = 99;
      expect(snapshot.card.state.counters).toEqual({ '+1/+1': 2 });
    } finally { engine.dispose(); }
  });

  it('emits leave without death on bounce and no events/housekeeping for a failed move', () => {
    const { room, card } = fixture();
    room.continuousEffectPool = [{ source: card.uuid, layer: 7, effect: { type: 'STAT_DELTA', power: 4 }, scope: {}, duration: 'WHILE_ON_BATTLEFIELD' }];
    const engine = new GameEngine(room);
    const bus = (engine as unknown as { eventBus: EventBus }).eventBus;
    const events = vi.spyOn(bus, 'emit');
    engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'missing', from: 'battlefield', to: 'hand' }]);
    expect(events).not.toHaveBeenCalled();
    expect(engine.roomState.continuousEffectPool).toHaveLength(1);
    engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'battlefield', to: 'hand' }]);
    expect(events.mock.calls.map(([event]) => event.eventId)).toContain('PERMANENT_LEFT');
    expect(events.mock.calls.map(([event]) => event.eventId)).not.toContain('PERMANENT_DIED');
    engine.dispose();
  });

  it('ETB information is the reset battlefield instance', () => {
    const room = createTestRoom();
    const card = room.players.player1.hand[0];
    card.state = { ...card.state, zone: 'stack', damageTaken: 1, counters: { stale: 9 } };
    room.players.player1.hand = [];
    const object = spell(card);
    room.stack = [object];
    const events: unknown[] = [];
    const engine = new GameEngine(room);
    const bus = (engine as unknown as { eventBus: EventBus }).eventBus;
    bus.on('PERMANENT_ENTERED', event => events.push(event.payload.card));
    engine.resolveTopOfStack();
    expect(events[0]).toMatchObject({ uuid: card.uuid, state: { zone: 'battlefield', counters: {}, damageTaken: 0, summoningSickness: true } });
  });

  it('replays reset moves and atomic spell insertion identically on the client', () => {
    const { room, card } = fixture();
    const moves: GameMutation[] = [
      { type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'battlefield', to: 'hand' },
      { type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'hand', to: 'stack', stackObject: spell(card) },
      { type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'stack', to: 'battlefield' },
    ];
    const service = new SyncService({} as never, 'unused');
    const delta = service.buildDelta(room, moves, { action: 'debug', playerId: 'player1' });
    expect(applyDeltaChanges(room, delta.changes)).toEqual(moves.reduce(gameReducer, room));
  });
});
