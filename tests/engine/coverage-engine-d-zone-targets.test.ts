import { describe, expect, it } from 'vitest';
import { getCardInZone, moveCard, resetCardForZone, validateCardMove } from '@engine/zone-transitions';
import { planTargetGroups } from '@engine/target-groups';
import { captureSourceInformation, resolveSourceInformation, retainDepartingSource } from '@engine/source-information';
import { characteristicScope, scopeMatches } from '@engine/effect-scopes';
import { CardCharacteristicService } from '@engine/card-characteristic-service';
import { instantiateCard } from '@library/card-factory';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';
import type { GameRoom, PlayerId } from '@shared/game.room.types';
import type { GameMutation } from '@shared/game-mutation.types';
import type { StackEffect, StackObject } from '@shared/effect.types';
import type { CardInstance } from '@shared/card.types';

type Move = Extract<GameMutation, { type: 'MOVE_CARD' }>;

function handCard(room: GameRoom, zoneRevision = 0): CardInstance {
  const card = instantiateCard('empire-servant');
  card.state = { ...card.state, zone: 'hand', ownerId: 'player1', controllerId: 'player1', zoneRevision };
  room.players.player1.hand = [card];
  return card;
}

describe('zone transition guards', () => {
  it('keeps the revision for a same-zone reset and bumps it for a real zone change', () => {
    const card = creature('card', 'player1');
    card.state = { ...card.state, zoneRevision: 4 };
    expect(resetCardForZone(card, 'battlefield').state.zoneRevision).toBe(4);
    expect(resetCardForZone(card, 'graveyard').state.zoneRevision).toBe(5);
    expect(resetCardForZone(card, 'graveyard', 'player2').state.controllerId).toBe('player2');
  });

  it('refuses a move when the destination already holds the same card', () => {
    const room = createTestRoom();
    const card = handCard(room);
    room.players.player1.graveyard = [structuredClone(card)];
    expect(
      validateCardMove(room, { type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'hand', to: 'graveyard' }),
    ).toBe(false);
    expect(
      moveCard(room, { type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'hand', to: 'graveyard' }),
    ).toBe(room);
  });

  it('treats a missing library array as empty for an explicit insertion index', () => {
    const room = createTestRoom();
    const card = handCard(room);
    room.players.player1.deck = undefined as unknown as CardInstance[];
    const move: Move = { type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'hand', to: 'library', toIndex: 0 };
    expect(validateCardMove(room, move)).toBe(true);
    expect(getCardInZone(room, card.uuid, 'player1', 'library')).toBeUndefined();
    room.players.player1.deck = [];
    expect(moveCard(room, move).players.player1.deck).toEqual([expect.objectContaining({ uuid: card.uuid })]);
  });

  it('places a library card on the bottom or at a named index', () => {
    const room = createTestRoom();
    const card = handCard(room);
    const existing = instantiateCard('land-red');
    room.players.player1.deck = [existing];
    const bottom = moveCard(room, { type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'hand', to: 'library', libraryPlacement: 'bottom' });
    expect(bottom.players.player1.deck![0].uuid).toBe(card.uuid);
    const top = moveCard(room, { type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'hand', to: 'library', toIndex: 1 });
    expect(top.players.player1.deck![1].uuid).toBe(card.uuid);
    expect(validateCardMove(room, { type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'hand', to: 'library', libraryPlacement: 'middle' as never })).toBe(false);
    expect(validateCardMove(room, { type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'hand', to: 'library', libraryPlacement: 'top', toIndex: 0 })).toBe(false);
  });

  it('lets a token leave the battlefield once but never travel again', () => {
    const room = createTestRoom();
    const token = creature('token', 'player1');
    token.isToken = true;
    token.state = { ...token.state, zone: 'battlefield', zoneRevision: 0 };
    room.battlefield = [token];
    const left = moveCard(room, { type: 'MOVE_CARD', cardUuid: token.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' });
    expect(left.battlefield).toEqual([]);
    expect(left.players.player1.graveyard).toEqual([]);
    const exiledToken = { ...token, state: { ...token.state, zone: 'exile' as const } };
    expect(validateCardMove({ ...room, players: { ...room.players, player1: { ...room.players.player1, exile: [exiledToken] } } }, {
      type: 'MOVE_CARD', cardUuid: token.uuid, playerId: 'player1', from: 'exile', to: 'hand',
    })).toBe(false);
  });

  it('keeps a stack spell when moving another card between zones', () => {
    const room = createTestRoom();
    const card = handCard(room);
    const spellSource = instantiateCard('broken-fireball');
    const spell = { type: 'spell', uuid: 'spell', source: spellSource, controllerId: 'player1', effects: [], countered: false } as StackObject;
    room.stack = [spell];
    expect(moveCard(room, { type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'hand', to: 'graveyard' }).stack[0]).toBe(spell);
  });
});

describe('source information retention', () => {
  it('keeps spells and mismatched incarnations unchanged', () => {
    const room = createTestRoom();
    const card = creature('source', 'player1');
    const snapshot = captureSourceInformation(room, card);
    const spell = { type: 'spell', uuid: 'spell', source: card, controllerId: 'player1', effects: [], countered: false } as StackObject;
    expect(retainDepartingSource(spell, snapshot)).toBe(spell);
    const other = creature('other', 'player1');
    const triggered = { type: 'triggered', uuid: 'trig', source: other, controllerId: 'player1', effects: [], countered: false } as StackObject;
    expect(retainDepartingSource(triggered, snapshot)).toBe(triggered);
    const matching = { type: 'triggered', uuid: 'trig', source: card, controllerId: 'player1', effects: [], countered: false } as StackObject;
    expect(retainDepartingSource(matching, snapshot)).toMatchObject({ sourceInfo: snapshot });
  });

  it('prefers the live card, then the current stack item, then the stored source', () => {
    const room = createTestRoom();
    const card = creature('source', 'player1');
    card.state = { ...card.state, zoneRevision: 0 };
    room.battlefield = [card];
    const object = { type: 'triggered', uuid: 'trig', source: card, controllerId: 'player1', effects: [], countered: false } as StackObject;
    expect(resolveSourceInformation(room, object).card.uuid).toBe(card.uuid);

    const stored = captureSourceInformation(room, creature('stored', 'player1'));
    const stacked = { ...object, sourceInfo: stored } as StackObject;
    expect(resolveSourceInformation({ ...room, battlefield: [] }, stacked)).toBe(stored);

    const currentSource = captureSourceInformation(room, creature('current', 'player1'));
    expect(
      resolveSourceInformation({ ...room, battlefield: [], stack: [{ ...object, sourceInfo: currentSource }] }, stacked),
    ).toBe(currentSource);
  });

  it('falls back to the triggering departure snapshot and finally re-captures', () => {
    const room = createTestRoom();
    const card = creature('source', 'player1');
    const snapshot = captureSourceInformation(room, card);
    const departure = (snapshotCard: CardInstance): StackObject =>
      ({
        type: 'triggered',
        uuid: 'trig',
        source: card,
        controllerId: 'player1',
        effects: [],
        countered: false,
        triggeringEvent: { eventId: 'PERMANENT_DIED', payload: { snapshot: { ...snapshot, card: snapshotCard } } },
      }) as unknown as StackObject;

    expect(resolveSourceInformation(room, departure(card)).power).toBe(snapshot.power);
    const mismatched = creature('different', 'player1');
    const recaptured = resolveSourceInformation(room, departure(mismatched));
    expect(recaptured.card.uuid).toBe(card.uuid);
    expect(recaptured.power).toBe(CardCharacteristicService.resolve(room, card).power);
  });
});

describe('effect scope matching', () => {
  const room = createTestRoom();
  const card = creature('scoped', 'player1');
  card.state = { ...card.state, zoneRevision: 3 };
  const value = CardCharacteristicService.resolve(room, card);

  it('defaults broad filters to the battlefield', () => {
    expect(characteristicScope({})).toEqual({ zones: ['battlefield'] });
    expect(characteristicScope({ self: true })).toEqual({ self: true });
  });

  it('rejects a mismatched pinned revision', () => {
    expect(scopeMatches({ zoneRevision: 2 }, card, value, undefined, undefined)).toBe(false);
    expect(scopeMatches({ zoneRevision: 3 }, card, value, undefined, undefined)).toBe(true);
  });

  it('requires a live attachment to the exact incarnation', () => {
    const host = creature('host', 'player1');
    host.state = { ...host.state, zoneRevision: 1 };
    const attached = creature('scoped', 'player1');
    attached.state = { ...attached.state, attachedTo: 'host', attachedToRevision: 1 };
    expect(scopeMatches({ attachedToSource: true }, host, value, attached, 'player1')).toBe(true);
    expect(scopeMatches({ attachedToSource: true }, host, value, undefined, 'player1')).toBe(false);
    const stale = { ...attached, state: { ...attached.state, attachedToRevision: 2 } };
    expect(scopeMatches({ attachedToSource: true }, host, value, stale, 'player1')).toBe(false);
  });

  it('matches self, explicit objects, zone filters and card filters', () => {
    expect(scopeMatches({ self: true }, card, value, card, 'player1')).toBe(true);
    expect(scopeMatches({ self: true }, card, value, creature('other', 'player1'), 'player1')).toBe(false);
    expect(scopeMatches({ objects: [{ cardUuid: 'scoped', zoneRevision: 3 }] }, card, value, undefined, 'player1')).toBe(true);
    expect(scopeMatches({ objects: [{ cardUuid: 'scoped', zoneRevision: 2 }] }, card, value, undefined, 'player1')).toBe(false);
    expect(scopeMatches({ zones: ['battlefield'] }, card, value, undefined, 'player1')).toBe(true);
    expect(scopeMatches({ zones: ['hand'] }, card, value, undefined, 'player1')).toBe(false);
    expect(scopeMatches({ cardUuid: 'other' }, card, value, undefined, 'player1')).toBe(false);
    expect(scopeMatches({ cardTypes: ['Creature'] }, card, value, undefined, 'player1')).toBe(true);
  });
});

function effect(overrides: Partial<StackEffect> = {}): StackEffect {
  return {
    action: 'TAP',
    params: {},
    tags: [],
    targets: [],
    targeting: { type: 'permanent', required: true },
    ...overrides,
  };
}

describe('target group planning', () => {
  function fixture(): { room: GameRoom; source: CardInstance; target: CardInstance } {
    const room = createTestRoom({ battlefield: [creature('target', 'player2')] });
    const source = instantiateCard('empire-servant');
    source.state = { ...source.state, zone: 'hand', ownerId: 'player1', controllerId: 'player1' };
    return { room, source, target: room.battlefield[0] };
  }

  it('reports an invalid target group definition', () => {
    const { room, source } = fixture();
    expect(planTargetGroups(room, 'player1', source, [effect({ targetGroup: '  ' })], {})).toEqual({
      success: false,
      reason: 'Target group ID must be nonempty',
    });
  });

  it('rejects mixed or malformed selection formats', () => {
    const { room, source } = fixture();
    const effects = [effect({ targetGroup: 'target' })];
    expect(planTargetGroups(room, 'player1', source, effects, { targetGroups: [], targets: [] })).toEqual({
      success: false,
      reason: 'Use one target selection format',
    });
    expect(planTargetGroups(room, 'player1', source, effects, { targetGroups: 'nope' })).toEqual({
      success: false,
      reason: 'Use one target selection format',
    });
    expect(planTargetGroups(room, 'player1', source, effects, { targetGroups: [null] })).toEqual({
      success: false,
      reason: 'Invalid target groups',
    });
    expect(planTargetGroups(room, 'player1', source, effects, { targets: 'nope' })).toEqual({
      success: false,
      reason: 'Invalid targets',
    });
    expect(planTargetGroups(room, 'player1', source, [effect({ targeting: { type: 'self', required: false } })], {
      targets: [{ targetType: 'permanent', cardUuid: 'target' }],
    })).toEqual({ success: false, reason: 'This action does not choose targets' });
  });

  it('requires explicit maxima for multi-group flat selections', () => {
    const { room, source } = fixture();
    expect(planTargetGroups(room, 'player1', source, [effect({ targetGroup: 'a' }), effect({ targetGroup: 'b' })], {
      targets: [],
    })).toEqual({ success: false, reason: 'Select targets by group' });
    expect(planTargetGroups(room, 'player1', source, [effect({ targetGroup: 'a', targeting: { type: 'permanent', required: false, maxTargets: 1 } })], {
      targets: [
        { targetType: 'permanent', cardUuid: 'target' },
        { targetType: 'permanent', cardUuid: 'target' },
      ],
    })).toEqual({ success: false, reason: 'Select targets by group' });
  });

  it('rejects duplicate and unknown groups', () => {
    const { room, source } = fixture();
    expect(planTargetGroups(room, 'player1', source, [effect({ targetGroup: 'a' })], {
      targetGroups: [
        { id: 'a', targets: [] },
        { id: 'a', targets: [] },
      ],
    })).toEqual({ success: false, reason: 'Missing, duplicate or unknown target group' });
  });

  it('rejects too few, duplicate or illegal targets', () => {
    const { room, source } = fixture();
    expect(planTargetGroups(room, 'player1', source, [effect({ targetGroup: 'a' })], {
      targetGroups: [{ id: 'a', targets: [] }],
    })).toEqual({ success: false, reason: 'Target is not legal' });
    expect(planTargetGroups(room, 'player1', source, [effect({ targetGroup: 'a', targeting: { type: 'permanent', required: true, maxTargets: 2 } })], {
      targetGroups: [{
        id: 'a',
        targets: [
          { targetType: 'permanent', cardUuid: 'target' },
          { targetType: 'permanent', cardUuid: 'target' },
        ],
      }],
    })).toEqual({ success: false, reason: 'Target is not legal' });
    expect(planTargetGroups(room, 'player1', source, [effect({ targetGroup: 'a' })], {
      targetGroups: [{ id: 'a', targets: [{ targetType: 'permanent', cardUuid: 'missing' }] }],
    })).toEqual({ success: false, reason: 'Target is not legal' });
  });

  it('plans a single implicit group from a flat target list', () => {
    const { room, source, target } = fixture();
    const plan = planTargetGroups(room, 'player1', source, [effect({ targetGroup: 'target' })], {
      targets: [{ targetType: 'permanent', cardUuid: target.uuid }],
    });
    expect(plan.success).toBe(true);
    if (!plan.success) return;
    expect(plan.groups[0].targets).toEqual([
      { targetType: 'permanent', cardUuid: target.uuid, zone: 'battlefield', zoneRevision: 0 },
    ]);
    expect(plan.effects[0].targets).toEqual(plan.groups[0].targets);
  });

  it('plans player targets without a card reference', () => {
    const { room, source } = fixture();
    const plan = planTargetGroups(
      room,
      'player1',
      source,
      [effect({ targetGroup: 'player-group', targeting: { type: 'player', required: true, maxTargets: 1 } })],
      { targetGroups: [{ id: 'player-group', targets: [{ targetType: 'player', playerId: 'player2' }] }] },
    );
    expect(plan.success).toBe(true);
    if (!plan.success) return;
    expect(plan.groups[0].targets).toEqual([{ targetType: 'player', playerId: 'player2' }]);
  });

  it('leaves effects without explicit targeting untouched', () => {
    const { room, source } = fixture();
    const implicit = effect({ targeting: { type: 'self', required: false } });
    const plan = planTargetGroups(room, 'player1', source, [implicit], {});
    expect(plan).toEqual({ success: true, groups: [], effects: [implicit] });
  });

  it('defaults an effect with no targeting definition to self', () => {
    const { room, source } = fixture();
    const bare = { action: 'TAP', params: {}, tags: [], targets: [] } as StackEffect;
    const plan = planTargetGroups(room, 'player1', source, [bare], {});
    expect(plan).toEqual({ success: true, groups: [], effects: [bare] });
  });
});

