import { describe, expect, it } from 'vitest';
import { EffectRegistry } from '@engine/effect-registry';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';
import { instantiateCard } from '@library/card-factory';
import type { CardInstance } from '@shared/card.types';
import type { GameRoom } from '@shared/game.room.types';
import type { StackEffect, StackObject, TargetPointer, TriggeredStackObject } from '@shared/effect.types';
import type { CardSnapshot } from '@shared/card.types';

function effect(
  action: string,
  params: Record<string, unknown> = {},
  targets: TargetPointer[] = [],
  extra: Partial<StackEffect> = {},
): StackEffect {
  return { action, params, tags: [], targets, ...extra };
}

function spell(room: GameRoom, overrides: Partial<StackObject> = {}): StackObject {
  return {
    uuid: 'effect-stack',
    type: 'spell',
    controllerId: 'player1',
    source: room.battlefield[0] ?? creature('effect-source', 'player1'),
    effects: [],
    countered: false,
    ...overrides,
  } as StackObject;
}

function cardInZone(uuid: string, zone: CardInstance['state']['zone'], owner = 'player1', zoneRevision = 0): CardInstance {
  const card = instantiateCard('empire-servant');
  card.state = { ...card.state, zone, ownerId: owner, controllerId: owner, zoneRevision };
  return { ...card, uuid };
}

function board(uuid: string, owner = 'player1'): CardInstance {
  return creature(uuid, owner);
}

function place(room: GameRoom, card: CardInstance): void {
  const player = room.players[card.state.ownerId];
  if (card.state.zone === 'battlefield') room.battlefield.push(card);
  else if (card.state.zone === 'hand') player.hand.push(card);
  else if (card.state.zone === 'graveyard') player.graveyard.push(card);
  else if (card.state.zone === 'library') player.deck.push(card);
  else if (card.state.zone === 'exile') player.exile = [...(player.exile ?? []), card];
}

function ready(room: GameRoom, ...cards: CardInstance[]): GameRoom {
  for (const card of cards) place(room, card);
  return room;
}

describe('effect registry zone lookup and attachment', () => {
  it('moves a card out of exile and skips stale targets without a library placement', () => {
    const room = createTestRoom();
    const source = board('effect-source');
    const exiled = cardInZone('exiled-card', 'exile');
    const ghost = cardInZone('ghost-card', 'hand');
    room.battlefield = [source];
    room.players.player1.exile = [exiled];
    const move = EffectRegistry.MOVE_ZONE(room, spell(room, { source }), effect('MOVE_ZONE', { origin: 'exile', destination: 'hand' }, [
      { targetType: 'card', cardUuid: exiled.uuid, zone: 'exile' },
      { targetType: 'card', cardUuid: ghost.uuid, zone: 'hand' },
      { targetType: 'card', cardUuid: 'nowhere' },
    ]));
    expect(move).toEqual([
      { type: 'MOVE_CARD', cardUuid: 'exiled-card', playerId: 'player1', from: 'exile', to: 'hand', zoneRevision: 0 },
    ]);
  });

  it('rejects attachments without a known host identity', () => {
    const room = createTestRoom();
    room.battlefield = [board('sword')];
    const stack = spell(room);
    expect(EffectRegistry.ATTACH(room, stack, effect('ATTACH', {}, [{ targetType: 'permanent' }]))).toEqual([]);
    expect(
      EffectRegistry.ATTACH(room, stack, effect('ATTACH', {}, [{ targetType: 'permanent', cardUuid: 'sword' }])),
    ).toEqual([]);
  });

  it('returns nothing when a named origin zone does not hold the card', () => {
    const room = createTestRoom();
    room.battlefield = [board('effect-source')];
    const stack = spell(room);
    for (const origin of ['hand', 'graveyard', 'library'] as const) {
      expect(
        EffectRegistry.MOVE_ZONE(room, stack, effect('MOVE_ZONE', { origin, destination: 'battlefield' }, [
          { targetType: 'card', cardUuid: 'absent' },
        ])),
      ).toEqual([]);
    }
  });

  it('ignores zone movement targets that are neither cards nor stack objects', () => {
    const room = createTestRoom();
    const source = board('effect-source');
    room.battlefield = [source];
    expect(
      EffectRegistry.MOVE_ZONE(room, spell(room, { source }), effect('MOVE_ZONE', { destination: 'hand' }, [
        { targetType: 'player', playerId: 'player1' },
      ])),
    ).toEqual([]);
  });
});

