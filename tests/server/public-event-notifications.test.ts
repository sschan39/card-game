import { afterEach, expect, it } from 'vitest';
import { SyncService } from '@server/rooms/sync-service';
import { GameEngine } from '@engine/game-engine';
import { createTestRoom, fillTestLibraries } from '../helpers/test-room-factory';
import { instantiateCard } from '@library/card-factory';
import { captureSourceInformation } from '@engine/source-information';
import { buildStackEffects } from '@engine/effect-resolver';
import { useGameStore } from '@client/store/gameStore';
import type { AppliedEventBatch } from '@shared/game-event.types';
const engines: GameEngine[] = [];
afterEach(() => engines.splice(0).forEach(engine => engine.dispose()));

it('projects immediate summaries for both viewers without exposing the triggering draw card or internal batches', () => {
  const room = createTestRoom(); fillTestLibraries(room);
  const source = instantiateCard('strong-ignition-wolf'); source.state = { ...source.state, zone: 'battlefield', ownerId: 'player1', controllerId: 'player1' }; room.battlefield = [source];
  const hidden = room.players.player1.deck[0];
  const ability = source.blueprint.abilities.find(ability => ability.type === 'triggered')!;
  if (ability.type !== 'triggered') throw new Error('Expected trigger');
  const object = { uuid: 'immediate', type: 'triggered' as const, immediate: true, controllerId: 'player1', source, ability,
    effects: buildStackEffects([ability.effect!], 'player1', source), countered: false,
    triggeringEvent: { eventId: 'CARD_DRAWN', payload: { card: hidden } } };
  const engine = new GameEngine(room); engines.push(engine);
  const mutations = engine.applyMutations([], { stackObj: object, effects: [{ effectId: 'DRAW', fizzled: false }] });
  const service = new SyncService({} as never), batches = engine.drainEventBatches();
  const delta = service.buildDelta(room, mutations, { action: 'choose', playerId: 'player1', batches });
  for (const viewer of ['player1', 'player2']) {
    const filtered = service.filterForPlayer(delta, viewer, room);
    expect(filtered.batches).toBeUndefined();
    expect(filtered.notifications).toEqual([{ eventId: 'ACTION_RESOLVED', eventUuid: batches[0].events[0].eventUuid,
      summary: `Resolved immediately: 强攻之怒焰狼 · onCounterChanged: { draw 1 → ${viewer === 'player1' ? 'You' : 'Opponent'} }` }]);
    expect(JSON.stringify(filtered.notifications)).not.toContain(hidden.uuid);
    useGameStore.setState({ room, myPlayerId: viewer, log: [] });
    useGameStore.getState().applyDelta(filtered);
    expect(useGameStore.getState().log.at(-1)?.summary).toContain('强攻之怒焰狼 · onCounterChanged: { draw 1');
    expect(useGameStore.getState().room).not.toHaveProperty('notifications');
  }
  expect(delta.notifications).toBeUndefined();
  const next = service.filterForPlayer(service.buildDelta(room, [], { action: 'pass_priority', playerId: 'player1' }), 'player2', room);
  expect(next.notifications).toBeUndefined();
  useGameStore.getState().applyDelta(next);
  expect(useGameStore.getState().log.at(-1)?.summary).toBe('State updated');
});

it('projects a reveal receipt naming only the exposed card and its source', () => {
  const room = createTestRoom(), source = instantiateCard('red-wolf'), revealed = instantiateCard('broken-fireball');
  source.state = { ...source.state, zone: 'battlefield', ownerId: 'player1', controllerId: 'player1' };
  revealed.state = { ...revealed.state, zone: 'library', ownerId: 'player1', controllerId: 'player1' }; room.battlefield = [source];
  const batch = { batchId: 'batch', cause: { kind: 'engine' }, before: room, after: room, mutations: [], events: [{ eventId: 'CARD_REVEALED', eventUuid: 'reveal', batchId: 'batch', roomId: room.roomId,
    payload: { card: revealed, revealedCard: revealed, sourceInfo: captureSourceInformation(room, source), controllerId: 'player1' } }] } as AppliedEventBatch;
  const service = new SyncService({} as never);
  const delta = service.buildDelta(room, [], { action: 'choose', playerId: 'player1', batches: [batch] });
  for (const viewer of ['player1', 'player2']) expect(service.filterForPlayer(delta, viewer, room).notifications)
    .toEqual([{ eventId: 'CARD_REVEALED', eventUuid: 'reveal', summary: 'Revealed: 破裂火球 · source: 赤狼' }]);
});
it('marks a skipped draw in the immediate summary instead of reporting it as successful', () => {
  const room = createTestRoom(), source = instantiateCard('wolf-king-keps');
  source.state = { ...source.state, zone: 'battlefield', ownerId: 'player1', controllerId: 'player1' };
  const ability = source.blueprint.abilities[0]; if (ability.type !== 'triggered') throw new Error('Expected entry trigger');
  const stackObj = { type: 'triggered' as const, uuid: 'failed-destruction', source, controllerId: 'player1', ability, immediate: true,
    effects: buildStackEffects(ability.effects, 'player1', source), countered: false };
  const batch = { batchId: 'batch', events: [{ eventId: 'ACTION_RESOLVED', eventUuid: 'failed', payload: { stackObj,
    effects: [{ effectId: 'DESTROY', fizzled: false }, { effectId: 'DRAW', fizzled: false, skipped: 'condition_failed' }] } }] } as AppliedEventBatch;
  const service = new SyncService({} as never), delta = service.buildDelta(room, [], { action: 'choose', playerId: 'player1', batches: [batch] });
  expect(service.filterForPlayer(delta, 'player1', room).notifications![0].summary).toContain('draw 1 → You (skipped: condition not met)');
});
