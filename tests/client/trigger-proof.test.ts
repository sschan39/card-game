import { afterEach, expect, it, vi } from 'vitest';
import { useGameStore } from '@client/store/gameStore';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '@library/card-factory';
import { clientLogger } from '@client/logger';
import { buildPlayerView, buildStackView } from '@server/projection/view-builder';
import type { StackObject } from '@shared/effect.types';

afterEach(() => vi.restoreAllMocks());
it('logs the received trigger identity without internal event payloads after applying a client delta', () => {
  const room = createTestRoom(), source = instantiateCard('trigger-probe');
  source.state.zone = 'battlefield'; room.battlefield = [source];
  const object: StackObject = { uuid: 'trigger-instance', type: 'triggered', controllerId: 'player1', source,
    ability: source.blueprint.abilities.find(a => a.id === 'probe-entry') as never, effects: [], countered: false,
    triggeringEvent: { eventId: 'PERMANENT_ENTERED', batchId: 'origin', payload: {} } };
  const info = vi.spyOn(clientLogger, 'info');
  useGameStore.setState({ room: buildPlayerView(room, 'player1'), lastSeq: 0, myPlayerId: 'player1', roomId: room.roomId });
  useGameStore.getState().applyDelta({ protocolVersion: 1, viewerId: 'player1', roomId: room.roomId, seq: 1, action: 'pass_priority', playerId: 'player2', commandId: 'resolve-command',
    changes: [{ path: 'stack', op: 'update', value: [buildStackView(room, 'player1', object)] }], timestamp: Date.now() });
  expect(useGameStore.getState().room!.stack[0].uuid).toBe('trigger-instance');
  expect(info.mock.calls).toContainEqual(['delta:applied', expect.any(String), expect.objectContaining({
    triggerStack: [{ stackUuid: 'trigger-instance', abilityId: 'probe-entry' }],
  })]);
});