describe('claim revealed self', () => {
  function claimStack(room: GameRoom, revealed: CardInstance, params: Record<string, unknown>): TriggeredStackObject {
    return {
      uuid: 'claim',
      type: 'triggered',
      controllerId: 'player1',
      source: revealed,
      effects: [],
      countered: false,
      triggeringEvent: { eventId: 'CARD_REVEALED', payload: { revealedCard: revealed } },
      ...params,
    } as TriggeredStackObject;
  }

  it('ignores non-triggered objects and unrelated reveals', () => {
    const room = createTestRoom();
    const revealed = cardInZone('revealed', 'library');
    expect(EffectRegistry.CLAIM_REVEALED_SELF(room, spell(room), effect('CLAIM_REVEALED_SELF'))).toEqual([]);
    const other = { ...claimStack(room, revealed, {}), source: board('other-source') };
    expect(EffectRegistry.CLAIM_REVEALED_SELF(room, other, effect('CLAIM_REVEALED_SELF'))).toEqual([]);
  });

  it('moves a still-present revealed card only when it changes zone', () => {
    const room = createTestRoom();
    const revealed = cardInZone('revealed', 'hand');
    room.players.player1.hand = [revealed];
    const stack = claimStack(room, revealed, {});
    expect(EffectRegistry.CLAIM_REVEALED_SELF(room, stack, effect('CLAIM_REVEALED_SELF'))).toEqual([]);
    expect(
      EffectRegistry.CLAIM_REVEALED_SELF(room, stack, effect('CLAIM_REVEALED_SELF', { discard: true })),
    ).toEqual([
      {
        type: 'MOVE_CARD',
        cardUuid: 'revealed',
        playerId: 'player1',
        from: 'hand',
        to: 'graveyard',
        zoneRevision: 0,
        reason: 'discard',
      },
    ]);
    const elsewhere = cardInZone('elsewhere', 'graveyard');
    room.players.player1.graveyard = [elsewhere];
    expect(
      EffectRegistry.CLAIM_REVEALED_SELF(room, claimStack(room, elsewhere, {}), effect('CLAIM_REVEALED_SELF')),
    ).toEqual([]);
  });
});

