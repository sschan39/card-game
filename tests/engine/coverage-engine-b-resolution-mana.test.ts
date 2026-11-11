import { describe, expect, it } from 'vitest';
import {
  canPayNonManaCost,
  hasPaymentMana,
  manaPaymentOptions,
  prepareResolutionMana,
  resolutionPaymentRoom,
} from '@engine/resolution-mana';
import type { ActionCost } from '@shared/effect.types';
import type { PaymentContinuation } from '@shared/choice.types';
import type { CardInstance } from '@shared/card.types';
import type { GameRoom } from '@shared/game.room.types';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';

function manaCard(
  uuid: string,
  controllerId = 'player1',
  params: Record<string, unknown> = { color: 'red', amount: 1 },
  abilityOver: Record<string, unknown> = {},
): CardInstance {
  const card = creature(uuid, controllerId);
  card.blueprint = {
    ...card.blueprint,
    abilities: [
      {
        id: 'tap-m',
        type: 'activated',
        castSpeed: 'instant',
        cost: { tap: true },
        effect: { action: 'ADD_MANA', params, tags: [], targeting: { type: 'self', required: false } },
        ...abilityOver,
      },
    ] as never,
  };
  return card;
}

function boardRoom(...cards: CardInstance[]): GameRoom {
  return { ...createTestRoom(), battlefield: cards };
}

const saved = (over: Record<string, unknown> = {}): PaymentContinuation =>
  ({
    type: 'resolution',
    paymentStage: 'mana_ability',
    stackObj: { controllerId: 'player1' },
    effectIndex: 0,
    results: [],
    paymentData: {},
    ...over,
  }) as unknown as PaymentContinuation;

describe('resolutionPaymentRoom', () => {
  it('lends the paying player priority for planning', () => {
    const room = createTestRoom();
    const lent = resolutionPaymentRoom(room, 'player2');
    expect(lent.priorityPlayerId).toBe('player2');
    expect(room.priorityPlayerId).toBe('player1');
  });
});

describe('hasPaymentMana', () => {
  it('checks the current pool only', () => {
    const room = createTestRoom();
    expect(hasPaymentMana(room, 'player1', { mana: { red: 5 } })).toBe(true);
    expect(hasPaymentMana(room, 'player1', { mana: { red: 6 } })).toBe(false);
    expect(hasPaymentMana(room, 'player1', {})).toBe(true);
  });
});

describe('canPayNonManaCost', () => {
  it('accepts costs the player can still pay and rejects the rest', () => {
    const room = createTestRoom();
    room.players.player1.hand = [];
    const source = creature('source', 'player1');
    expect(canPayNonManaCost(room, 'player1', source, {}, {})).toBe(true);
    expect(canPayNonManaCost(room, 'player1', source, { discard: 1 } as ActionCost, {})).toBe(false);
    expect(canPayNonManaCost(room, 'player1', source, { removeCounters: [{ counterType: 'charge', amount: 2, from: 'source' }] } as ActionCost, {})).toBe(false);
  });

  it('uses the supplied witnesses for selections the player still owns', () => {
    const room = createTestRoom();
    const source = creature('source', 'player1');
    const spare = creature('spare', 'player1');
    spare.state.zone = 'hand';
    room.players.player1.hand = [spare];
    expect(canPayNonManaCost(room, 'player1', source, { discard: 1 } as ActionCost, { discardUuids: ['spare'] })).toBe(true);
    // The source itself is never offered as its own discard.
    expect(canPayNonManaCost(room, 'player1', source, { discard: 1 } as ActionCost, { discardUuids: ['source'] })).toBe(false);
  });

  it('counts only cards other than the source in hand', () => {
    const room = createTestRoom();
    const source = creature('source', 'player1');
    source.state.zone = 'hand';
    const other = creature('other', 'player1');
    other.state.zone = 'hand';
    room.players.player1.hand = [source, other];
    expect(canPayNonManaCost(room, 'player1', source, { discard: 1 } as ActionCost, {})).toBe(true);
    expect(canPayNonManaCost(room, 'player1', source, { discard: 2 } as ActionCost, {})).toBe(false);
  });
});

