import { describe, expect, it } from 'vitest';
import { ActionValidator } from '@engine/action-validator';
import { materializeAnnouncementCost } from '@engine/announcement-values';
import type { CardInstance } from '@shared/card.types';
import type { GameRoom } from '@shared/game.room.types';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';

const permanent = (required = false) => ({ type: 'permanent', required }) as never;

function inZone(card: CardInstance, zone: CardInstance['state']['zone']): CardInstance {
  card.state.zone = zone;
  return card;
}

describe('ActionValidator.canMeetCondition', () => {
  it('passes without a condition and fails without the acting player', () => {
    const room = createTestRoom();
    expect(ActionValidator.canMeetCondition(room, 'player1')).toBe(true);
    // A condition object without a zone scan imposes no requirement.
    expect(ActionValidator.canMeetCondition(room, 'player1', {})).toBe(true);
    expect(ActionValidator.canMeetCondition({ ...room, players: {} }, 'player1', {})).toBe(false);
  });

  it('resolves controllers of battlefield cards while scanning', () => {
    const room = createTestRoom();
    room.battlefield = [creature('board-card', 'player1')];
    expect(ActionValidator.canMeetCondition(room, 'player1', {
      zoneCheck: { zone: ['battlefield'], ownedBy: 'self', cardId: 'board-card' },
    } as never)).toBe(true);
  });

  it('counts matching cards across the requested zones and owners', () => {
    const room = createTestRoom();
    const spell = creature('spell-in-hand', 'player1');
    spell.blueprint = { ...spell.blueprint, cardTypes: ['Spell'], id: 'spell-id' };
    inZone(spell, 'hand');
    room.players.player1.hand = [spell];
    room.players.player1.graveyard = [inZone(creature('dead-creature', 'player1'), 'graveyard')];
    room.players.player2.hand = [inZone(creature('their-creature', 'player2'), 'hand')];

    const zoneCheck = (over: Record<string, unknown>) => ({ zoneCheck: { zone: ['hand'], ownedBy: 'self', ...over } });

    // A bare zone scan sees the hand card.
    expect(ActionValidator.canMeetCondition(room, 'player1', zoneCheck({}) as never)).toBe(true);
    // Card type and card id narrow the scan.
    expect(ActionValidator.canMeetCondition(room, 'player1', zoneCheck({ cardType: 'Creature' }) as never)).toBe(false);
    expect(ActionValidator.canMeetCondition(room, 'player1', zoneCheck({ cardId: 'spell-id' }) as never)).toBe(true);
    expect(ActionValidator.canMeetCondition(room, 'player1', zoneCheck({ cardId: 'other-id' }) as never)).toBe(false);
    // An authored filter applies on top of the zone scan.
    expect(ActionValidator.canMeetCondition(room, 'player1', zoneCheck({ filter: { cardTypes: ['Spell'] } }) as never)).toBe(true);
    expect(ActionValidator.canMeetCondition(room, 'player1', zoneCheck({ filter: { colors: ['red'] } }) as never)).toBe(false);
    // Required counts enforce a minimum.
    expect(ActionValidator.canMeetCondition(room, 'player1', zoneCheck({ minCount: 2 }) as never)).toBe(false);
    expect(ActionValidator.canMeetCondition(room, 'player1', zoneCheck({ minCount: 1 }) as never)).toBe(true);
    // Ownership can be relative to the opponent.
    expect(ActionValidator.canMeetCondition(room, 'player1', {
      zoneCheck: { zone: ['hand'], ownedBy: 'opponent', cardId: 'their-creature' },
    } as never)).toBe(true);
    expect(ActionValidator.canMeetCondition(room, 'player1', {
      zoneCheck: { zone: ['graveyard'], ownedBy: 'self' },
    } as never)).toBe(true);
  });
});