describe('captured discard instructions', () => {
  function capturedStack(room: GameRoom, cards: CardInstance[], kind: 'captured' | 'milled' = 'captured'): StackObject {
    const result =
      kind === 'captured'
        ? { name: 'window', kind, observationId: 'observation', cards: cards.map((card) => ({ before: { card, power: 0, toughness: 0 } })) }
        : { name: 'window', kind, cards: cards.map((card) => ({ before: { card, power: 0, toughness: 0 }, after: { card, power: 0, toughness: 0 } })) };
    return spell(room, { resolutionResults: { window: result } as never });
  }

  it('discards library cards an existing captured result names', () => {
    const room = createTestRoom();
    const source = board('effect-source');
    const first = cardInZone('first', 'library');
    const second = cardInZone('second', 'hand');
    room.battlefield = [source];
    ready(room, first, second);
    const stack = capturedStack(room, [first, second]);
    expect(
      EffectRegistry.DISCARD_CAPTURED(room, stack, effect('DISCARD_CAPTURED', { from: { kind: 'result', name: 'window' } })),
    ).toEqual([
      { type: 'MOVE_CARD', cardUuid: 'first', playerId: 'player1', from: 'library', to: 'graveyard', zoneRevision: 0, reason: 'discard' },
    ]);
  });

  it('rejects recorded, missing and non-captured sources', () => {
    const room = createTestRoom();
    room.battlefield = [board('effect-source')];
    const stack = capturedStack(room, []);
    expect(EffectRegistry.DISCARD_CAPTURED(room, stack, effect('DISCARD_CAPTURED', {}))).toEqual([]);
    expect(
      EffectRegistry.DISCARD_CAPTURED(
        room,
        stack,
        effect('DISCARD_CAPTURED', { from: { kind: 'result', name: 'window', view: 'recorded' } }),
      ),
    ).toEqual([]);
    expect(
      EffectRegistry.DISCARD_CAPTURED(room, stack, effect('DISCARD_CAPTURED', { from: { kind: 'result', name: 'absent' } })),
    ).toEqual([]);
    expect(
      EffectRegistry.DISCARD_CAPTURED(
        room,
        capturedStack(room, [], 'milled'),
        effect('DISCARD_CAPTURED', { from: { kind: 'result', name: 'window' } }),
      ),
    ).toEqual([]);
  });

  it('discards a selected subset from a captured result with filters and bounds', () => {
    const room = createTestRoom();
    const source = board('effect-source');
    const first = cardInZone('first', 'library');
    first.blueprint = { ...first.blueprint, cardTypes: ['Creature'] };
    const second = cardInZone('second', 'library');
    second.blueprint = { ...second.blueprint, cardTypes: ['Artifact'] };
    room.battlefield = [source];
    ready(room, first, second);
    const stack = capturedStack(room, [first, second]);
    const from = { kind: 'result', name: 'window' } as const;
    expect(
      EffectRegistry.DISCARD_FROM_LIBRARY(room, stack, effect('DISCARD_FROM_LIBRARY', { from, amount: 5, filter: { cardTypes: ['Creature'] } })),
    ).toEqual([expect.objectContaining({ cardUuid: 'first' })]);
    expect(EffectRegistry.DISCARD_FROM_LIBRARY(room, stack, effect('DISCARD_FROM_LIBRARY', { from, amount: -1 }))).toEqual([]);
    expect(EffectRegistry.DISCARD_FROM_LIBRARY(room, stack, effect('DISCARD_FROM_LIBRARY', { from, amount: 1.5 }))).toEqual([]);
    expect(
      EffectRegistry.DISCARD_FROM_LIBRARY(room, stack, effect('DISCARD_FROM_LIBRARY', { from: { kind: 'result', name: 'absent' }, amount: 1 })),
    ).toEqual([]);
    expect(EffectRegistry.DISCARD_FROM_LIBRARY(room, stack, effect('DISCARD_FROM_LIBRARY', { from }))).toHaveLength(2);
  });

  it('mills the targeted player top cards, honouring mill bonuses and totals', () => {
    const room = createTestRoom();
    const source = board('effect-source');
    room.battlefield = [source];
    room.players.player1.deck = [cardInZone('top', 'library'), cardInZone('bottom', 'library')];
    const stack = spell(room, { source });
    const milled = EffectRegistry.DISCARD_FROM_LIBRARY(
      room,
      stack,
      effect('DISCARD_FROM_LIBRARY', { amount: 1 }, [{ targetType: 'player', playerId: 'player1' }]),
    );
    expect(milled.map((mutation) => mutation.type === 'MOVE_CARD' && mutation.cardUuid)).toEqual(['bottom']);

    const bonusSource = board('bonus-source');
    const bonusStack = spell(room, {
      source: bonusSource,
      sourceInfo: {
        card: { ...bonusSource, lastKnownCharacteristics: { millBonus: 2 } as never },
        power: 0,
        toughness: 0,
      } as CardSnapshot,
    });
    const withBonus = EffectRegistry.DISCARD_FROM_LIBRARY(
      room,
      bonusStack,
      effect('DISCARD_FROM_LIBRARY', { amount: 1 }, [{ targetType: 'player', playerId: 'player1' }]),
    );
    expect(withBonus).toHaveLength(2);

    expect(
      EffectRegistry.DISCARD_FROM_LIBRARY(room, stack, effect('DISCARD_FROM_LIBRARY', { amount: 1 }, [{ targetType: 'player' }])),
    ).toEqual([]);
    expect(
      EffectRegistry.DISCARD_FROM_LIBRARY(
        room,
        stack,
        effect('DISCARD_FROM_LIBRARY', { amount: 1 }, [{ targetType: 'player', playerId: 'ghost' }]),
      ),
    ).toEqual([]);
    expect(
      EffectRegistry.DISCARD_FROM_LIBRARY(room, stack, effect('DISCARD_FROM_LIBRARY', { amount: 0 }, [
        { targetType: 'player', playerId: 'player1' },
      ])),
    ).toEqual([]);
    expect(EffectRegistry.DISCARD_FROM_LIBRARY(room, stack, effect('DISCARD_FROM_LIBRARY', { amount: 'two' }))).toEqual([]);
  });

  it('discards only an exact hand incarnation and only player shuffles', () => {
    const room = createTestRoom();
    const source = board('effect-source');
    const inHand = cardInZone('hand-card', 'hand');
    room.battlefield = [source];
    ready(room, inHand);
    const stack = spell(room, { source });
    expect(
      EffectRegistry.DISCARD_FROM_HAND(room, stack, effect('DISCARD_FROM_HAND', {}, [
        { targetType: 'card', cardUuid: 'hand-card', zone: 'hand', zoneRevision: 0 },
      ])),
    ).toEqual([
      { type: 'MOVE_CARD', cardUuid: 'hand-card', playerId: 'player1', from: 'hand', to: 'graveyard', zoneRevision: 0, reason: 'discard' },
    ]);
    expect(
      EffectRegistry.DISCARD_FROM_HAND(room, stack, effect('DISCARD_FROM_HAND', {}, [
        { targetType: 'card', cardUuid: 'hand-card', zone: 'hand', zoneRevision: 9 },
      ])),
    ).toEqual([]);
    expect(
      EffectRegistry.SHUFFLE(room, stack, effect('SHUFFLE', {}, [{ targetType: 'permanent', cardUuid: source.uuid }]), {
        random: () => 0,
      }),
    ).toEqual([]);
    expect(
      EffectRegistry.SHUFFLE(room, stack, effect('SHUFFLE', {}, [{ targetType: 'player', playerId: 'player1' }]), {
        random: () => 0,
      }).map((mutation) => mutation.type),
    ).toEqual(['SHUFFLE_LIBRARY']);
  });
});

