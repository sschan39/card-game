import { describe, expect, it } from 'vitest';
import { deriveBoardCues, deriveImpactCues } from '@client/presentation/board-transitions';
import { cardAnchor, seatAnchor, STACK_LANE, stackAnchor } from '@client/presentation/board-anchors';
import { createTestRoom } from '../helpers/client-view-fixture';

describe('board cues from player views', () => {
  it('turns reciprocal combat damage into one clash and keeps stack color for a spell', () => {
    const attacker = { kind: 'permanent', cardUuid: 'a', zoneRevision: 1 } as const;
    const blocker = { kind: 'permanent', cardUuid: 'b', zoneRevision: 3 } as const;
    const player = { kind: 'player', playerId: 'player2' } as const;
    expect(deriveImpactCues([
      { source: attacker, target: blocker, combat: true },
      { source: blocker, target: attacker, combat: true },
      { source: { kind: 'stack', stackUuid: 'fireball' }, target: player, combat: false, color: 'red' },
      { target: player, combat: false },
    ])).toEqual([
      { from: 'battlefield:a:1', at: 'battlefield:b:3', style: 'combat' },
      { from: stackAnchor('fireball'), at: seatAnchor('life', 'player2'), style: 'red' },
      { from: undefined, at: seatAnchor('life', 'player2'), style: 'neutral' },
    ]);
  });
  it('matches a visible card across hand, stack, and graveyard using its instance ID', () => {
    const before = createTestRoom();
    const card = before.players.player1.hand[0];
    // A cached hand can predate zone revisions. Its visible anchor still follows the card.
    delete card.state.zoneRevision;
    expect(cardAnchor('hand', card)).toBe('hand:' + card.uuid + ':0');
    const cast = structuredClone(before);
    cast.players.player1.hand.shift();
    cast.stack = [{
      uuid: 'cast', controllerId: 'player1', type: 'spell', description: card.name,
      source: { ...card, state: { ...card.state, zone: 'stack', zoneRevision: 2 } },
    }];
    expect(deriveBoardCues(before, cast)).toContainEqual(expect.objectContaining({
      kind: 'move', from: cardAnchor('hand', card), to: stackAnchor('cast'),
    }));

    const resolved = structuredClone(cast);
    resolved.stack = [];
    resolved.players.player1.graveyard.push({ ...card, state: { ...card.state, zone: 'graveyard', zoneRevision: 3 } });
    resolved.players.player2.life -= 3;
    expect(deriveBoardCues(cast, resolved)).toEqual([
      expect.objectContaining({ kind: 'move', from: stackAnchor('cast'), to: seatAnchor('graveyard', 'player1') }),
      { kind: 'pulse', at: STACK_LANE },
      { kind: 'number', at: seatAnchor('life', 'player2'), amount: -3 },
    ]);
  });

  it('animates a visible draw and uses only public counts for the opponent’s draw', () => {
    const after = createTestRoom();
    const before = structuredClone(after);
    const drawn = before.players.player1.hand.pop()!;
    before.players.player1.deckCount++;
    before.players.player2.deckCount++;
    after.players.player2.handCount++;
    expect(deriveBoardCues(before, after)).toEqual([
      { kind: 'move', card: drawn, from: seatAnchor('deck', 'player1'), to: cardAnchor('hand', drawn) },
      { kind: 'draw-hidden', from: seatAnchor('deck', 'player2'), to: seatAnchor('hand', 'player2'), count: 1 },
    ]);
    after.players.player2.handCount++;
    expect(deriveBoardCues(before, after).some(cue => cue.kind === 'draw-hidden')).toBe(false);
  });

  it('uses the battlefield anchor for damage and treats ability sources as references', () => {
    const before = createTestRoom();
    const card = before.players.player1.hand.shift()!;
    const permanent = { ...card, state: { ...card.state, zone: 'battlefield' as const } };
    before.battlefield = [permanent];
    const after = structuredClone(before);
    after.battlefield[0].state.damageTaken += 2;
    after.stack = [{ uuid: 'ability', controllerId: 'player1', type: 'activated', description: card.name, source: permanent }];
    expect(deriveBoardCues(before, after)).toEqual([
      { kind: 'number', at: cardAnchor('battlefield', permanent), amount: -2 },
      { kind: 'pulse', at: stackAnchor('ability') },
    ]);
    after.battlefield[0].state.zoneRevision = (permanent.state.zoneRevision ?? 0) + 1;
    expect(deriveBoardCues(before, after)).toContainEqual({ kind: 'pulse', at: cardAnchor('battlefield', after.battlefield[0]) });
    expect(deriveBoardCues(before, { ...after, viewerId: 'player2' })).toEqual([]);
  });

  it('appears and ceases at the battlefield without a graveyard flight for a token', () => {
    const before = createTestRoom();
    const fixture = before.players.player1.hand[0];
    const token = { ...fixture, uuid: 'token', isToken: true, state: { ...fixture.state, zone: 'battlefield' as const, zoneRevision: 3 } };
    const after = { ...before, battlefield: [token] };
    expect(deriveBoardCues(before, after)).toEqual([{ kind: 'token-appear', at: 'battlefield:token:3' }]);
    const departed = { ...before, players: { ...before.players, player1: { ...before.players.player1,
      graveyard: [{ ...token, state: { ...token.state, zone: 'graveyard' as const } }],
    } } };
    expect(deriveBoardCues(after, departed)).toEqual([{ kind: 'token-cease', at: 'battlefield:token:3' }]);
  });
});
