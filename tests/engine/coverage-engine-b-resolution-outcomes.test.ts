import { describe, expect, it } from 'vitest';
import { probeOutcome, settleOutcome } from '@engine/resolution-outcomes';
import type { GameMutation } from '@shared/game-mutation.types';
import type { StackObject } from '@shared/effect.types';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';

const object = { type: 'activated', uuid: 'stack-uuid', source: creature('src', 'player1'), controllerId: 'player1', effects: [], countered: false } as unknown as StackObject;

const move = (cardUuid: string, from: string, to: string, over: Record<string, unknown> = {}): GameMutation => ({
  type: 'MOVE_CARD',
  cardUuid,
  playerId: 'player1',
  from,
  to,
  ...over,
}) as unknown as GameMutation;

const killFor = (stackUuid: string | undefined, reason: 'destroy' | 'lethal' = 'lethal') => ({
  victim: { cardUuid: 'a', zoneRevision: 0 },
  reason,
  causes: [{ id: 'cause-1', rootId: 'cause-1', kind: 'effect' as const, stackUuid }],
});

describe('probeOutcome', () => {
  it('ignores an instruction that declares no outcome', () => {
    expect(probeOutcome(createTestRoom(), undefined, [move('a', 'battlefield', 'graveyard')])).toBeUndefined();
  });

  it('probes every battlefield permanent for a kill outcome', () => {
    const room = createTestRoom();
    const first = creature('a', 'player1');
    const second = creature('b', 'player2');
    delete (second.state as { zoneRevision?: number }).zoneRevision;
    room.battlefield = [first, second];

    expect(probeOutcome(room, { name: 'win', kind: 'killed' }, [move('a', 'battlefield', 'graveyard')])).toEqual({
      name: 'win',
      kind: 'killed',
      cards: [
        { cardUuid: 'a', zoneRevision: 0 },
        { cardUuid: 'b', zoneRevision: 0 },
      ],
    });
    // Effect-creation and damage-batch mutations also count as kill attempts.
    const batch: GameMutation = { type: 'APPLY_DAMAGE_BATCH', assignments: [] } as unknown as GameMutation;
    const effect: GameMutation = {
      type: 'ADD_CONTINUOUS_EFFECT',
      entry: { id: 'e', layer: 4, duration: 'PERMANENT', source: 'src', effect: { type: 'SET_STATS', power: 1, toughness: 1 } },
    } as unknown as GameMutation;
    expect(probeOutcome(room, { name: 'win', kind: 'killed' }, [batch, effect])?.cards).toHaveLength(2);
    // A mutation that names no card and is neither of those attempts nothing.
    expect(probeOutcome(room, { name: 'win', kind: 'killed' }, [{ type: 'CLEAR_DAMAGE' } as GameMutation])?.cards).toEqual([]);
  });

  it('probes only the named card for destruction and discard outcomes', () => {
    const room = createTestRoom();
    room.battlefield = [creature('a', 'player1')];
    const destroyed = { type: 'DESTROY_CARD', cardUuid: 'a', zoneRevision: 0 } as unknown as GameMutation;
    expect(probeOutcome(room, { name: 'win', kind: 'destroyed' }, [destroyed])?.cards).toEqual([{ cardUuid: 'a', zoneRevision: 0 }]);
    // A plain move is not a destruction.
    expect(probeOutcome(room, { name: 'win', kind: 'destroyed' }, [move('a', 'battlefield', 'graveyard')])?.cards).toEqual([]);
    // Only a discard-reason move counts for a discard outcome.
    expect(probeOutcome(room, { name: 'win', kind: 'discarded' }, [move('a', 'battlefield', 'graveyard', { reason: 'discard' })])?.cards).toEqual([
      { cardUuid: 'a', zoneRevision: 0 },
    ]);
    expect(probeOutcome(room, { name: 'win', kind: 'discarded' }, [move('a', 'battlefield', 'graveyard', { reason: 'draw' })])?.cards).toEqual([]);
    expect(probeOutcome(room, { name: 'win', kind: 'discarded' }, [destroyed])?.cards).toEqual([]);
  });
});