describe('library reordering instruction', () => {
  const deckCards = () => {
    const first = cardInZone('first', 'library', 'player1', undefined as unknown as number);
    const second = cardInZone('second', 'library', 'player1', undefined as unknown as number);
    return [first, second];
  };

  it('plans top and bottom placements for live library cards', () => {
    const room = createTestRoom();
    room.battlefield = [board('effect-source')];
    const [first, second] = deckCards();
    ready(room, first, second);
    const stack = spell(room);
    const top = EffectRegistry.REORDER_LIBRARY(room, stack, effect('REORDER_LIBRARY', { placement: 'top' }, [
      { targetType: 'card', cardUuid: 'first', zone: 'library' },
      { targetType: 'card', cardUuid: 'second', zone: 'library' },
    ]));
    expect(top).toHaveLength(1);
    expect(top[0].type === 'REORDER_LIBRARY' && top[0].order.map((entry) => entry.cardUuid)).toEqual(['second', 'first']);
    const bottom = EffectRegistry.REORDER_LIBRARY(room, stack, effect('REORDER_LIBRARY', { placement: 'bottom' }, [
      { targetType: 'card', cardUuid: 'first', zone: 'library', zoneRevision: 0 },
    ]));
    expect(bottom).toHaveLength(1);
  });

  it('rejects invalid placements, non-card targets, stale cards, mismatched zones and mixed owners', () => {
    const room = createTestRoom();
    room.battlefield = [board('effect-source')];
    const [first, second] = deckCards();
    ready(room, first, second);
    const stack = spell(room);
    const reorder = (placement: unknown, targets: TargetPointer[]) =>
      EffectRegistry.REORDER_LIBRARY(room, stack, effect('REORDER_LIBRARY', { placement }, targets));
    expect(reorder('middle', [{ targetType: 'card', cardUuid: 'first' }])).toEqual([]);
    expect(reorder('top', [])).toEqual([]);
    expect(reorder('top', [{ targetType: 'permanent', cardUuid: 'first' }])).toEqual([]);
    expect(reorder('top', [{ targetType: 'card', cardUuid: 'missing' }])).toEqual([]);
    expect(reorder('top', [{ targetType: 'card', cardUuid: 'first', zone: 'hand' }])).toEqual([]);
    expect(reorder('top', [{ targetType: 'card', cardUuid: 'first', zoneRevision: 5 }])).toEqual([]);
    const foreign = cardInZone('foreign', 'library', 'player2');
    room.players.player2.deck = [foreign];
    expect(
      reorder('top', [
        { targetType: 'card', cardUuid: 'first', zone: 'library' },
        { targetType: 'card', cardUuid: 'foreign', zone: 'library' },
      ]),
    ).toEqual([]);
  });
});

describe('replacement effects', () => {
  it('registers a defined replacement for each target', () => {
    const room = createTestRoom();
    const source = board('effect-source');
    const victim = board('victim');
    room.battlefield = [source, victim];
    const stack = spell(room, { source });
    const definition = { label: 'Test replacement', operation: { type: 'prevent' }, match: { kinds: ['damage'] } };
    expect(EffectRegistry.CREATE_REPLACEMENT_EFFECT(room, stack, effect('CREATE_REPLACEMENT_EFFECT', { definition }))).toEqual([
      expect.objectContaining({ type: 'ADD_REPLACEMENT_EFFECT' }),
    ]);
    const targeted = EffectRegistry.CREATE_REPLACEMENT_EFFECT(room, stack, effect('CREATE_REPLACEMENT_EFFECT', { definition }, [
      { targetType: 'permanent', cardUuid: 'victim' },
      { targetType: 'player', playerId: 'player2' },
      { targetType: 'permanent', cardUuid: 'gone' },
    ]));
    expect(targeted).toHaveLength(2);
    expect(targeted[0].type === 'ADD_REPLACEMENT_EFFECT' && targeted[0].effect.match).toMatchObject({
      card: { cardUuid: 'victim', zoneRevision: 0 },
    });
    expect(targeted[1].type === 'ADD_REPLACEMENT_EFFECT' && targeted[1].effect.match).toMatchObject({ playerId: 'player2' });
    expect(EffectRegistry.CREATE_REPLACEMENT_EFFECT(room, stack, effect('CREATE_REPLACEMENT_EFFECT', { definition: {} }))).toEqual([]);
    expect(EffectRegistry.REGENERATE(room, stack, effect('REGENERATE'))).toHaveLength(1);

    const noSourceRevision = { ...board('no-source-revision'), state: { ...board('no-source-revision').state } };
    delete noSourceRevision.state.zoneRevision;
    const noTargetRevision = { ...board('no-target-revision'), state: { ...board('no-target-revision').state } };
    delete noTargetRevision.state.zoneRevision;
    room.battlefield.push(noSourceRevision, noTargetRevision);
    const withoutRevisions = EffectRegistry.CREATE_REPLACEMENT_EFFECT(
      room,
      spell(room, { source: noSourceRevision }),
      effect('CREATE_REPLACEMENT_EFFECT', { definition }, [{ targetType: 'permanent', cardUuid: 'no-target-revision' }]),
    );
    expect(withoutRevisions[0]).toMatchObject({
      effect: { source: { zoneRevision: 0 }, match: { card: { zoneRevision: 0 } } },
    });
  });
});

