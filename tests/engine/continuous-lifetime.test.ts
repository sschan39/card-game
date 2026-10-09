import { describe, expect, it } from 'vitest';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';
import { gameReducer } from '../../src/engine/game-reducer';
import { EffectRegistry } from '../../src/engine/effect-registry';
import { CardCharacteristicService as service } from '../../src/engine/card-characteristic-service';
import { captureSourceInformation } from '../../src/engine/source-information';
import type { GameMutation } from '../../src/types/game-mutation.types';
import { GameEngine } from '../../src/engine/game-engine';
import { SyncService } from '../../src/server/sync-service';
import { applyDeltaChanges } from '../../src/client/store/deltaReducer';

describe('continuous effect lifetime', () => {
  it('freezes ordinary resolved scopes on battlefield objects unless another zone is declared', () => {
    let room = createTestRoom(); const target = creature('target', 'player1'), hand = creature('hand', 'player1'); hand.state.zone = 'hand';
    room.battlefield = [target]; room.players.player1.hand = [hand];
    room = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry: { source: 'global', origin: 'resolved', layer: 7,
      effect: { type: 'STAT_DELTA', power: 2 }, scope: { cardTypes: ['Creature'] }, duration: 'PERMANENT' } });
    expect(service.resolvePower(room, target)).toBe(4);
    expect(service.resolvePower(room, hand)).toBe(2);
    room = gameReducer(room, { type: 'MOVE_CARD', cardUuid: hand.uuid, playerId: 'player1', from: 'hand', to: 'battlefield' });
    expect(service.resolvePower(room, room.battlefield.find(c => c.uuid === hand.uuid)!)).toBe(2);
  });
  it('removes only expired source-dependent IDs and replays individual removals through client deltas', () => {
    const room = createTestRoom(), target = creature('target', 'player1'), source = creature('source', 'player1'); room.battlefield = [target, source];
    const engine = new GameEngine(room); engine.initRoom();
    try {
      engine.applyMutations([{ type: 'ADD_CONTINUOUS_EFFECT', entry: { source: source.uuid, requiredZone: null, origin: 'resolved', layer: 7,
        effect: { type: 'STAT_DELTA', power: 1 }, scope: { cardUuid: target.uuid }, duration: 'END_OF_TURN' } },
        { type: 'ADD_CONTINUOUS_EFFECT', entry: { source: source.uuid, origin: 'static', layer: 7,
          effect: { type: 'STAT_DELTA', power: 2 }, scope: { cardUuid: target.uuid }, duration: 'WHILE_ON_BATTLEFIELD' } }]);
      let before = structuredClone(engine.roomState); const independentId = before.continuousEffectPool[0].id!;
      const mutations = engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' }]);
      expect(engine.roomState.continuousEffectPool.map(e => e.id)).toEqual([independentId]);
      const sync = new SyncService({} as never);
      expect(applyDeltaChanges(before, sync.buildDelta(before, mutations, { action: 'test', playerId: 'player1' }).changes)).toEqual(engine.roomState);
      before = structuredClone(engine.roomState);
      const removed = engine.applyMutations([{ type: 'REMOVE_CONTINUOUS_EFFECT', id: independentId }]);
      expect(engine.roomState.continuousEffectPool).toEqual([]);
      expect(applyDeltaChanges(before, sync.buildDelta(before, removed, { action: 'test', playerId: 'player1' }).changes)).toEqual(engine.roomState);
    } finally { engine.dispose(); }
  });
  it('honors source-dependent durations on generic resolved effects', () => {
    let room = createTestRoom(); const target = creature('target', 'player1'), source = creature('source', 'player1'); room.battlefield = [target, source];
    const object = { uuid: 'ability', type: 'activated', controllerId: 'player1', source } as any;
    for (const mutation of EffectRegistry.CREATE_CONTINUOUS_EFFECT(room, object, { action: 'CREATE_CONTINUOUS_EFFECT', params: { effect: { type: 'STAT_DELTA', power: 2 }, duration: 'WHILE_ON_BATTLEFIELD' }, tags: [], targets: [{ targetType: 'permanent', cardUuid: target.uuid }] })) room = gameReducer(room, mutation);
    expect(service.resolvePower(room, target)).toBe(4);
    room = gameReducer(room, { type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' });
    expect(service.resolvePower(room, target)).toBe(2);
  });
  it('defaults generic effects with no duration to permanent', () => {
    const room = createTestRoom(), source = creature('source', 'player1'); room.battlefield = [source];
    const mutations = EffectRegistry.CREATE_CONTINUOUS_EFFECT(room, { uuid: 'ability', type: 'activated', controllerId: 'player1', source } as any,
      { action: 'CREATE_CONTINUOUS_EFFECT', params: { effect: { type: 'STAT_DELTA', power: 2 } }, tags: [], targets: [{ targetType: 'permanent', cardUuid: source.uuid }] });
    expect(mutations[0]).toMatchObject({ entry: { duration: 'PERMANENT' } });
  });
  it('defaults explicit resolved effects to independence while retaining explicit source dependencies', () => {
    let room = createTestRoom(); const target = creature('target', 'player1'), source = creature('source', 'player1'); room.battlefield = [target, source];
    for (const requiredZone of [undefined, 'battlefield'] as const) room = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry: {
      source: source.uuid, origin: 'resolved', requiredZone, scope: { cardUuid: target.uuid }, layer: 7, duration: 'END_OF_TURN', effect: { type: 'STAT_DELTA', power: 2 } } });
    expect(service.resolvePower(room, target)).toBe(6);
    room = gameReducer(room, { type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' });
    expect(service.resolvePower(room, target)).toBe(4);
    room = gameReducer(room, { type: 'CLEAR_END_OF_TURN_EFFECTS' });
    expect(service.resolvePower(room, target)).toBe(2);
  });
  it('does not bind an old self source reference to its new incarnation', () => {
    let room = createTestRoom(); const card = creature('source', 'player1'); card.state.zoneRevision = 2; room.battlefield = [card];
    room = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry: { source: card.uuid, sourceRevision: 0, requiredZone: null, origin: 'resolved',
      scope: { self: true }, layer: 7, duration: 'PERMANENT', effect: { type: 'STAT_DELTA', power: 4 } } });
    expect(service.resolvePower(room, card)).toBe(2);
  });
  it('timestamps static sources in other zones by entry time across players', () => {
    let room = createTestRoom(); const target = creature('target', 'player1'); room.battlefield = [target];
    const first = creature('first', 'player2'), second = creature('second', 'player1');
    for (const [source, power] of [[first, 3], [second, 5]] as const) {
      source.state.zone = 'hand'; Object.assign(source, { blueprint: { ...source.blueprint, abilities: [{ id: 'size', type: 'static', activeZones: ['graveyard'],
        effects: [{ layer: 7, effect: { type: 'SET_STATS', power, toughness: power }, scope: { cardUuid: target.uuid } }] }] } });
      room.players[source.state.ownerId].hand.push(source);
      room = gameReducer(room, { type: 'MOVE_CARD', cardUuid: source.uuid, playerId: source.state.ownerId, from: 'hand', to: 'graveyard' });
    }
    expect(service.resolvePower(room, target)).toBe(5);
  });
  it('retains copiable last-known values separately from counters and later layers', () => {
    let room = createTestRoom(); const card = creature('source', 'player1', 2, 2); card.state.counters['+1/+1'] = 1; room.battlefield = [card];
    room = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry: { source: 'global', requiredZone: null, scope: { cardUuid: card.uuid }, layer: 7, duration: 'PERMANENT', effect: { type: 'STAT_DELTA', power: 3 } } });
    const snapshot = captureSourceInformation(room, card);
    room = gameReducer(room, { type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' });
    expect(service.resolveCopiableBlueprint(room, snapshot.card).power).toBe(2);
  });
  it('assigns distinct IDs to effects with equal timestamps', () => {
    let room = createTestRoom();
    const entry = { timestamp: 3, source: 'global', layer: 7, effect: { type: 'STAT_DELTA' as const, power: 1 }, scope: {}, duration: 'PERMANENT' as const };
    room = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry });
    room = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry });
    expect(new Set(room.continuousEffectPool.map(e => e.id)).size).toBe(2);
    room = gameReducer(room, { type: 'REMOVE_CONTINUOUS_EFFECT', id: room.continuousEffectPool[0].id! });
    expect(room.continuousEffectPool).toHaveLength(1);
  });
  it('snapshots a resolving expression independently of later board and source-controller changes', () => {
    let room = createTestRoom(); const card = creature('subject', 'player1'); const source = creature('source', 'player1'); room.battlefield = [card, source];
    room = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry: { source: source.uuid, sourceControllerId: 'player1', origin: 'resolved', requiredZone: null,
      scope: { cardUuid: card.uuid }, layer: 7, duration: 'PERMANENT', effect: { type: 'STAT_DELTA', power: { count: { zones: ['battlefield'], controller: 'self' } } } } });
    room = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry: { source: 'global', requiredZone: null, scope: { cardUuid: source.uuid }, layer: 2, duration: 'PERMANENT', effect: { type: 'CONTROL', controllerId: 'player2' } } });
    room.battlefield.push(creature('later', 'player1'));
    expect(service.resolvePower(room, card)).toBe(4);
  });
  it('assigns unique IDs and monotonic timestamps, and removes one effect independently', () => {
    let room = createTestRoom(); const card = creature('subject', 'player1'); room.battlefield = [card];
    const entry = { source: card.uuid, layer: 7, effect: { type: 'STAT_DELTA' as const, power: 1 }, scope: { cardUuid: card.uuid }, requiredZone: null, duration: 'PERMANENT' as const };
    room = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry });
    room = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry });
    const [a, b] = room.continuousEffectPool;
    expect(a.id).toBeTypeOf('string'); expect(b.id).not.toBe(a.id);
    expect(b.timestamp).toBeGreaterThan(a.timestamp!);
    room = gameReducer(room, { type: 'REMOVE_CONTINUOUS_EFFECT', id: a.id } as unknown as GameMutation);
    expect(room.continuousEffectPool.map(e => e.id)).toEqual([b.id]);
    room = gameReducer(room, { type: 'CLEAR_END_OF_TURN_EFFECTS' });
    room = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry });
    expect(room.continuousEffectPool.at(-1)!.timestamp).toBeGreaterThan(b.timestamp!);
  });

  it('captures resolved affected objects while preserving effects after source departure', () => {
    let room = createTestRoom(); const card = creature('subject', 'player1'); const source = creature('source', 'player1');
    room.battlefield = [card, source];
    const object = { uuid: 'spell', type: 'activated', controllerId: 'player1', source } as any;
    const mutations = EffectRegistry.GRANT_STATS(room, object, { action: 'GRANT_STATS', tags: [], params: { power: 2 }, targets: [{ targetType: 'permanent', all: true, cardTypes: ['Creature'], controller: 'self' }] });
    for (const mutation of mutations) room = gameReducer(room, mutation);
    const later = creature('later', 'player1'); room.battlefield.push(later);
    expect(service.resolvePower(room, card)).toBe(4);
    expect(service.resolvePower(room, later)).toBe(2);
    room = gameReducer(room, { type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' });
    expect(service.resolvePower(room, card)).toBe(4);
    room = gameReducer(room, { type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'battlefield', to: 'hand' });
    room = gameReducer(room, { type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'hand', to: 'battlefield' });
    expect(service.resolvePower(room, room.battlefield.find(c => c.uuid === card.uuid)!)).toBe(2);
  });

  it('old dependent entries do not revive when their source returns', () => {
    let room = createTestRoom(); const card = creature('subject', 'player1'); const source = creature('source', 'player1'); room.battlefield = [card, source];
    room = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry: { source: source.uuid, layer: 7, effect: { type: 'STAT_DELTA', power: 3 }, scope: { cardUuid: card.uuid }, duration: 'WHILE_ON_BATTLEFIELD' } });
    expect(service.resolvePower(room, card)).toBe(5);
    room = gameReducer(room, { type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' });
    room = gameReducer(room, { type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'graveyard', to: 'battlefield' });
    expect(service.resolvePower(room, card)).toBe(2);
  });

  it('provides generic stat setting and continuous creation primitives', () => {
    let room = createTestRoom(); const card = creature('subject', 'player1'); room.battlefield = [card];
    const object = { uuid: 'ability', type: 'activated', controllerId: 'player1', source: card } as any;
    expect(EffectRegistry.SET_STATS).toBeTypeOf('function');
    for (const mutation of EffectRegistry.SET_STATS(room, object, { action: 'SET_STATS', params: { power: 5, toughness: 6 }, tags: [], targets: [{ targetType: 'permanent', cardUuid: card.uuid }] })) room = gameReducer(room, mutation);
    expect([service.resolvePower(room, card), service.resolveToughness(room, card)]).toEqual([5, 6]);
    expect(EffectRegistry.CREATE_CONTINUOUS_EFFECT).toBeTypeOf('function');
    for (const mutation of EffectRegistry.CREATE_CONTINUOUS_EFFECT(room, object, { action: 'CREATE_CONTINUOUS_EFFECT', params: { effect: { type: 'ABILITY', addKeywords: ['Flying'] }, duration: 'PERMANENT' }, tags: [], targets: [{ targetType: 'permanent', cardUuid: card.uuid }] })) room = gameReducer(room, mutation);
    expect(service.resolveKeywords(room, card)).toEqual(['Flying']);
    const restored = JSON.parse(JSON.stringify(room));
    expect(service.resolve(restored, restored.battlefield[0])).toEqual(service.resolve(room, card));
  });
});