describe('settleOutcome', () => {
  const probe = (kind: 'killed' | 'destroyed' | 'discarded', zoneRevision = 0) => ({
    name: 'win',
    kind,
    cards: [{ cardUuid: 'a', zoneRevision }],
  });

  it('leaves the object untouched when nothing was probed', () => {
    expect(settleOutcome(createTestRoom(), object, undefined, [])).toBe(object);
  });

  it('credits a kill only for the attributed lethal departure', () => {
    const room = createTestRoom();
    room.battlefield = [creature('a', 'player1')];
    const credited = settleOutcome(room, object, probe('killed'), [move('a', 'battlefield', 'graveyard', { kill: killFor('stack-uuid') })]);
    expect(credited.resolutionOutcomes).toEqual({ win: true });

    // A kill attributed to a different stack object is not this instruction's success.
    expect(settleOutcome(room, object, probe('killed'), [move('a', 'battlefield', 'graveyard', { kill: killFor('other') })]).resolutionOutcomes).toEqual({ win: false });
    // A departure with no kill attribution does not count.
    expect(settleOutcome(room, object, probe('killed'), [move('a', 'battlefield', 'graveyard')]).resolutionOutcomes).toEqual({ win: false });
    // Exile counts as a lethal departure; any other destination does not.
    expect(settleOutcome(room, object, probe('killed'), [move('a', 'battlefield', 'exile', { kill: killFor('stack-uuid') })]).resolutionOutcomes).toEqual({ win: true });
    expect(settleOutcome(room, object, probe('killed'), [move('a', 'battlefield', 'hand', { kill: killFor('stack-uuid') })]).resolutionOutcomes).toEqual({ win: false });
    // Non-move mutations never settle the outcome.
    expect(settleOutcome(room, object, probe('killed'), [{ type: 'CLEAR_DAMAGE' } as GameMutation]).resolutionOutcomes).toEqual({ win: false });
  });

  it('requires the matching reason for destruction and discard outcomes', () => {
    const room = createTestRoom();
    room.battlefield = [creature('a', 'player1')];
    expect(settleOutcome(room, object, probe('destroyed'), [move('a', 'battlefield', 'graveyard', { reason: 'destroy' })]).resolutionOutcomes).toEqual({ win: true });
    expect(settleOutcome(room, object, probe('destroyed'), [move('a', 'battlefield', 'graveyard', { reason: 'sacrifice' })]).resolutionOutcomes).toEqual({ win: false });
    expect(settleOutcome(room, object, probe('destroyed'), [move('a', 'battlefield', 'exile', { reason: 'destroy' })]).resolutionOutcomes).toEqual({ win: false });
    expect(settleOutcome(room, object, probe('discarded'), [move('a', 'battlefield', 'graveyard', { reason: 'discard' })]).resolutionOutcomes).toEqual({ win: true });
    expect(settleOutcome(room, object, probe('discarded'), [move('a', 'battlefield', 'graveyard', { reason: 'destroy' })]).resolutionOutcomes).toEqual({ win: false });
  });

  it('requires the probed incarnation and the exact next revision', () => {
    const room = createTestRoom();
    room.battlefield = [creature('a', 'player1')];
    expect(settleOutcome(room, object, probe('destroyed', 7), [move('a', 'battlefield', 'graveyard', { reason: 'destroy' })]).resolutionOutcomes).toEqual({ win: false });

    // A rejected move leaves the destination empty, so no arrival can be credited.
    expect(settleOutcome(room, object, probe('destroyed'), [move('a', 'battlefield', 'graveyard', { reason: 'destroy', toIndex: 5 })]).resolutionOutcomes).toEqual({ win: false });
    // The source must still be where the move claims it was.
    expect(settleOutcome(room, object, probe('destroyed'), [move('a', 'hand', 'graveyard', { reason: 'destroy' })]).resolutionOutcomes).toEqual({ win: false });
  });

  it('credits a token that ceased from the probed battlefield incarnation', () => {
    const room = createTestRoom();
    const token = creature('a', 'player1');
    token.isToken = true;
    delete (token.state as { zoneRevision?: number }).zoneRevision;
    room.battlefield = [token];
    const settled = settleOutcome(room, object, probe('destroyed'), [move('a', 'battlefield', 'graveyard', { reason: 'destroy' })]);
    expect(settled.resolutionOutcomes).toEqual({ win: true });
  });

  it('rejects an arrival whose incarnation does not match the probe', () => {
    const room = createTestRoom();
    // A same-zone move is rejected, so the object is both the source and the "arrival".
    const idle = creature('a', 'player1');
    idle.state.zone = 'graveyard';
    delete (idle.state as { zoneRevision?: number }).zoneRevision;
    room.battlefield = [];
    room.players.player1.graveyard = [idle];
    const settled = settleOutcome(room, object, probe('destroyed'), [move('a', 'graveyard', 'graveyard', { reason: 'destroy' })]);
    expect(settled.resolutionOutcomes).toEqual({ win: false });
  });
});