describe('delayed trigger instruction', () => {
  const ability = {
    id: 'delayed',
    type: 'triggered' as const,
    triggerCondition: 'END_OF_TURN' as const,
    castSpeed: 'instant' as const,
    effect: { action: 'DRAW', params: { amount: 1 }, targeting: { type: 'self' as const, required: false } },
  };

  it('registers a complete triggered ability with its declared lifetime', () => {
    const room = createTestRoom();
    room.battlefield = [board('effect-source')];
    const stack = spell(room);
    const registered = EffectRegistry.CREATE_DELAYED_TRIGGER(
      room,
      stack,
      effect('CREATE_DELAYED_TRIGGER', { ability, lifetime: 'permanent' }),
    );
    expect(registered).toHaveLength(1);
    expect(registered[0]).toMatchObject({ type: 'ADD_DELAYED_TRIGGER', registration: { lifetime: 'permanent', controllerId: 'player1' } });
    expect(
      EffectRegistry.CREATE_DELAYED_TRIGGER(room, stack, effect('CREATE_DELAYED_TRIGGER', { ability, lifetime: 'forever' })),
    ).toEqual([]);
    expect(EffectRegistry.CREATE_DELAYED_TRIGGER(room, stack, effect('CREATE_DELAYED_TRIGGER', { ability: { ...ability, effect: undefined, effects: [] } }))).toEqual([]);
  });
});

describe('zone movement instruction', () => {
  it('counters a matching stack object only with the counter tag', () => {
    const room = createTestRoom();
    const source = board('effect-source');
    const targetSpell = spell(room, { uuid: 'target-spell', source: board('target-source') });
    room.battlefield = [source];
    room.stack = [targetSpell];
    const move = effect('MOVE_ZONE', { destination: 'graveyard' }, [{ targetType: 'spell', stackUuid: 'target-spell' }], {
      tags: ['counter'],
    });
    expect(EffectRegistry.MOVE_ZONE(room, spell(room, { source }), move)).toEqual([
      { type: 'COUNTER_STACK', stackUuid: 'target-spell' },
    ]);
    expect(
      EffectRegistry.MOVE_ZONE(room, spell(room, { source }), { ...move, tags: [] }),
    ).toEqual([]);
  });

  it('rejects malformed zone and placement parameters', () => {
    const room = createTestRoom();
    room.battlefield = [board('effect-source')];
    const stack = spell(room);
    const handler = (params: Record<string, unknown>, targets: TargetPointer[] = []) =>
      EffectRegistry.MOVE_ZONE(room, stack, effect('MOVE_ZONE', params, targets));
    expect(handler({ destination: 'void' })).toEqual([]);
    expect(handler({ destination: 'hand', origin: 'void' })).toEqual([]);
    expect(handler({ destination: 'hand', libraryPlacement: 'top' })).toEqual([]);
    expect(handler({ destination: 'library', libraryPlacement: 'middle' })).toEqual([]);
    expect(handler({ destination: 'library', libraryPlacement: 'top' }, [{ targetType: 'player', playerId: 'player1' }])).toEqual([]);
    expect(
      handler({ destination: 'library', libraryPlacement: 'top' }, [{ targetType: 'card', cardUuid: 'missing' }]),
    ).toEqual([]);
    const libraryCard = cardInZone('library-card', 'library');
    room.players.player1.deck = [libraryCard];
    expect(
      handler({ destination: 'library', libraryPlacement: 'top' }, [{ targetType: 'card', cardUuid: 'library-card', zone: 'library' }]),
    ).toEqual([]);
  });

  it('groups legal library placements by player and reverses top placements', () => {
    const room = createTestRoom();
    room.battlefield = [board('effect-source')];
    const first = cardInZone('first', 'hand');
    const second = cardInZone('second', 'hand');
    ready(room, first, second);
    const stack = spell(room);
    const targets: TargetPointer[] = [
      { targetType: 'card', cardUuid: 'first', zone: 'hand' },
      { targetType: 'card', cardUuid: 'second', zone: 'hand' },
    ];
    const top = EffectRegistry.MOVE_ZONE(room, stack, effect('MOVE_ZONE', { destination: 'library', libraryPlacement: 'top' }, targets));
    expect(top.map((mutation) => mutation.type === 'MOVE_CARD' && mutation.cardUuid)).toEqual(['second', 'first']);
    const bottom = EffectRegistry.MOVE_ZONE(room, stack, effect('MOVE_ZONE', { destination: 'library', libraryPlacement: 'bottom' }, targets));
    expect(bottom.map((mutation) => mutation.type === 'MOVE_CARD' && mutation.cardUuid)).toEqual(['first', 'second']);
  });

  it('rejects duplicates and moves that fail final validation', () => {
    const room = createTestRoom();
    room.battlefield = [board('effect-source')];
    const first = cardInZone('first', 'hand');
    const second = cardInZone('second', 'hand');
    ready(room, first, second);
    const stack = spell(room);
    const duplicate: TargetPointer[] = [
      { targetType: 'card', cardUuid: 'first', zone: 'hand' },
      { targetType: 'card', cardUuid: 'first', zone: 'hand' },
    ];
    expect(
      EffectRegistry.MOVE_ZONE(room, stack, effect('MOVE_ZONE', { destination: 'library', libraryPlacement: 'top' }, duplicate)),
    ).toEqual([]);
    room.players.player1.deck = [structuredClone(first)];
    expect(
      EffectRegistry.MOVE_ZONE(
        room,
        stack,
        effect('MOVE_ZONE', { destination: 'library', libraryPlacement: 'top' }, [
          { targetType: 'card', cardUuid: 'first', zone: 'hand' },
        ]),
      ),
    ).toEqual([]);
  });
});

