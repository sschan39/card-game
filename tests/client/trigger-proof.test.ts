import { afterEach, expect, it, vi } from 'vitest';
import { useGameStore } from '@client/store/gameStore';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '@library/card-factory';
import { GameLogger } from '@rules/game-logger';
import type { StackObject } from '@shared/effect.types';

afterEach(() => vi.restoreAllMocks());
it('logs the received trigger identity and its originating event after applying a client delta', () => {
  const room = createTestRoom(), source = instantiateCard('trigger-probe');
  const object: StackObject = { uuid: 'trigger-instance', type: 'triggered', controllerId: 'player1', source,
    ability: source.blueprint.abilities.find(a => a.id === 'probe-entry') as never, effects: [], countered: false,
    triggeringEvent: { eventId: 'PERMANENT_ENTERED', eventUuid: 'origin:1', batchId: 'origin', payload: {} } };
  const info = vi.spyOn(GameLogger.prototype, 'info');
  useGameStore.setState({ room, myPlayerId: 'player1', roomId: room.roomId });
  useGameStore.getState().applyDelta({ roomId: room.roomId, seq: 1, action: 'pass_priority', playerId: 'player2', commandId: 'resolve-command',
    changes: [{ path: 'stack', op: 'update', value: [object] }], timestamp: Date.now() });
  expect(useGameStore.getState().room!.stack[0].uuid).toBe('trigger-instance');
  expect(info.mock.calls).toContainEqual(['delta:applied', expect.any(String), expect.objectContaining({
    triggerStack: [{ stackUuid: 'trigger-instance', abilityId: 'probe-entry', eventUuid: 'origin:1' }],
  })]);
});
