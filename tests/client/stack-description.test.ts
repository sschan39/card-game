import { expect, it } from 'vitest';
import { describeStackObject as displayStack } from '@client/stack-description';
import { buildPlayerView, buildStackView } from '@server/projection/view-builder';
function describeStackObject(room: GameRoom, object: StackObject, viewerId = 'player1') { return displayStack(buildPlayerView(room, viewerId), buildStackView(room, viewerId, object), viewerId); }
import type { GameRoom } from '@shared/game.room.types';
import { instantiateCard } from '@library/card-factory';
import { createTestRoom } from '../helpers/test-room-factory';
import { buildStackEffects } from '@engine/effect-resolver';
import type { StackObject } from '@shared/effect.types';
import { useGameStore } from '@client/store/gameStore';

function fixture(id = 'probe-death') {
  const room = createTestRoom(), source = instantiateCard('trigger-probe');
  source.state = { ...source.state, zone: 'battlefield', ownerId: 'player1', controllerId: 'player1' };
  room.battlefield = [source];
  const ability = source.blueprint.abilities.find(a => a.id === id)!;
  if (ability.type === 'static') throw new Error('Expected ordinary ability');
  const object = { uuid: 'ability-instance', type: ability.type, controllerId: 'player1', source, ability,
    effects: buildStackEffects([ability.effect], 'player1', source), countered: false } as StackObject;
  return { room, source, object };
}
it('names the card, trigger and effect, including another-creature watchers', () => {
  const { room, object } = fixture();
  expect(describeStackObject(room, object, 'player1')).toBe('Trigger Probe · onDeath: { draw 1 → You }');
  const watcher = fixture('probe-other-entry');
  expect(describeStackObject(watcher.room, watcher.object, 'player2')).toBe('Trigger Probe · onAnotherEnter: { heal 1 → Opponent }');
});
it('describes compound spell instructions and a targeted activation without naming it a trigger', () => {
  const { room, source, object } = fixture('probe-destroy');
  object.effects[0].targets = [{ targetType: 'permanent', cardUuid: source.uuid }];
  expect(describeStackObject(room, object, 'player1')).toBe('Trigger Probe · activate: { destroy → Trigger Probe }');
  expect(describeStackObject(room, { ...object, type: 'spell', effects: buildStackEffects(source.blueprint.onCastEffects, 'player1', source) } as StackObject, 'player1'))
    .toBe('Trigger Probe · onPlay: { draw 1 → You; heal 1 → You }');
});
it('keeps unknown effects visible and identifies same-name source and target copies', () => {
  const { room, source, object } = fixture();
  const another = structuredClone(source); another.uuid = 'another'; room.battlefield.push(another);
  object.effects[0] = { action: 'NEW_EFFECT', params: { amount: 2 }, tags: [], targeting: { type: 'permanent', required: true }, targets: [{ targetType: 'permanent', cardUuid: another.uuid }] };
  expect(describeStackObject(room, object, 'player1')).toBe('Trigger Probe #1 · onDeath: { new effect 2 → Trigger Probe #2 }');
});
it('records the source and instructions when an ability enters and leaves the client stack', () => {
  const { room, object } = fixture(); useGameStore.setState({ room: buildPlayerView(room, 'player1'), lastSeq: 0, myPlayerId: 'player1', log: [] });
  useGameStore.getState().applyDelta({ protocolVersion: 1, viewerId: 'player1', roomId: room.roomId, seq: 1, timestamp: 0, changes: [{ path: 'stack', op: 'update', value: [buildStackView(room, 'player1', object)] }] });
  expect(useGameStore.getState().log.at(-1)?.summary).toContain('Trigger Probe · onDeath: { draw 1 → You }');
  useGameStore.getState().applyDelta({ protocolVersion: 1, viewerId: 'player1', roomId: room.roomId, seq: 2, timestamp: 0, changes: [{ path: 'stack', op: 'update', value: [] }] });
  expect(useGameStore.getState().log.at(-1)?.summary).toContain('Left stack: Trigger Probe · onDeath: { draw 1 → You }');
});