describe('damage and life effects', () => {
  it('deals damage to players and exact permanents only', () => {
    const room = createTestRoom();
    const source = board('effect-source');
    const victim = board('victim');
    room.battlefield = [source, victim];
    const stack = spell(room, { source });
    const dealt = EffectRegistry.DEAL_DAMAGE(room, stack, effect('DEAL_DAMAGE', { amount: 2 }, [
      { targetType: 'player', playerId: 'player2' },
      { targetType: 'permanent', cardUuid: 'victim' },
      { targetType: 'permanent', cardUuid: 'missing' },
      { targetType: 'card' },
    ]));
    expect(dealt).toHaveLength(1);
    expect(dealt[0].type).toBe('APPLY_DAMAGE_BATCH');
    expect(dealt[0].type === 'APPLY_DAMAGE_BATCH' && dealt[0].assignments).toHaveLength(2);
  });

  it('ignores stale permanent targets and missing zone revisions', () => {
    const room = createTestRoom();
    const source = board('effect-source');
    const stale = cardInZone('stale', 'graveyard');
    const noRevision = { ...board('no-revision'), state: { ...board('no-revision').state } };
    delete noRevision.state.zoneRevision;
    room.battlefield = [source, noRevision];
    ready(room, stale);
    const stack = spell(room, { source });
    const dealt = EffectRegistry.DEAL_DAMAGE(room, stack, effect('DEAL_DAMAGE', { amount: 1 }, [
      { targetType: 'permanent', cardUuid: 'stale' },
      { targetType: 'permanent', cardUuid: 'no-revision' },
      { targetType: 'permanent', cardUuid: 'no-revision', zoneRevision: 4 },
      { targetType: 'self' },
    ]));
    expect(dealt).toHaveLength(1);
  });

  it('routes tagged life loss through damage and ignores non-player targets', () => {
    const room = createTestRoom();
    const source = board('effect-source');
    room.battlefield = [source];
    const stack = spell(room, { source });
    const damage = EffectRegistry.MODIFY_LIFE(room, stack, effect('MODIFY_LIFE', { amount: -2 }, [
      { targetType: 'player', playerId: 'player2' },
      { targetType: 'permanent', cardUuid: source.uuid },
    ], { tags: ['damage'] }));
    expect(damage[0]).toMatchObject({ type: 'APPLY_DAMAGE_BATCH' });
    expect(EffectRegistry.MODIFY_LIFE(room, stack, effect('MODIFY_LIFE', { amount: 2 }, [
      { targetType: 'player', playerId: 'ghost' },
    ]))).toEqual([]);
    expect(EffectRegistry.MODIFY_LIFE(room, stack, effect('MODIFY_LIFE', { amount: 2 }, [
      { targetType: 'player', playerId: 'player1' },
      { targetType: 'permanent', cardUuid: source.uuid },
    ]))).toEqual([{ type: 'SET_LIFE', playerId: 'player1', amount: 22, healing: true }]);
  });
});

