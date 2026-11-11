import { describe, expect, it } from 'vitest';
import {
  attributedLethalMoves,
  killMove,
  replacementCause,
  trackCausalChange,
} from '@engine/change-cause';
import type { ChangeCause } from '@shared/change-cause.types';
import type { GameMutation } from '@shared/game-mutation.types';
import type { GameRoom } from '@shared/game.room.types';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';

const cause = (id: string, over: Partial<ChangeCause> = {}): ChangeCause => ({ id, rootId: id, kind: 'effect', ...over });

function withCausalLethal(room: GameRoom, key: string, lethal: ChangeCause[]): GameRoom {
  return { ...room, causalState: { [key]: { history: [], contributors: [], lethal } } };
}

describe('replacementCause', () => {
  it('records the replacement source by exact incarnation', () => {
    const room = createTestRoom();
    const source = creature('rule-source', 'player1');
    delete (source.state as { zoneRevision?: number }).zoneRevision;
    room.battlefield = [source];

    const attributed = replacementCause(room, cause('base'), {
      id: 'rule',
      label: 'Rule',
      operation: { type: 'cancel_event' },
      source: { cardUuid: 'rule-source', zoneRevision: 0 },
    });
    expect(attributed?.modifiers).toEqual([{ ruleId: 'rule', source: expect.objectContaining({ power: 2 }) }]);
    // A replacement with no source records only its identity.
    expect(replacementCause(room, cause('base'), { id: 'rule', label: 'Rule', operation: { type: 'cancel_event' } })?.modifiers).toEqual([
      { ruleId: 'rule', source: undefined },
    ]);
    expect(replacementCause(room, undefined, { id: 'rule', label: 'Rule', operation: { type: 'cancel_event' } })).toBeUndefined();
  });
});

describe('trackCausalChange', () => {
  it('skips a battlefield object the characteristic board does not describe', () => {
    const room = createTestRoom();
    const first = creature('twin', 'player1', 2, 2);
    const second = creature('twin', 'player1', 2, 2);
    second.state.zoneRevision = 1;
    const before = { ...room, battlefield: [first, second] };
    const after = { ...before, battlefield: [{ ...first }, { ...second }] };
    const tracked = trackCausalChange(before, after, { type: 'SET_PHASE', phase: 'stateMainPhase' } as GameMutation);
    // Nothing was attributed: the duplicate incarnation is not in the board map.
    expect(tracked.causalState ?? {}).toEqual({});
  });

  it('records scorch damage even when no life total changed', () => {
    const before = createTestRoom();
    const scorched = creature('scorched', 'player1', 2, 2);
    scorched.state.counters = { scorch: -1 };
    before.battlefield = [scorched];
    const burning = creature('scorched', 'player1', 2, 2);
    const after: GameRoom = { ...before, battlefield: [burning], setup: { ...before.setup, scorch: true } as never };
    const tracked = trackCausalChange(before, after, { type: 'SET_PHASE', phase: 'stateMainPhase' } as GameMutation);
    expect(tracked.causalState?.['scorched:0']?.history).toEqual([
      { cause: expect.objectContaining({ id: 'rule:SET_PHASE' }), kind: 'state', amount: 1, turnNumber: 1 },
    ]);
  });

  it('forgets lethal status once the permanent is healthy again', () => {
    const room = createTestRoom();
    const card = creature('hurt', 'player1', 2, 2);
    room.battlefield = [card];
    const wounded: GameRoom = { ...room, battlefield: [{ ...card, state: { ...card.state, damageTaken: 2 } }] };
    const recorded = trackCausalChange(room, wounded, { type: 'MARK_DAMAGE', cardUuid: 'hurt', zoneRevision: 0, amount: 2 } as GameMutation);
    expect(recorded.causalState?.['hurt:0']?.lethal).toHaveLength(1);

    const healed: GameRoom = { ...wounded, battlefield: [{ ...card, state: { ...card.state, damageTaken: 0 } }] };
    const cleared = trackCausalChange(recorded, healed, { type: 'CLEAR_DAMAGE' } as GameMutation);
    expect(cleared.causalState?.['hurt:0']?.lethal).toBeUndefined();
    expect(cleared.causalState?.['hurt:0']?.contributors).toHaveLength(1);
  });
});

describe('killMove', () => {
  it('sends a kill to exile when the credited cause asks for it', () => {
    const room = createTestRoom();
    room.battlefield = [creature('victim', 'player1')];
    const move = { type: 'MOVE_CARD', cardUuid: 'victim', playerId: 'player1', from: 'battlefield', to: 'graveyard' } as GameMutation;
    const exiled = killMove(room, move as never, 'lethal', [cause('banish', { killDestination: 'exile' })]);
    expect(exiled).toMatchObject({ to: 'exile', kill: { reason: 'lethal', causes: [expect.objectContaining({ id: 'banish' })] } });
    // Without a destination demand the move keeps its zone.
    const buried = killMove(room, move as never, 'lethal', [cause('plain')]);
    expect(buried).toMatchObject({ to: 'graveyard' });
    // A move that already carries its cause credits that cause.
    const carried = killMove(room, { ...(move as object), cause: cause('carried') } as never, 'lethal');
    expect(carried).toMatchObject({ cause: expect.objectContaining({ id: 'carried' }), kill: { causes: [expect.objectContaining({ id: 'carried' })] } });
  });
});

describe('attributedLethalMoves', () => {
  it('never settles a lethal move for an indestructible permanent', () => {
    const room = createTestRoom();
    const tough = creature('tough', 'player1', 2, 2, ['Indestructible']);
    tough.state.damageTaken = 5;
    room.battlefield = [tough];
    expect(attributedLethalMoves(withCausalLethal(room, 'tough:0', [cause('killed')]), 'killed')).toEqual([]);
  });

  it('ignores a credited cause once the permanent is no longer lethal', () => {
    const room = createTestRoom();
    room.battlefield = [creature('alive', 'player1', 2, 4)];
    expect(attributedLethalMoves(withCausalLethal(room, 'alive:0', [cause('killed')]), 'killed')).toEqual([]);
    // Another cause's settlement leaves this permanent alone.
    const marked = createTestRoom();
    marked.battlefield = [creature('marked', 'player1', 2, 2)];
    expect(attributedLethalMoves(withCausalLethal(marked, 'marked:0', [cause('other')]), 'killed')).toEqual([]);
  });

  it('destroys a lethal permanent that survives on negative toughness', () => {
    const room = createTestRoom();
    const dying = creature('dying', 'player1', 2, 2);
    dying.state.damageTaken = 2;
    delete (dying.state as { zoneRevision?: number }).zoneRevision;
    room.battlefield = [dying];
    const moves = attributedLethalMoves(withCausalLethal(room, 'dying:0', [cause('killed')]), 'killed');
    expect(moves).toEqual([
      expect.objectContaining({ type: 'DESTROY_CARD', cardUuid: 'dying', zoneRevision: 0, kill: expect.objectContaining({ reason: 'lethal' }) }),
    ]);
  });

  it('moves a permanent whose toughness is gone straight to the graveyard', () => {
    const room = createTestRoom();
    const dead = creature('dead', 'player1', 2, 0);
    room.battlefield = [dead];
    const moves = attributedLethalMoves(withCausalLethal(room, 'dead:0', [cause('killed')]), 'killed');
    expect(moves).toEqual([expect.objectContaining({ type: 'MOVE_CARD', cardUuid: 'dead', to: 'graveyard' })]);
  });
});