describe('ActionValidator.canPayCost', () => {
  const base = () => {
    const room = createTestRoom();
    const card = creature('payer', 'player1', 2, 2);
    room.battlefield = [card];
    return { room, card };
  };

  it('passes without a cost and checks every independent resource', () => {
    const { room, card } = base();
    expect(ActionValidator.canPayCost(room, 'player1', card)).toBe(true);
    expect(ActionValidator.canPayCost(room, 'player1', card, { mana: { red: 1 } })).toBe(true);
    expect(ActionValidator.canPayCost(room, 'player1', card, { mana: { red: 99 } })).toBe(false);
    expect(ActionValidator.canPayCost(room, 'player1', card, { life: 5 })).toBe(true);
    expect(ActionValidator.canPayCost(room, 'player1', card, { life: 21 })).toBe(false);
    expect(ActionValidator.canPayCost(room, 'player1', card, { tap: true })).toBe(true);
    card.state.isTapped = true;
    expect(ActionValidator.canPayCost(room, 'player1', card, { tap: true })).toBe(false);
    expect(ActionValidator.canPayCost(room, 'player1', card, { untap: true })).toBe(true);
    card.state.isTapped = false;
    expect(ActionValidator.canPayCost(room, 'player1', card, { untap: true })).toBe(false);
    expect(ActionValidator.canPayCost(room, 'player1', card, { loyalty: 0 })).toBe(false);
  });

  it('requires a self-discard source with the same incarnation in hand', () => {
    const { room, card } = base();
    expect(ActionValidator.canPayCost(room, 'player1', card, { discardSelf: true })).toBe(false);

    const inHand = creature('self-card', 'player1');
    inHand.state.zone = 'hand';
    room.players.player1.hand = [inHand];
    expect(ActionValidator.canPayCost(room, 'player1', inHand, { discardSelf: true })).toBe(true);

    room.players.player1.hand = [{ ...inHand, state: { ...inHand.state, zoneRevision: 5 } }];
    expect(ActionValidator.canPayCost(room, 'player1', inHand, { discardSelf: true })).toBe(false);

    room.players.player1.hand = [{ ...inHand, state: { ...inHand.state, zone: 'library' } }];
    expect(ActionValidator.canPayCost(room, 'player1', inHand, { discardSelf: true })).toBe(false);

    // A missing revision on both sides compares as revision zero.
    const unrevisioned = creature('unrevisioned', 'player1');
    delete (unrevisioned.state as { zoneRevision?: number }).zoneRevision;
    unrevisioned.state.zone = 'hand';
    const handCopy = structuredClone(unrevisioned);
    delete (handCopy.state as { zoneRevision?: number }).zoneRevision;
    room.players.player1.hand = [handCopy];
    expect(ActionValidator.canPayCost(room, 'player1', unrevisioned, { discardSelf: true })).toBe(true);
  });

  it('requires a controlled sacrifice source on the battlefield', () => {
    const { room, card } = base();
    expect(ActionValidator.canPayCost(room, 'player1', card, { sacrifice: true })).toBe(true);
    expect(ActionValidator.canPayCost(room, 'player2', card, { sacrifice: true })).toBe(false);
  });

  it('blocks tap costs for summoning-sick creatures without haste', () => {
    const { room, card } = base();
    card.state.summoningSickness = true;
    expect(ActionValidator.canPayCost(room, 'player1', card, { tap: true })).toBe(false);
    // A non-tap ability is unaffected by summoning sickness.
    expect(ActionValidator.canPayCost(room, 'player1', card, {})).toBe(true);

    const hasty = creature('hasty', 'player1', 2, 2, ['Haste']);
    hasty.state.summoningSickness = true;
    room.battlefield = [hasty];
    expect(ActionValidator.canPayCost(room, 'player1', hasty, { tap: true })).toBe(true);

    const sickRock = creature('sick-rock', 'player1');
    sickRock.blueprint = { ...sickRock.blueprint, cardTypes: ['Artifact'] };
    sickRock.state.summoningSickness = true;
    room.battlefield = [sickRock];
    expect(ActionValidator.canPayCost(room, 'player1', sickRock, { tap: true })).toBe(true);
  });

  it('refuses unaffordable counters, materials and discards', () => {
    const { room, card } = base();
    card.state.counters = { charge: 2 };
    expect(ActionValidator.canPayCost(room, 'player1', card, {
      removeCounters: [{ from: 'source', counterType: 'charge', amount: 2 }],
    })).toBe(true);
    expect(ActionValidator.canPayCost(room, 'player1', card, {
      removeCounters: [{ from: 'source', counterType: 'charge', amount: 3 }],
    })).toBe(false);

    const material = creature('material', 'player1');
    material.blueprint = {
      ...material.blueprint,
      castRequirements: { allowedZones: ['hand'], cost: { mana: { red: 2 } } },
    };
    card.state.zone = 'battlefield';
    room.battlefield = [card, material];
    expect(ActionValidator.canPayCost(room, 'player1', card, {
      destroyMaterials: { filter: { cardTypes: ['Creature'] }, manaValueGreaterThan: 0 },
    })).toBe(true);
    expect(ActionValidator.canPayCost(room, 'player1', card, {
      destroyMaterials: { filter: { cardTypes: ['Creature'] }, manaValueGreaterThan: 99 },
    })).toBe(false);

    room.players.player1.hand = [inZone(creature('only-card', 'player1'), 'hand')];
    expect(ActionValidator.canPayCost(room, 'player1', card, { discard: 1 })).toBe(true);
    expect(ActionValidator.canPayCost(room, 'player1', card, { discard: 2 })).toBe(false);
  });
});