describe('stat and counter effects', () => {
  it('resolves dynamic stats, source fallbacks and card-type targets', () => {
    const room = createTestRoom();
    const source = board('effect-source');
    const victim = board('victim');
    room.battlefield = [source, victim];
    const stack = spell(room, { source });
    const result = EffectRegistry.MODIFY_STATS(
      room,
      stack,
      effect('MODIFY_STATS', {}, [{ targetType: 'card', cardUuid: 'victim' }, { targetType: 'permanent' }, { targetType: 'permanent', cardUuid: 'gone' }], {
        dynamicParams: { damage: 1, power: 2, toughness: 3 },
      }),
    );
    expect(result.filter((mutation) => mutation.type === 'ADD_CONTINUOUS_EFFECT')).toHaveLength(2);
    expect(result.some((mutation) => mutation.type === 'APPLY_DAMAGE_BATCH')).toBe(true);

    const emblem = EffectRegistry.MODIFY_STATS(
      room,
      { ...stack, source: undefined } as unknown as StackObject,
      effect('MODIFY_STATS', { power: 1 }, [{ targetType: 'permanent', cardUuid: 'victim' }]),
    );
    expect(emblem[0]).toMatchObject({ type: 'ADD_CONTINUOUS_EFFECT', entry: { source: 'emblem' } });
  });

  it('defaults an absent personal damage revision', () => {
    const room = createTestRoom();
    const source = board('effect-source');
    const victim = board('victim');
    delete victim.state.zoneRevision;
    room.battlefield = [source, victim];
    const stack = spell(room, { source });
    const result = EffectRegistry.MODIFY_STATS(
      room,
      stack,
      effect('MODIFY_STATS', { damage: 1, toughness: 1 }, [{ targetType: 'permanent', cardUuid: 'victim' }]),
    );
    expect(result).toHaveLength(2);
    expect(result.every((mutation) => mutation.type !== 'MARK_DAMAGE' || mutation.zoneRevision === 0)).toBe(true);
  });

  it('adds, removes and destroys exact battlefield cards', () => {
    const room = createTestRoom();
    const source = board('effect-source');
    const victim = board('victim');
    room.battlefield = [source, victim];
    const stack = spell(room, { source });
    expect(
      EffectRegistry.ADD_COUNTER(room, stack, effect('ADD_COUNTER', { counterType: 'charge', amount: 1 }, [
        { targetType: 'card', cardUuid: 'victim' },
        { targetType: 'permanent', cardUuid: 'gone' },
        { targetType: 'permanent' },
      ])),
    ).toEqual([expect.objectContaining({ type: 'ADD_COUNTER', cardUuid: 'victim', counterType: 'charge' })]);
    expect(
      EffectRegistry.REMOVE_COUNTER(room, stack, effect('REMOVE_COUNTER', { counterType: 'charge', amount: 1 }, [
        { targetType: 'card', cardUuid: 'victim' },
        { targetType: 'permanent', cardUuid: 'gone' },
        { targetType: 'permanent' },
      ])),
    ).toEqual([expect.objectContaining({ type: 'REMOVE_COUNTER', cardUuid: 'victim' })]);
    expect(
      EffectRegistry.DESTROY(room, stack, effect('DESTROY', {}, [
        { targetType: 'card', cardUuid: 'victim' },
        { targetType: 'permanent', cardUuid: 'gone' },
        { targetType: 'permanent' },
      ])),
    ).toEqual([expect.objectContaining({ type: 'DESTROY_CARD', cardUuid: 'victim' })]);
    expect(
      EffectRegistry.SACRIFICE(room, stack, effect('SACRIFICE', {}, [
        { targetType: 'card', cardUuid: 'gone' },
        { targetType: 'card' },
      ])),
    ).toEqual([]);
    const noRevision = { ...board('no-revision'), state: { ...board('no-revision').state } };
    delete noRevision.state.zoneRevision;
    room.battlefield.push(noRevision);
    expect(
      EffectRegistry.SACRIFICE(room, stack, effect('SACRIFICE', {}, [{ targetType: 'card', cardUuid: 'no-revision' }])),
    ).toEqual([{ type: 'SACRIFICE_CARD', cardUuid: 'no-revision', zoneRevision: 0 }]);
  });

  it('taps and untaps exact battlefield cards', () => {
    const room = createTestRoom();
    const source = board('effect-source');
    const victim = board('victim');
    room.battlefield = [source, victim];
    const stack = spell(room, { source });
    expect(
      EffectRegistry.TAP(room, stack, effect('TAP', {}, [
        { targetType: 'card', cardUuid: 'victim' },
        { targetType: 'permanent', cardUuid: 'gone' },
        { targetType: 'permanent' },
      ])),
    ).toEqual([{ type: 'TAP_CARD', cardUuid: 'victim' }]);
    expect(
      EffectRegistry.UNTAP(room, stack, effect('UNTAP', {}, [
        { targetType: 'card', cardUuid: 'victim' },
        { targetType: 'permanent', cardUuid: 'gone' },
        { targetType: 'permanent' },
      ])),
    ).toEqual([{ type: 'UNTAP_CARD', cardUuid: 'victim' }]);
  });

  it('draws only for a player in the room and grants stats from any target shape', () => {
    const room = createTestRoom();
    const source = board('effect-source');
    room.battlefield = [source];
    const stack = spell(room, { source });
    expect(EffectRegistry.DRAW(room, { ...stack, controllerId: 'ghost' } as StackObject, effect('DRAW', { amount: 1 }))).toEqual([]);
    expect(EffectRegistry.DRAW(room, stack, effect('DRAW', { amount: 2 }))).toEqual([
      { type: 'DRAW_CARDS', playerId: 'player1', amount: 2 },
    ]);
    expect(
      EffectRegistry.GRANT_STATS(room, stack, effect('GRANT_STATS', { power: 1, toughness: 1 }, [
        { targetType: 'permanent', cardUuid: 'missing' },
        { targetType: 'permanent' },
        { targetType: 'permanent', all: true, cardTypes: ['Creature'] },
      ])),
    ).toHaveLength(4);
    expect(
      EffectRegistry.GRANT_STATS(room, stack, effect('GRANT_STATS', {}, [{ targetType: 'permanent', all: true }])),
    ).toEqual([]);
    const emblem = EffectRegistry.GRANT_STATS(
      room,
      { ...stack, source: undefined } as unknown as StackObject,
      effect('GRANT_STATS', { power: 1 }, [{ targetType: 'permanent', cardUuid: source.uuid }]),
    );
    expect(emblem[0]).toMatchObject({ entry: { source: 'emblem' } });
  });
});

