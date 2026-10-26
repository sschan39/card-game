import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from '@client/store/gameStore';
import { applyDeltaChanges } from '@client/store/deltaReducer';
import { createTestRoom } from '../helpers/client-view-fixture';
import type { ViewDelta } from '@card-game/protocol';
import { createTargetingState } from '@client/targeting';

beforeEach(() => { useGameStore.setState({ room: createTestRoom(), myPlayerId: 'player1', lastSeq: 0, error: null, log: [] }); });
const delta = (seq = 1): ViewDelta => ({ protocolVersion: 1, roomId: 'room', viewerId: 'player1', seq, timestamp: 0,
  changes: [{ path: 'players.player1.life', op: 'update', value: 19 }] });
describe('player view update boundary', () => {
  it('drops a newly illegal or reincarnated target from an unsent draft', () => {
    const room = useGameStore.getState().room!, card = room.players.player1.hand[0];
    card.targetGroups.cast_spell = [{ id: 'target', targeting: { type: 'permanent', required: true }, legalTargets: [{ targetType: 'permanent', cardUuid: 'target', zoneRevision: 1 }] }];
    const state = useGameStore.getState(); state.beginTargeting(createTargetingState(card, 'hand', 'cast_spell')!);
    state.addTarget({ targetType: 'permanent', cardUuid: 'target' });
    expect(useGameStore.getState().targeting?.collected[0].zoneRevision).toBe(1);
    const players = structuredClone(room.players);
    players.player1.hand[0].targetGroups.cast_spell[0].legalTargets[0].zoneRevision = 2;
    state.applyDelta({ ...delta(), changes: [{ path: 'players', op: 'update', value: players }] });
    expect(useGameStore.getState().targeting?.collected).toEqual([]);
  });
  it('rejects wrong versions, audiences and rooms without touching state', () => {
    const before = useGameStore.getState().room;
    for (const patch of [{ protocolVersion: 2 }, { viewerId: 'player2' }, { roomId: 'other' }]) useGameStore.getState().applyDelta({ ...delta(), ...patch } as ViewDelta);
    expect(useGameStore.getState().room).toBe(before);
  });
  it('ignores duplicates, identifies gaps and restores the snapshot sequence', () => {
    const state = useGameStore.getState(); state.applyDelta(delta()); state.applyDelta(delta());
    expect(useGameStore.getState().log).toHaveLength(1);
    state.applyDelta(delta(3)); expect(useGameStore.getState().lastSeq).toBe(1);
    expect(useGameStore.getState().error).toContain('out of order');
    state.setRoom(createTestRoom(), 8); state.applyDelta(delta(9));
    expect(useGameStore.getState().lastSeq).toBe(9);
  });
  it('blocks dangerous object paths and applies removals without retaining hidden fields', () => {
    const room = createTestRoom();
    for (const path of ['__proto__.polluted', 'players.constructor.prototype.polluted']) expect(() => applyDeltaChanges(room, [{ path, op: 'update', value: true }])).toThrow('Unsafe');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