describe('ActionValidator.canTarget', () => {
  const room = () => {
    const built = createTestRoom();
    built.battlefield = [creature('mine', 'player1'), creature('theirs', 'player2')];
    built.stack = [{ uuid: 'stack-1', type: 'spell', controllerId: 'player1', source: creature('spell-src', 'player1') } as never];
    return built;
  };

  it('enforces count bounds and duplicate rejection', () => {
    const built = room();
    const card = built.battlefield[0];
    expect(ActionValidator.canTarget(built, 'player1', card, [], permanent(true))).toBe(false);
    expect(ActionValidator.canTarget(built, 'player1', card, [], permanent(false))).toBe(true);
    expect(ActionValidator.canTarget(built, 'player1', card, [], { type: 'permanent', required: false, minTargets: 1 } as never)).toBe(false);
    expect(ActionValidator.canTarget(built, 'player1', card, [
      { targetType: 'permanent', cardUuid: 'mine', zoneRevision: 0 },
      { targetType: 'permanent', cardUuid: 'mine', zoneRevision: 0 },
    ], permanent())).toBe(false);
    expect(ActionValidator.canTarget(built, 'player1', card, [
      { targetType: 'permanent', cardUuid: 'mine' },
    ], { type: 'permanent', required: true, maxTargets: 0 } as never)).toBe(false);
  });

  it('delegates structural legality per target', () => {
    const built = room();
    const card = built.battlefield[0];
    expect(ActionValidator.canTarget(built, 'player1', card, [
      { targetType: 'permanent', cardUuid: 'mine', zoneRevision: 0 },
    ], permanent(true))).toBe(true);
    expect(ActionValidator.canTarget(built, 'player1', card, [
      { targetType: 'permanent', cardUuid: 'ghost' },
    ], permanent(true))).toBe(false);
    expect(ActionValidator.canTarget(built, 'player1', card, [
      { targetType: 'player', playerId: 'player2' },
    ], { type: 'player', required: true } as never)).toBe(true);
    expect(ActionValidator.canTarget(built, 'player1', card, [
      { targetType: 'spell', stackUuid: 'stack-1' },
    ], { type: 'spell', required: true } as never)).toBe(true);
  });
});