describe('generic continuous effect instruction', () => {
  it('validates the operation and duration before creating a scoped entry', () => {
    const room = createTestRoom();
    const source = board('effect-source');
    room.battlefield = [source];
    const stack = spell(room, { source });
    expect(EffectRegistry.CREATE_CONTINUOUS_EFFECT(room, stack, effect('CREATE_CONTINUOUS_EFFECT', { effect: {} }))).toEqual([]);
    expect(
      EffectRegistry.CREATE_CONTINUOUS_EFFECT(room, stack, effect('CREATE_CONTINUOUS_EFFECT', { effect: { type: 'MILL_AMOUNT', amount: 2 }, duration: 'FOREVER' })),
    ).toEqual([]);
    const declared = EffectRegistry.CREATE_CONTINUOUS_EFFECT(
      room,
      stack,
      effect('CREATE_CONTINUOUS_EFFECT', { effect: { type: 'MILL_AMOUNT', amount: 2 }, scope: { zones: ['library'] } }),
    );
    expect(declared).toHaveLength(1);
    expect(declared[0]).toMatchObject({ entry: { requiredZone: null, duration: 'PERMANENT', layer: 7 } });

    const fromTargets = EffectRegistry.SET_STATS(room, stack, effect('SET_STATS', { power: 1, toughness: 2 }, [
      { targetType: 'permanent', all: true, cardTypes: ['Creature'] },
      { targetType: 'permanent' },
      { targetType: 'permanent', cardUuid: 'gone' },
    ]));
    expect(fromTargets).toHaveLength(1);
    expect(fromTargets[0]).toMatchObject({ entry: { effect: { type: 'SET_STATS', power: 1, toughness: 2 } } });

    const noRevision = { ...board('no-revision'), state: { ...board('no-revision').state } };
    delete noRevision.state.zoneRevision;
    room.battlefield.push(noRevision);
    const targeted = EffectRegistry.SET_STATS(room, stack, effect('SET_STATS', { power: 1 }, [
      { targetType: 'permanent', cardUuid: 'no-revision' },
    ]));
    expect(targeted[0]).toMatchObject({ entry: { sourceRevision: 0, scope: { cardUuid: 'no-revision', zoneRevision: 0 } } });
  });
});