describe('prepareResolutionMana', () => {
  it('rejects an unusable activation list', () => {
    const room = createTestRoom();
    expect(prepareResolutionMana(room, saved({ paymentData: { manaActivations: 'nope' } }))).toEqual({
      success: false,
      reason: 'Too many mana activations in one payment',
    });
    const many = Array.from({ length: 129 }, () => ({ cardUuid: 'm', abilityId: 'tap-m' }));
    expect(prepareResolutionMana(room, saved({ paymentData: { manaActivations: many } }))).toEqual({
      success: false,
      reason: 'Too many mana activations in one payment',
    });
  });

  it('returns the planning room when nothing is activated', () => {
    const room = boardRoom(manaCard('m'));
    const result = prepareResolutionMana(room, saved());
    expect(result).toMatchObject({ success: true, working: { priorityPlayerId: 'player1' } });
    expect('pendingChoice' in result).toBe(false);
  });

  it('reports the rejection of an illegal activation', () => {
    const room = boardRoom(manaCard('m'));
    expect(prepareResolutionMana(room, saved({ paymentData: { manaActivations: [{ cardUuid: 'm', abilityId: 'tap-m', costRoute: { kind: 'base' } }] } }))).toEqual({
      success: false,
      reason: 'Mana abilities do not support cost routes',
    });
  });

  it('reports a failed activation plan', () => {
    const room = boardRoom(creature('plain', 'player1'));
    expect(prepareResolutionMana(room, saved({ paymentData: { manaActivations: [{ cardUuid: 'plain' }] } }))).toEqual({
      success: false,
      reason: 'Select a valid mana ability',
    });
  });

  it('replays the activations in order', () => {
    const room = boardRoom(manaCard('m'));
    const result = prepareResolutionMana(room, saved({ paymentData: { manaActivations: [{ cardUuid: 'm', abilityId: 'tap-m' }] } }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.working.players.player1.mana.red).toBe(6);
      expect(result.working.battlefield[0].state.isTapped).toBe(true);
      expect(room.players.player1.mana.red).toBe(5);
    }
  });

  it('surfaces a mana ability that needs its own choice', () => {
    const room = boardRoom(manaCard('m', 'player1', { color: 'red', amount: 1 }, { cost: { tap: true, discard: 1 } }));
    const spare = creature('spare', 'player1');
    spare.state.zone = 'hand';
    room.players.player1.hand = [spare];
    const result = prepareResolutionMana(room, saved({ paymentData: { manaActivations: [{ cardUuid: 'm', abilityId: 'tap-m' }] } }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.pendingChoice).toMatchObject({ kind: 'discard', playerId: 'player1' });
      expect(result.pendingChoice?.continuation).toMatchObject({ type: 'resolution', paymentStage: 'mana_ability', manaActivationIndex: 0 });
    }
  });
});

describe('manaPaymentOptions', () => {
  const cost: ActionCost = { mana: {} };

  it('lists a real mana source with a descriptive label', () => {
    const room = boardRoom(manaCard('m'));
    const options = manaPaymentOptions(room, 'player1', creature('source', 'player1'), cost, {});
    expect(options).toEqual([{ id: 'm:tap-m:red', value: { cardUuid: 'm', abilityId: 'tap-m', manaColor: 'red' }, label: 'm: add 1 red mana' }]);
  });

  it('skips opponents, non-mana permanents and malformed output', () => {
    const room = boardRoom(
      manaCard('theirs', 'player2'),
      creature('plain', 'player1'),
      manaCard('broken', 'player1', { color: 'pink', amount: 1 }),
      manaCard('zeroed', 'player1', { color: 'red', amount: 0 }),
    );
    expect(manaPaymentOptions(room, 'player1', creature('source', 'player1'), cost, {})).toEqual([]);
  });

  it('skips an activation the rules refuse or that cannot pay afterwards', () => {
    const limited = manaCard('limited', 'player1', { color: 'red', amount: 1 }, {
      usage: { period: 'turn', limit: 1, identity: 'source_card', consume: 'on_activation' },
    });
    const room = boardRoom(limited);
    room.turnHistory = { turnNumber: 1, events: [], counts: {}, playerCounts: {}, uses: { 'ability-use:limited:tap-m': 1 } };
    expect(manaPaymentOptions(room, 'player1', creature('source', 'player1'), cost, {})).toEqual([]);

    const tapped = manaCard('tapped');
    tapped.state.isTapped = true;
    expect(manaPaymentOptions(boardRoom(tapped), 'player1', creature('source', 'player1'), cost, {})).toEqual([]);

    // A discard the player cannot pay leaves the mana source unusable.
    const costly = boardRoom(manaCard('costly'));
    costly.players.player1.hand = [];
    expect(manaPaymentOptions(costly, 'player1', creature('source', 'player1'), { discard: 3 } as ActionCost, {})).toEqual([]);
  });

  it('offers a source whose payment needs its own choice', () => {
    const costly = manaCard('costly', 'player1', { color: 'red', amount: 1 }, { cost: { tap: true, discard: 1 } });
    const spare = creature('spare', 'player1');
    spare.state.zone = 'hand';
    const room = boardRoom(costly);
    room.players.player1.hand = [spare];
    const options = manaPaymentOptions(room, 'player1', creature('source', 'player1'), { discard: 1 } as ActionCost, {});
    expect(options.map((option) => option.id)).toEqual(['costly:tap-m:red']);
  });

  it('lists each producible colour once', () => {
    const room = boardRoom(manaCard('dual', 'player1', { colors: ['red', 'blue'], amount: 1 }));
    const options = manaPaymentOptions(room, 'player1', creature('source', 'player1'), cost, {});
    expect(options.map((option) => option.value)).toEqual([
      { cardUuid: 'dual', abilityId: 'tap-m', manaColor: 'red' },
      { cardUuid: 'dual', abilityId: 'tap-m', manaColor: 'blue' },
    ]);
  });
});