describe('ActionValidator.canActivate', () => {
  function activationRoom() {
    const room = createTestRoom();
    const card = creature('activator', 'player1', 2, 2);
    room.battlefield = [card];
    room.players.player1.hand = [card];
    card.state.zone = 'battlefield';
    return { room, card };
  }

  const requirements = (over: Record<string, unknown> = {}) => ({
    allowedZones: ['battlefield'],
    speed: 'sorcery',
    ...over,
  }) as never;

  it('blocks every action while a combat declaration is outstanding', () => {
    const { room, card } = activationRoom();
    const pending: GameRoom = { ...room, phase: 'declareAttackersStep' };
    expect(ActionValidator.canActivate(pending, 'player1', card, requirements())).toEqual({
      valid: false,
      reason: 'Combat declaration is required',
    });
    // A non-empty stack means the declaration is no longer blocking.
    expect(ActionValidator.canActivate(
      { ...pending, stack: [{} as never] },
      'player1',
      card,
      requirements({ speed: 'instant' }),
    )).toEqual({ valid: true });
  });

  it('honours a permission rule that prohibits the action', () => {
    const { room, card } = activationRoom();
    const source = creature('lock-source', 'player1');
    room.battlefield = [card, source];
    room.continuousEffectPool = [{
      layer: 80,
      duration: 'PERMANENT',
      source: source.uuid,
      effect: { type: 'PERMISSION', rules: [{ action: 'activate', mode: 'prohibit', players: 'self' }] },
      scope: { objects: [{ cardUuid: card.uuid, zoneRevision: 0 }] },
    }] as never;
    expect(ActionValidator.canActivate(room, 'player1', card, requirements())).toEqual({
      valid: false,
      reason: 'An effect prohibits this activate action',
    });
  });

  it('checks zone, timing, conditions, cost materialisation, affordability and priority in order', () => {
    const { room, card } = activationRoom();
    expect(ActionValidator.canActivate(room, 'player1', card, requirements({ allowedZones: ['hand'] }))).toEqual({
      valid: false,
      reason: 'Action cannot be initiated from battlefield',
    });

    expect(ActionValidator.canActivate({ ...room, phase: 'stateEndPhase' }, 'player1', card, requirements())).toEqual({
      valid: false,
      reason: 'Can only perform this action at sorcery speed during your main phase.',
    });
    expect(ActionValidator.canActivate({ ...room, phase: 'stateEndPhase' }, 'player1', card, requirements({ speed: 'instant' })).valid).toBe(true);

    expect(ActionValidator.canActivate(room, 'player1', card, requirements({
      condition: { zoneCheck: { zone: ['graveyard'], ownedBy: 'self' } },
    }))).toEqual({
      valid: false,
      reason: 'Game state conditions for this action are not met.',
    });

    expect(ActionValidator.canActivate(room, 'player1', card, requirements({
      cost: { mana: { generic: { numeric: { kind: 'binding', name: 'X' } } } },
    }))).toEqual({
      valid: false,
      reason: 'Choose numbers before checking cost affordability',
    });

    expect(ActionValidator.canActivate(room, 'player1', card, requirements({ cost: { life: 99 } }))).toEqual({
      valid: false,
      reason: 'Cannot afford the resource costs for this action.',
    });

    expect(ActionValidator.canActivate({ ...room, priorityPlayerId: 'player2' }, 'player1', card, requirements())).toEqual({
      valid: false,
      reason: 'You do not have priority to act right now.',
    });

    expect(ActionValidator.canActivate(room, 'player1', card, requirements({ cost: { life: 1 } }))).toEqual({ valid: true });
  });

  it('infers the default action from the card zone', () => {
    const { room, card } = activationRoom();
    const handCard = creature('hand-card', 'player1');
    handCard.state.zone = 'hand';
    room.players.player1.hand = [handCard];

    // A hand card defaults to "cast", so a battlefield-only requirement rejects it.
    expect(ActionValidator.canActivate(room, 'player1', handCard, {
      allowedZones: ['battlefield'],
      speed: 'instant',
    } as never)).toEqual({ valid: false, reason: 'Action cannot be initiated from hand' });
    // The same card satisfies a hand-only requirement through the default "cast" action.
    expect(ActionValidator.canActivate(room, 'player1', handCard, {
      allowedZones: ['hand'],
      speed: 'instant',
    } as never).valid).toBe(true);
    // A battlefield card defaults to "activate".
    expect(ActionValidator.canActivate(room, 'player1', card, requirements())).toEqual({ valid: true });
    // Explicit action overrides the inference.
    expect(ActionValidator.canActivate(room, 'player1', handCard, {
      allowedZones: ['hand'],
      speed: 'instant',
    } as never, 'activate').valid).toBe(true);
  });
});

describe('materializeAnnouncementCost contract', () => {
  it('rejects a generic requirement that resolves to a non-integer', () => {
    expect(() => materializeAnnouncementCost({ mana: { generic: -1 } })).toThrow('Invalid generic mana requirement');
    expect(materializeAnnouncementCost({ mana: { red: 1 } })).toEqual({ mana: { red: 1 } });
  });
});
