import { describe, expect, it } from 'vitest';
import { findActivationSource } from '@engine/activation-source';
import { createToken, planTokenCreation } from '@engine/token-creation';
import { legalEquipmentAttachment } from '@engine/mechanics/equipment';
import { closeCardObservations, recordCardObservation } from '@engine/observation-state';
import { CombatRuleRegistry, type CombatRule } from '@engine/combat-rules';
import { expandBoundedReveal } from '@engine/bounded-reveal';
import {
  canChooseCapturedCard,
  capturedChoiceAllowed,
  captureCardWindow,
  choiceSourceOrderVisible,
  setCollectionVisibility,
} from '@engine/captured-windows';
import { createTestRoom, fillTestLibraries } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';
import { instantiateCard } from '@library/card-factory';
import type { CardInstance } from '@shared/card.types';
import type { GameRoom } from '@shared/game.room.types';
import type { GameMutation } from '@shared/game-mutation.types';
import type { StackEffect, StackObject, TriggeredStackObject } from '@shared/effect.types';
import type { CardObservation } from '@shared/card-observation.types';
import type { PendingChoice, ResolutionContinuation } from '@shared/choice.types';
import type { DamageAssignment, DamageRecipient } from '@shared/damage.types';
import type { CardSnapshot } from '@shared/card.types';

const publicVisibility = {
  faces: ['all_players' as const],
  count: ['all_players' as const],
  order: ['all_players' as const],
  expires: 'resolution_end' as const,
};
const privateVisibility = {
  faces: ['controller' as const],
  count: ['all_players' as const],
  order: ['controller' as const],
  expires: 'resolution_end' as const,
};
const snapshotOf = (card: CardInstance): CardSnapshot => ({ card: structuredClone(card), power: 1, toughness: 1 });

function stackSpell(room: GameRoom, overrides: Partial<StackObject> = {}): StackObject {
  const source = room.battlefield[0] ?? creature('reveal-source', 'player1');
  return {
    uuid: 'stack-object',
    type: 'spell',
    controllerId: 'player1',
    source,
    effects: [],
    countered: false,
    ...overrides,
  } as StackObject;
}

function revealEffect(params: Record<string, unknown>, instructionId?: string): StackEffect {
  return {
    action: 'REVEAL_TOP',
    params,
    tags: [],
    targets: [],
    ...(instructionId === undefined ? {} : { instructionId }),
  };
}

describe('activation source lookup', () => {
  it('needs a card id before searching any zone', () => {
    const room = createTestRoom();
    expect(findActivationSource(room, 'player1', undefined)).toBeUndefined();
    expect(findActivationSource(room, 'player1', '')).toBeUndefined();
  });

  it('finds a controlled battlefield permanent before falling back to the hand', () => {
    const room = createTestRoom();
    const onBoard = creature('board-card', 'player1');
    const inHand = instantiateCard('empire-servant');
    inHand.state = { ...inHand.state, zone: 'hand', ownerId: 'player1', controllerId: 'player1' };
    const opponentBoard = creature('opponent-card', 'player2');
    room.battlefield = [onBoard, opponentBoard];
    room.players.player1.hand = [inHand];

    expect(findActivationSource(room, 'player1', 'board-card')).toBe(onBoard);
    expect(findActivationSource(room, 'player1', inHand.uuid)).toBe(inHand);
    expect(findActivationSource(room, 'player1', 'opponent-card')).toBeUndefined();
    expect(findActivationSource(room, 'player1', 'missing')).toBeUndefined();
  });
});

describe('token creation planning and admission', () => {
  it('allocates one mutation per recipient with monotonic identities', () => {
    const room = createTestRoom();
    let next = 0;
    const effect: StackEffect = {
      action: 'CREATE_TOKEN',
      params: { tokenId: 'token-angel-1-1', amount: 2 },
      tags: [],
      targets: [
        { targetType: 'player', playerId: 'player1' },
        { targetType: 'player', playerId: 'player2' },
        { targetType: 'player', playerId: 'ghost' },
      ],
    };
    const mutations = planTokenCreation(room, effect, { random: Math.random, uuid: () => `generated-${next++}` });
    expect(mutations).toHaveLength(4);
    expect(mutations.map((mutation) => mutation.type === 'CREATE_TOKEN' && mutation.sequence)).toEqual([1, 2, 3, 4]);
    expect(mutations.every((mutation) => mutation.type === 'CREATE_TOKEN' && mutation.tokenId === 'token-angel-1-1')).toBe(true);
  });

  it('defaults a missing amount to one and uses the default uuid source', () => {
    const room = createTestRoom();
    const effect: StackEffect = {
      action: 'CREATE_TOKEN',
      params: { tokenId: 'token-angel-1-1' },
      tags: [],
      targets: [{ targetType: 'player', playerId: 'player1' }],
    };
    const mutations = planTokenCreation(room, effect, { random: Math.random });
    expect(mutations).toHaveLength(1);
    expect(mutations[0].type === 'CREATE_TOKEN' && mutations[0].cardUuid).toMatch(/[0-9a-f-]{36}/);
  });

  it('refuses invalid token ids, amounts, budgets, recipients and identities', () => {
    const room = createTestRoom();
    const base = { action: 'CREATE_TOKEN', tags: [], targets: [{ targetType: 'player' as const, playerId: 'player1' }] };
    const context = { random: Math.random, uuid: () => 'token-uuid' };
    expect(planTokenCreation(room, { ...base, params: { tokenId: 7, amount: 1 } }, context)).toEqual([]);
    expect(planTokenCreation(room, { ...base, params: { tokenId: 'missing-token', amount: 1 } }, context)).toEqual([]);
    expect(planTokenCreation(room, { ...base, params: { tokenId: 'token-angel-1-1', amount: 1.5 } }, context)).toEqual([]);
    expect(planTokenCreation(room, { ...base, params: { tokenId: 'token-angel-1-1', amount: -1 } }, context)).toEqual([]);
    expect(planTokenCreation(room, { ...base, params: { tokenId: 'token-angel-1-1', amount: 65 } }, context)).toEqual([]);
    expect(
      planTokenCreation(
        room,
        {
          ...base,
          params: { tokenId: 'token-angel-1-1', amount: 40 },
          targets: [
            { targetType: 'player', playerId: 'player1' },
            { targetType: 'player', playerId: 'player2' },
          ],
        },
        context,
      ),
    ).toEqual([]);
    expect(planTokenCreation(room, { ...base, params: { tokenId: 'token-angel-1-1', amount: 1 } }, { random: Math.random, uuid: () => '' })).toEqual([]);
    expect(planTokenCreation(room, { ...base, params: { tokenId: 'token-angel-1-1', amount: 1 } }, { random: Math.random, uuid: () => 4 as unknown as string })).toEqual([]);
    const occupied = creature('token-uuid', 'player1');
    room.battlefield = [occupied];
    expect(planTokenCreation(room, { ...base, params: { tokenId: 'token-angel-1-1', amount: 1 } }, context)).toEqual([]);
  });

  it('admits a canonical token creation and rejects tampered proposals', () => {
    const room = createTestRoom();
    const valid: Extract<GameMutation, { type: 'CREATE_TOKEN' }> = {
      type: 'CREATE_TOKEN',
      tokenId: 'token-angel-1-1',
      cardUuid: 'fresh-token',
      playerId: 'player1',
      sequence: 1,
    };
    const after = createToken(room, valid);
    expect(after.battlefield.map((card) => card.uuid)).toContain('fresh-token');
    expect(after.tokenSequence).toBe(1);
    expect(after.battlefield[0].state.characteristicTimestamp).toBeGreaterThan(0);

    expect(createToken(room, { ...valid, sequence: 0 })).toBe(room);
    expect(createToken(room, { ...valid, sequence: 2 })).toBe(room);
    expect(createToken(room, { ...valid, tokenId: 'missing-token' })).toBe(room);
    expect(createToken(room, { ...valid, playerId: 'ghost' })).toBe(room);
    expect(createToken(room, { ...valid, cardUuid: '' })).toBe(room);
    expect(createToken(room, { ...valid, cardUuid: 5 as unknown as string })).toBe(room);
    const occupied = creature('fresh-token', 'player1');
    expect(createToken({ ...room, battlefield: [occupied] }, valid)).toStrictEqual({ ...room, battlefield: [occupied] });
  });
});

describe('equipment attachment legality', () => {
  function equipment(uuid: string, subtype = 'Equipment'): CardInstance {
    const card = creature(uuid, 'player1');
    card.blueprint = { ...card.blueprint, subTypes: [subtype] };
    return card;
  }
  function operation(overrides: Partial<Extract<GameMutation, { type: 'ATTACH_CARD' }>> = {}) {
    return {
      type: 'ATTACH_CARD' as const,
      cardUuid: 'sword',
      zoneRevision: 0,
      hostUuid: 'knight',
      hostRevision: 0,
      controllerId: 'player1',
      ...overrides,
    };
  }

  it('accepts an equipment attached to a legal creature host', () => {
    const room = createTestRoom();
    room.battlefield = [equipment('sword'), creature('knight', 'player1')];
    expect(legalEquipmentAttachment(room, operation())).toBe(true);

    const withoutRevision = (card: CardInstance): CardInstance => {
      const state = { ...card.state };
      delete state.zoneRevision;
      return { ...card, state };
    };
    room.battlefield = [withoutRevision(equipment('sword')), withoutRevision(creature('knight', 'player1'))];
    expect(legalEquipmentAttachment(room, operation())).toBe(true);
  });

  it('rejects non-equipment sources, mismatched controllers and stale incarnations', () => {
    const room = createTestRoom();
    room.battlefield = [equipment('sword', 'Artifact'), creature('knight', 'player1')];
    expect(legalEquipmentAttachment(room, operation())).toBe(false);
    room.battlefield = [equipment('sword'), creature('knight', 'player1')];
    expect(legalEquipmentAttachment(room, operation({ controllerId: 'player2' }))).toBe(false);
    expect(legalEquipmentAttachment(room, operation({ zoneRevision: 3 }))).toBe(false);
    expect(legalEquipmentAttachment(room, operation({ hostUuid: 'missing' }))).toBe(false);
    expect(legalEquipmentAttachment(room, operation({ hostUuid: 'sword' }))).toBe(false);
  });

  it('requires a creature host and an allowed attachment target', () => {
    const room = createTestRoom();
    const artifactHost = creature('artifact-host', 'player1');
    artifactHost.blueprint = { ...artifactHost.blueprint, cardTypes: ['Artifact'] };
    room.battlefield = [equipment('sword'), artifactHost];
    expect(legalEquipmentAttachment(room, operation({ hostUuid: 'artifact-host' }))).toBe(false);

    room.battlefield = [equipment('sword'), creature('knight', 'player1')];
    const requiringSword = equipment('sword');
    requiringSword.blueprint = {
      ...requiringSword.blueprint,
      attachmentRequirements: { type: 'permanent', required: true, cardTypes: ['Creature'] },
    };
    room.battlefield = [requiringSword, creature('knight', 'player1')];
    expect(legalEquipmentAttachment(room, operation())).toBe(true);

    const shrouded = creature('knight', 'player1');
    shrouded.blueprint = { ...shrouded.blueprint, keywords: ['Shroud'] };
    room.battlefield = [equipment('sword'), shrouded];
    expect(legalEquipmentAttachment(room, operation())).toBe(false);

    const unmet = equipment('sword');
    unmet.blueprint = {
      ...unmet.blueprint,
      attachmentRequirements: { type: 'permanent', required: true, cardTypes: ['Land'] },
    };
    room.battlefield = [unmet, creature('knight', 'player1')];
    expect(legalEquipmentAttachment(room, operation())).toBe(false);
  });
});

describe('card observation state', () => {
  function observation(overrides: Partial<CardObservation> = {}): CardObservation {
    const card = creature('observed', 'player1');
    return {
      id: 'observation',
      ownerStackUuid: 'stack-object',
      resultName: 'window',
      controllerId: 'player1',
      zoneOwnerId: 'player1',
      sourceInfo: snapshotOf(card),
      emptyAudience: { faces: [], count: [], order: [] },
      turnNumber: 1,
      members: [{ snapshot: snapshotOf(card), audience: { faces: ['player1'], count: ['player1'], order: ['player1'] } }],
      ...overrides,
    };
  }

  it('commits a monotonic sequence and retains authorized history', () => {
    const room = createTestRoom();
    const next = recordCardObservation(room, observation(), 1);
    expect(next.cardObservations?.sequence).toBe(1);
    expect(next.cardObservations?.active.observation.id).toBe('observation');
    expect(next.cardObservations?.history).toHaveLength(1);
    expect(next).not.toBe(room);
  });

  it('ignores sequences that are unsafe, non-positive or out of order', () => {
    const room = createTestRoom();
    expect(recordCardObservation(room, observation(), 0)).toBe(room);
    expect(recordCardObservation(room, observation(), -1)).toBe(room);
    expect(recordCardObservation(room, observation(), 1.5)).toBe(room);
    const first = recordCardObservation(room, observation(), 1);
    expect(recordCardObservation(first, observation(), 3)).toBe(first);
  });

  it('bounds retained history per visible audience without evicting private revisions', () => {
    const card = creature('observed', 'player1');
    const member = { snapshot: snapshotOf(card), audience: { faces: ['player1'], count: ['player1'], order: ['player1'] } };
    const history = Array.from({ length: 128 }, (_, index) => ({
      sequence: index + 1,
      observation: observation({ id: `old-${index}`, members: [member] }),
    }));
    const room = createTestRoom({ cardObservations: { sequence: 128, active: {}, history } });
    const next = recordCardObservation(room, observation(), 129);
    expect(next.cardObservations?.history).toHaveLength(128);
    expect(next.cardObservations?.history[0].sequence).toBe(2);
    expect(next.cardObservations?.history.at(-1)?.sequence).toBe(129);
  });

  it('skips an absent second player and keeps private observations hidden from others', () => {
    const room = createTestRoom({ player2Id: null });
    const privateObservation = observation({
      members: [{ snapshot: snapshotOf(creature('hidden', 'player1')), audience: { faces: ['player1'], count: ['player1'], order: [] } }],
    });
    const next = recordCardObservation(room, privateObservation, 1);
    expect(next.cardObservations?.history).toHaveLength(1);
    expect(next.cardObservations?.history[0].observation.members[0].audience.faces).toEqual(['player1']);
  });

  it('closes temporary grants only for the named stack and leaves unrelated rooms alone', () => {
    const room = createTestRoom();
    expect(closeCardObservations(room)).toBe(room);

    const observationState = {
      sequence: 2,
      active: {
        mine: observation({ id: 'mine', ownerStackUuid: 'stack-a' }),
        other: observation({ id: 'other', ownerStackUuid: 'stack-b' }),
      },
      history: [],
    };
    const withState = createTestRoom({ cardObservations: observationState });
    const cleared = closeCardObservations(withState);
    expect(cleared.cardObservations!.active).toEqual({});
    const closed = closeCardObservations(withState, 'stack-a');
    expect(Object.keys(closed.cardObservations!.active)).toEqual(['other']);
    expect(closed).not.toBe(withState);
    expect(closeCardObservations(withState, 'unrelated-stack')).toBe(withState);
  });
});

describe('combat rule registry', () => {
  const room = createTestRoom();
  const attacker = creature('attacker', 'player1', 3, 3, ['Trample']);
  const blocker = creature('blocker', 'player2', 2, 4);
  room.battlefield = [attacker, blocker];
  const declaration = {
    uuid: 'attacker',
    attacker,
    attackerPower: 3,
    blockers: [blocker],
    blocked: true,
  };
  const damageContext = {
    room,
    declaration,
    source: attacker,
    role: 'attacker' as const,
    pass: 'normal',
  };
  const attackerContext = { room, playerId: 'player1', attackers: [attacker] };
  const blockerContext = {
    room,
    playerId: 'player2',
    assignments: [{ attacker, blockers: [blocker] }],
  };

  function withRule(rule: CombatRule, run: () => void) {
    const remove = CombatRuleRegistry.register(rule);
    try {
      run();
    } finally {
      remove();
    }
  }

  it('restricts flying attackers to flying blockers', () => {
    const flyer = creature('flyer', 'player1', 2, 2, ['Flying']);
    const ground = creature('ground', 'player2', 2, 2);
    room.battlefield = [flyer, ground];
    expect(
      CombatRuleRegistry.validateBlockers({
        room,
        playerId: 'player2',
        assignments: [{ attacker: flyer, blockers: [ground] }],
      }),
    ).toMatch(/cannot block/);
    const flyingBlocker = creature('flying-blocker', 'player2', 2, 2, ['Flying']);
    room.battlefield = [flyer, flyingBlocker];
    expect(
      CombatRuleRegistry.validateBlockers({
        room,
        playerId: 'player2',
        assignments: [{ attacker: flyer, blockers: [flyingBlocker] }],
      }),
    ).toBeUndefined();
  });

  it('takes the first whole-declaration rejection', () => {
    withRule({ validateAttackers: () => 'cannot attack' }, () => {
      expect(CombatRuleRegistry.validateAttackers(attackerContext)).toBe('cannot attack');
    });
    withRule({ validateBlockers: () => 'cannot block' }, () => {
      expect(CombatRuleRegistry.validateBlockers({ ...blockerContext, assignments: [] })).toBe('cannot block');
    });
  });

  it('lets any rule grant attacking despite summoning sickness and rewrite mutations', () => {
    expect(CombatRuleRegistry.canAttackWhileSummoningSick(attackerContext, attacker)).toBe(false);
    withRule(
      {
        canAttackWhileSummoningSick: () => true,
        attackerMutations: (_context, proposed) => [...proposed, { type: 'TAP_CARD', cardUuid: 'extra' }],
        blockerMutations: (_context, proposed) => [...proposed, { type: 'UNTAP_CARD', cardUuid: 'extra' }],
      },
      () => {
        expect(CombatRuleRegistry.canAttackWhileSummoningSick(attackerContext, attacker)).toBe(true);
        expect(CombatRuleRegistry.attackerMutations(attackerContext, []).map((mutation) => mutation.type)).toEqual([
          'TAP_CARD',
        ]);
        expect(CombatRuleRegistry.blockerMutations(blockerContext, []).map((mutation) => mutation.type)).toEqual([
          'UNTAP_CARD',
        ]);
      },
    );
  });

  it('rejects ambiguous damage passes', () => {
    expect(CombatRuleRegistry.damagePasses(room)).toEqual(['normal']);
    withRule({ damagePasses: () => ['normal', 'normal'] }, () => {
      expect(() => CombatRuleRegistry.damagePasses(room)).toThrow(/unique identifiers/);
    });
    withRule({ damagePasses: () => ['  '] }, () => {
      expect(() => CombatRuleRegistry.damagePasses(room)).toThrow(/unique identifiers/);
    });
    withRule({ damagePasses: () => [] }, () => {
      expect(() => CombatRuleRegistry.damagePasses(room)).toThrow(/unique identifiers/);
    });
  });

  it('requires every rule to agree that damage is dealt', () => {
    expect(CombatRuleRegistry.dealsDamage(damageContext)).toBe(true);
    withRule({ dealsDamage: () => false }, () => {
      expect(CombatRuleRegistry.dealsDamage(damageContext)).toBe(false);
    });
  });

  it('adds the defending player for a blocked trampler only', () => {
    expect(CombatRuleRegistry.damageRecipients(damageContext, [])).toEqual([{ kind: 'player', playerId: 'player2' }]);
    room.activeTurnPlayerId = 'player2';
    expect(CombatRuleRegistry.damageRecipients(damageContext, [])).toEqual([{ kind: 'player', playerId: 'player1' }]);
    room.activeTurnPlayerId = 'player1';

    const plain = creature('plain', 'player1', 2, 2);
    room.battlefield = [plain, blocker];
    expect(
      CombatRuleRegistry.damageRecipients({ ...damageContext, source: plain }, [{ kind: 'player', playerId: 'player2' }]),
    ).toEqual([{ kind: 'player', playerId: 'player2' }]);
    expect(
      CombatRuleRegistry.damageRecipients({ ...damageContext, role: 'blocker' }, []),
    ).toEqual([]);
    expect(
      CombatRuleRegistry.damageRecipients(
        { ...damageContext, declaration: { ...declaration, blocked: false } },
        [],
      ),
    ).toEqual([]);

    const emptyRoom = createTestRoom({ player1Id: '', player2Id: null });
    expect(CombatRuleRegistry.damageRecipients({ ...damageContext, room: emptyRoom }, [])).toEqual([]);
    room.battlefield = [attacker, blocker];
  });

  it('validates trample allocation against lethal damage to every blocker', () => {
    expect(
      CombatRuleRegistry.validateAllocation(damageContext, [
        { source: snapshotOf(attacker), recipient: { kind: 'permanent', cardUuid: 'blocker', zoneRevision: 0 }, amount: 1, combat: true },
        { source: snapshotOf(attacker), recipient: { kind: 'player', playerId: 'player2' }, amount: 2, combat: true },
      ]),
    ).toMatch(/lethal damage/);
    expect(
      CombatRuleRegistry.validateAllocation(damageContext, [
        { source: snapshotOf(attacker), recipient: { kind: 'permanent', cardUuid: 'blocker', zoneRevision: 0 }, amount: 4, combat: true },
        { source: snapshotOf(attacker), recipient: { kind: 'player', playerId: 'player2' }, amount: 1, combat: true },
      ]),
    ).toBeUndefined();
    expect(CombatRuleRegistry.validateAllocation(damageContext, [])).toBeUndefined();
  });

  it('allows a rule to replace the lethal threshold', () => {
    const assignments: DamageAssignment[] = [];
    expect(CombatRuleRegistry.lethalDamage(damageContext, blocker)).toBe(4);
    withRule({ lethalDamage: () => 1 }, () => {
      expect(CombatRuleRegistry.lethalDamage(damageContext, blocker)).toBe(1);
    });
  });

  it('unregisters rules when the returned disposer runs', () => {
    const rule: CombatRule = { validateAttackers: () => 'temporary' };
    const remove = CombatRuleRegistry.register(rule);
    expect(CombatRuleRegistry.validateAttackers(attackerContext)).toBe('temporary');
    remove();
    expect(CombatRuleRegistry.validateAttackers(attackerContext)).toBeUndefined();
  });
});

describe('bounded reveal expansion', () => {
  it('replaces the reveal with capture, choice and remainder instructions', () => {
    const room = createTestRoom();
    room.battlefield = [creature('reveal-source', 'player1')];
    fillTestLibraries(room, 4);
    const stack = stackSpell(room);
    const expanded = expandBoundedReveal(room, stack, revealEffect({ amount: 2 }, 'instr'), 0);
    expect(expanded?.effects).toHaveLength(3);
    expect(expanded?.effects.map((effect) => effect.action)).toEqual(['CAPTURE_WINDOW', 'MOVE_ZONE', 'REORDER_LIBRARY']);
    expect(expanded?.effects[0].instructionId).toBe('instr:reveal:0');
  });

  it('numbers captures after existing reveal results and supports scorch and discard recipes', () => {
    const room = createTestRoom();
    room.battlefield = [creature('reveal-source', 'player1')];
    fillTestLibraries(room, 4);
    const stack = stackSpell(room, {
      resolutionResults: {
        starter_reveal_0: { name: 'starter_reveal_0', kind: 'captured', observationId: 'a', cards: [] },
        starter_reveal_1: { name: 'starter_reveal_1', kind: 'captured', observationId: 'b', cards: [] },
      },
    });
    const scorched = expandBoundedReveal(
      room,
      stack,
      revealEffect({ amount: 2, disposition: 'scorch', remainder: 'discard' }),
      0,
    );
    expect(scorched?.effects[0].recordResult).toEqual({ name: 'starter_reveal_2', kind: 'captured' });
    expect(scorched?.effects[1].action).toBe('ADD_COUNTER');
    expect(scorched?.effects[2].action).toBe('DISCARD_CAPTURED');
  });

  it('drops the instruction for an invalid amount', () => {
    const room = createTestRoom();
    fillTestLibraries(room, 4);
    const stack = stackSpell(room, { effects: [revealEffect({ amount: 0 })] });
    const expanded = expandBoundedReveal(room, stack, stack.effects[0], 0);
    expect(expanded?.effects).toEqual([]);
  });

  it('drops the instruction for a malformed authored filter', () => {
    const room = createTestRoom();
    fillTestLibraries(room, 4);
    const stack = stackSpell(room, { effects: [revealEffect({ amount: 1, filter: { bogus: true } })] });
    const expanded = expandBoundedReveal(room, stack, stack.effects[0], 0);
    expect(expanded?.effects).toEqual([]);
  });

  it('counts revealed cards matching any authored clause and advances past taken result names', () => {
    const room = createTestRoom();
    room.battlefield = [creature('reveal-source', 'player1')];
    const library: CardInstance[] = [];
    for (let index = 0; index < 2; index++) {
      const card = instantiateCard('empire-servant');
      card.state = { ...card.state, zone: 'library', ownerId: 'player1', controllerId: 'player1' };
      card.blueprint = {
        ...card.blueprint,
        cardTypes: ['Creature'],
        subTypes: ['Servant'],
        name: `Servant ${index}`,
      };
      library.push(card);
    }
    room.players.player1.deck = library;
    const stack = stackSpell(room, {
      resolutionResults: { starter_reveal_1: { name: 'starter_reveal_1', kind: 'captured', observationId: 'a', cards: [] } },
    });
    const expanded = expandBoundedReveal(
      room,
      stack,
      revealEffect({
        amount: 2,
        disposition: 'scorch',
        matchingClauses: [{ cardTypes: ['Creature'], subTypes: ['Servant'] }],
      }),
      0,
    );
    expect(expanded?.effects[0].recordResult).toEqual({ name: 'starter_reveal_2', kind: 'captured' });
    expect(expanded?.effects[1].params).toEqual({ counterType: 'scorch', amount: 2 });
  });

  it('leaves non-reveal actions to the caller', () => {
    const room = createTestRoom();
    const stack = stackSpell(room);
    expect(expandBoundedReveal(room, stack, { ...revealEffect({ amount: 1 }), action: 'DRAW' }, 0)).toBeUndefined();
  });
});

describe('captured card windows', () => {
  function captureEffect(params: Record<string, unknown> = {}): StackEffect {
    return {
      action: 'CAPTURE_WINDOW',
      params: { zone: 'library', position: 'top', amount: 2, visibility: privateVisibility, ...params },
      tags: [],
      targets: [],
      recordResult: { name: 'window', kind: 'captured' },
    };
  }

  function libraryRoom(count = 4): GameRoom {
    const room = createTestRoom();
    room.battlefield = [creature('window-source', 'player1')];
    room.players.player1.deck = Array.from({ length: count }, (_, index) => {
      const card = instantiateCard('empire-servant');
      card.state = { ...card.state, zone: 'library', ownerId: 'player1', controllerId: 'player1' };
      card.blueprint = { ...card.blueprint, id: `hidden-${index}`, name: `Hidden ${index}` };
      return card;
    });
    return room;
  }

  it('captures a hidden top window with ordered mutations', () => {
    const room = libraryRoom();
    const plan = captureCardWindow(room, stackSpell(room), captureEffect());
    expect(plan.mutations).toEqual([
      {
        type: 'RECORD_CARD_OBSERVATION',
        observation: expect.objectContaining({ resultName: 'window', ownerStackUuid: 'stack-object', controllerId: 'player1' }),
        sequence: 1,
      },
    ]);
    const result = plan.object.resolutionResults?.window;
    expect(result?.kind).toBe('captured');
    expect(result?.cards).toHaveLength(2);
    expect(plan.object).not.toBe(room);
    expect(plan.object).toHaveProperty('resolutionResults');
  });

  it('records a public reveal event for a public window', () => {
    const room = libraryRoom();
    const plan = captureCardWindow(
      room,
      stackSpell(room),
      captureEffect({ visibility: publicVisibility, event: 'revealed' }),
    );
    expect(plan.object.resolutionReveals).toHaveLength(1);
    expect(plan.object.resolutionReveals?.[0].cards).toHaveLength(2);
    expect(plan.object.resolutionReveals?.[0].snapshots).toHaveLength(2);
  });

  it('appends to existing reveals and preserves public order', () => {
    const room = libraryRoom();
    const stack = stackSpell(room, {
      resolutionReveals: [
        {
          cards: [],
          snapshots: [],
          sourceInfo: snapshotOf(room.battlefield[0]),
          controllerId: 'player1',
        },
      ],
    });
    const plan = captureCardWindow(room, stack, captureEffect({ visibility: publicVisibility, event: 'revealed' }));
    expect(plan.object.resolutionReveals).toHaveLength(2);
  });

  it('omits reveal metadata for an empty window', () => {
    const room = libraryRoom(0);
    const plan = captureCardWindow(room, stackSpell(room), captureEffect({ event: 'revealed', visibility: publicVisibility }));
    expect(plan.object.resolutionReveals).toBeUndefined();
    expect(plan.object).not.toHaveProperty('resolutionReveals');
  });

  it('uses the opponent library when requested and rejects unavailable owners', () => {
    const room = libraryRoom(1);
    room.players.player2.deck = [];
    const opponent = captureCardWindow(room, stackSpell(room), captureEffect({ zonePlayer: 'opponent' }));
    expect(opponent.object.resolutionResults?.window.kind).toBe('captured');
    const withoutOpponent = createTestRoom({ player2Id: null });
    withoutOpponent.players.player1.deck = [];
    expect(() => captureCardWindow(withoutOpponent, stackSpell(withoutOpponent), captureEffect({ zonePlayer: 'opponent' }))).toThrow(
      /Capture source player is unavailable/,
    );
    const ghost = createTestRoom();
    delete (ghost.players as Record<string, unknown>).player2;
    expect(() => captureCardWindow(ghost, stackSpell(ghost), captureEffect({ zonePlayer: 'opponent' }))).toThrow(
      /Capture source player is unavailable/,
    );
  });

  it('uses the hidden default visibility when the capture declares none', () => {
    const room = libraryRoom();
    const plan = captureCardWindow(room, stackSpell(room), {
      ...captureEffect(),
      params: { zone: 'library', position: 'top', amount: 1 },
    });
    expect(plan.mutations[0].type).toBe('RECORD_CARD_OBSERVATION');
    const recorded = plan.mutations[0].type === 'RECORD_CARD_OBSERVATION' ? plan.mutations[0].observation : undefined;
    expect(recorded?.members[0].audience.faces).toEqual([]);
  });

  it('breaks hidden-order ties deterministically by id then uuid', () => {
    const room = libraryRoom(0);
    const makeCard = (uuid: string, name: string, id: string) => {
      const card = instantiateCard('empire-servant');
      card.state = { ...card.state, zone: 'library', ownerId: 'player1', controllerId: 'player1' };
      card.blueprint = { ...card.blueprint, id, name };
      return { ...card, uuid };
    };
    room.players.player1.deck = [
      makeCard('uuid-b', 'Same name', 'same-id'),
      makeCard('uuid-a', 'Same name', 'same-id'),
      makeCard('uuid-c', 'Same name', 'other-id'),
      makeCard('uuid-d', 'Another name', 'same-id'),
    ];
    const controllerOrder = {
      faces: ['all_players' as const],
      count: ['all_players' as const],
      order: ['controller' as const],
      expires: 'resolution_end' as const,
    };
    const plan = captureCardWindow(
      room,
      stackSpell(room),
      captureEffect({ amount: 4, visibility: controllerOrder, event: 'revealed' }),
    );
    expect(plan.object.resolutionReveals?.[0].cards.map((card) => card.uuid)).toEqual([
      'uuid-d',
      'uuid-c',
      'uuid-a',
      'uuid-b',
    ]);
  });

  it('requires a captured result definition without duplicates', () => {
    const room = libraryRoom();
    const stack = stackSpell(room);
    const { recordResult: _recordResult, ...withoutResult } = captureEffect();
    expect(() => captureCardWindow(room, stack, withoutResult)).toThrow(/Capture requires a captured result/);
    expect(() =>
      captureCardWindow(room, stack, { ...captureEffect(), recordResult: { name: 'window', kind: 'milled' } }),
    ).toThrow(/Capture requires a captured result/);
    const duplicate = stackSpell(room, {
      resolutionResults: { window: { name: 'window', kind: 'captured', observationId: 'a', cards: [] } },
    });
    expect(() => captureCardWindow(room, duplicate, captureEffect())).toThrow(/Duplicate resolution result: window/);
  });

  function captured(room: GameRoom): {
    object: StackObject;
    observation: CardObservation;
    cards: CardInstance[];
  } {
    const cards = room.players.player1.deck.slice(-2).reverse();
    const observation: CardObservation = {
      id: 'observation',
      ownerStackUuid: 'stack-object',
      resultName: 'window',
      controllerId: 'player1',
      zoneOwnerId: 'player1',
      sourceInfo: snapshotOf(room.battlefield[0]),
      emptyAudience: { faces: ['player1'], count: ['player1', 'player2'], order: ['player1'] },
      turnNumber: 1,
      members: cards.map((card) => ({
        snapshot: snapshotOf(card),
        audience: { faces: ['player1'], count: ['player1', 'player2'], order: ['player1'] },
      })),
    };
    const object = stackSpell(room, {
      resolutionResults: {
        window: {
          name: 'window',
          kind: 'captured',
          observationId: 'observation',
          cards: cards.map((card) => ({ before: snapshotOf(card) })),
        },
      },
    });
    return { object, observation, cards };
  }

  function withObservation(room: GameRoom, observation: CardObservation): GameRoom {
    return { ...room, cardObservations: { sequence: 1, active: { observation }, history: [] } };
  }

  it('updates visibility only for this resolution active captured result', () => {
    const room = libraryRoom();
    const { object, observation, cards } = captured(room);
    const withState = withObservation(room, observation);
    room.players.player1.deck = cards;

    const plan = setCollectionVisibility(withState, object, {
      action: 'SET_COLLECTION_VISIBILITY',
      params: { from: { kind: 'result', name: 'window' }, visibility: publicVisibility },
      tags: [],
      targets: [],
    });
    expect(plan.object).not.toBe(object);
    expect(plan.object.uuid).toBe(object.uuid);
    expect(plan.mutations).toHaveLength(1);
    expect(plan.mutations[0].type).toBe('RECORD_CARD_OBSERVATION');
    const updated = plan.mutations[0].type === 'RECORD_CARD_OBSERVATION' ? plan.mutations[0].observation : undefined;
    expect(updated?.members.every((member) => member.audience.faces.includes('player2'))).toBe(true);
  });

  it('keeps earlier grants for members outside the filtered selection', () => {
    const room = libraryRoom();
    const { object, observation, cards } = captured(room);
    const withState = withObservation(room, observation);
    withState.players.player1.deck = cards;
    const plan = setCollectionVisibility(withState, object, {
      action: 'SET_COLLECTION_VISIBILITY',
      params: {
        from: { kind: 'result', name: 'window' },
        visibility: publicVisibility,
        filter: { cardTypes: ['Artifact'] },
      },
      tags: [],
      targets: [],
    });
    expect(plan.mutations).toEqual([]);
    expect(plan.object).toBe(object);
  });

  it('rejects visibility updates without an active result owned by this stack', () => {
    const room = libraryRoom();
    const { object, observation, cards } = captured(room);
    room.players.player1.deck = cards;
    const effect: StackEffect = {
      action: 'SET_COLLECTION_VISIBILITY',
      params: { from: { kind: 'result', name: 'window' }, visibility: publicVisibility },
      tags: [],
      targets: [],
    };
    expect(() => setCollectionVisibility(room, object, effect)).toThrow(/active captured result/);
    const wrongKind = { ...object, resolutionResults: { window: { name: 'window', kind: 'milled' as const, cards: [] } } };
    expect(() => setCollectionVisibility(withObservation(room, observation), wrongKind, effect)).toThrow(
      /active captured result/,
    );
    const otherOwner = { ...observation, ownerStackUuid: 'other-stack' };
    expect(() => setCollectionVisibility(withObservation(room, otherOwner), object, effect)).toThrow(
      /active captured result/,
    );
    const missingFrom = { ...object, resolutionResults: {} };
    expect(() => setCollectionVisibility(withObservation(room, observation), missingFrom, effect)).toThrow(
      /active captured result/,
    );
  });

  it('records a reveal event when the updated window is public', () => {
    const room = libraryRoom();
    const { object, observation, cards } = captured(room);
    const withState = withObservation(room, observation);
    withState.players.player1.deck = cards;
    const plan = setCollectionVisibility(withState, object, {
      action: 'SET_COLLECTION_VISIBILITY',
      params: { from: { kind: 'result', name: 'window' }, visibility: publicVisibility, event: 'revealed' },
      tags: [],
      targets: [],
    });
    const recorded = plan.mutations[0].type === 'RECORD_CARD_OBSERVATION' ? plan.mutations[0].observation : undefined;
    expect(recorded?.members).toHaveLength(2);
    expect(plan.object.uuid).toBe(object.uuid);
    expect(plan.object).not.toBe(object);
  });

  it('uses the requested audience for an empty captured window', () => {
    const room = libraryRoom();
    const { object, observation } = captured(room);
    observation.members = [];
    const withState = withObservation(room, observation);
    const plan = setCollectionVisibility(withState, object, {
      action: 'SET_COLLECTION_VISIBILITY',
      params: { from: { kind: 'result', name: 'window' }, visibility: publicVisibility },
      tags: [],
      targets: [],
    });
    const recorded = plan.mutations[0].type === 'RECORD_CARD_OBSERVATION' ? plan.mutations[0].observation : undefined;
    expect(recorded?.members).toEqual([]);
    expect(recorded?.emptyAudience.faces).toEqual(['player1', 'player2']);
  });

  it('retains members that no longer match any current card', () => {
    const room = libraryRoom();
    const { object, observation, cards } = captured(room);
    const extra = structuredClone(observation.members[0]);
    extra.snapshot.card.uuid = 'departed-card';
    observation.members = [observation.members[0], extra];
    const withState = withObservation(room, observation);
    withState.players.player1.deck = cards;
    const plan = setCollectionVisibility(withState, object, {
      action: 'SET_COLLECTION_VISIBILITY',
      params: { from: { kind: 'result', name: 'window' }, visibility: publicVisibility },
      tags: [],
      targets: [],
    });
    const recorded = plan.mutations[0].type === 'RECORD_CARD_OBSERVATION' ? plan.mutations[0].observation : undefined;
    expect(recorded?.members).toHaveLength(2);
    expect(recorded?.members[1].snapshot.card.uuid).toBe('departed-card');
    expect(recorded?.members[1].audience.faces).toEqual(['player1']);
  });

  it('allows a captured card only while the chooser retains a face grant', () => {
    const room = libraryRoom();
    const { object, observation, cards } = captured(room);
    const card = cards[0];
    expect(canChooseCapturedCard(room, stackSpell(room), 'missing', card)).toBe(true);
    expect(canChooseCapturedCard(room, object, 'window', card)).toBe(false);

    const withState = withObservation(room, observation);
    expect(canChooseCapturedCard(withState, object, 'window', card)).toBe(true);
    const other = { ...observation, members: [{ ...observation.members[0], audience: { faces: [], count: [], order: [] } }] };
    expect(canChooseCapturedCard(withObservation(room, other), object, 'window', card)).toBe(false);

    const missingObservation = { ...object, resolutionResults: { window: { ...object.resolutionResults!.window, observationId: '' } } };
    expect(canChooseCapturedCard(withState, missingObservation as StackObject, 'window', card)).toBe(true);
  });

  function resolutionChoice(object: StackObject, overrides: Record<string, unknown> = {}): PendingChoice {
    const choice: PendingChoice = {
      id: 'choice',
      playerId: 'player1',
      kind: 'search',
      prompt: 'Choose a card',
      min: 1,
      max: 1,
      options: [],
      continuation: {
        type: 'resolution',
        stackObj: object,
        effectIndex: 0,
        results: [],
      } as ResolutionContinuation,
      ...overrides,
    } as PendingChoice;
    return choice;
  }

  function searchObject(room: GameRoom): StackObject {
    const source = room.battlefield[0];
    return stackSpell(room, {
      effects: [
        {
          action: 'MOVE_ZONE',
          params: {},
          tags: [],
          targets: [],
          choice: { kind: 'search', zone: 'library', from: { kind: 'result', name: 'window' } },
        },
      ],
      source,
    });
  }

  it('rechecks captured choices against current grants and revisions', () => {
    const room = libraryRoom();
    const object = searchObject(room);
    const card = room.players.player1.deck[0];
    card.state = { ...card.state, zoneRevision: 3 };
    const observation: CardObservation = {
      id: 'observation',
      ownerStackUuid: object.uuid,
      resultName: 'window',
      controllerId: 'player1',
      zoneOwnerId: 'player1',
      sourceInfo: snapshotOf(room.battlefield[0]),
      emptyAudience: { faces: [], count: [], order: [] },
      turnNumber: 1,
      members: [
        {
          snapshot: snapshotOf(card),
          audience: { faces: ['player1'], count: ['player1'], order: ['player1'] },
        },
      ],
    };
    const withResult: StackObject = {
      ...object,
      resolutionResults: {
        window: {
          name: 'window',
          kind: 'captured',
          observationId: 'observation',
          cards: [{ before: snapshotOf(card) }],
        },
      },
    };
    const state = { ...room, cardObservations: { sequence: 1, active: { observation }, history: [] } };
    const allowed = resolutionChoice(withResult, {
      options: [{ id: card.uuid, label: card.blueprint.name, value: { cardUuid: card.uuid, zone: 'library', zoneRevision: 3 } }],
    });
    expect(capturedChoiceAllowed(state, allowed)).toBe(true);
    const stale = resolutionChoice(withResult, {
      options: [{ id: card.uuid, label: card.blueprint.name, value: { cardUuid: card.uuid, zone: 'library', zoneRevision: 2 } }],
    });
    expect(capturedChoiceAllowed(state, stale)).toBe(false);
  });

  it('matches captured cards and order grants whose revision is unset', () => {
    const room = libraryRoom();
    const object = searchObject(room);
    const card = room.players.player1.deck[0];
    const observation: CardObservation = {
      id: 'observation',
      ownerStackUuid: object.uuid,
      resultName: 'window',
      controllerId: 'player1',
      zoneOwnerId: 'player1',
      sourceInfo: snapshotOf(room.battlefield[0]),
      emptyAudience: { faces: [], count: [], order: [] },
      turnNumber: 1,
      members: [{ snapshot: snapshotOf(card), audience: { faces: ['player1'], count: ['player1'], order: ['player1'] } }],
    };
    const withResult: StackObject = {
      ...object,
      resolutionResults: {
        window: { name: 'window', kind: 'captured', observationId: 'observation', cards: [{ before: snapshotOf(card) }] },
      },
    };
    const state = { ...room, cardObservations: { sequence: 1, active: { observation }, history: [] } };
    const choice = resolutionChoice(withResult, {
      options: [{ id: card.uuid, label: 'card', value: { cardUuid: card.uuid, zone: 'library', zoneRevision: 0 } }],
    });
    expect(capturedChoiceAllowed(state, choice)).toBe(true);
    expect(choiceSourceOrderVisible(state, choice)).toBe(true);
  });

  it('ignores non-captured, non-search and number choices', () => {
    const room = libraryRoom();
    const object = searchObject(room);
    expect(capturedChoiceAllowed(room, { ...resolutionChoice(object), kind: 'number' } as PendingChoice)).toBe(true);
    const actionChoice = resolutionChoice(object, {
      continuation: { type: 'action', actionId: 'cast_spell', data: {}, field: 'modes' },
    });
    expect(capturedChoiceAllowed(room, actionChoice)).toBe(true);
    const withoutChoice: StackObject = { ...object, effects: [{ action: 'DRAW', params: {}, tags: [], targets: [] }] };
    expect(capturedChoiceAllowed(room, resolutionChoice(withoutChoice))).toBe(true);
    const withoutFrom: StackObject = {
      ...object,
      effects: [{ action: 'DRAW', params: {}, tags: [], targets: [], choice: { kind: 'search', zone: 'library' } }],
    };
    expect(capturedChoiceAllowed(room, resolutionChoice(withoutFrom))).toBe(true);
    expect(capturedChoiceAllowed(room, resolutionChoice(object))).toBe(true);
  });

  it('exposes source order only for a captured library search the chooser may see', () => {
    const room = libraryRoom();
    const object = searchObject(room);
    const card = room.players.player1.deck[0];
    card.state = { ...card.state, zoneRevision: 2 };
    const observation: CardObservation = {
      id: 'observation',
      ownerStackUuid: object.uuid,
      resultName: 'window',
      controllerId: 'player1',
      zoneOwnerId: 'player1',
      sourceInfo: snapshotOf(room.battlefield[0]),
      emptyAudience: { faces: [], count: [], order: [] },
      turnNumber: 1,
      members: [
        {
          snapshot: snapshotOf(card),
          audience: { faces: ['player1'], count: ['player1'], order: ['player1'] },
        },
      ],
    };
    const withResult: StackObject = {
      ...object,
      resolutionResults: {
        window: {
          name: 'window',
          kind: 'captured',
          observationId: 'observation',
          cards: [{ before: snapshotOf(card) }],
        },
      },
    };
    const state = { ...room, cardObservations: { sequence: 1, active: { observation }, history: [] } };
    const choice = resolutionChoice(withResult, {
      options: [{ id: card.uuid, label: 'card', value: { cardUuid: card.uuid, zoneRevision: 2 } }],
    });
    expect(choiceSourceOrderVisible(state, choice)).toBe(true);
    const hidden = { ...observation, members: [{ ...observation.members[0], audience: { faces: ['player1'], count: ['player1'], order: [] } }] };
    expect(choiceSourceOrderVisible({ ...state, cardObservations: { sequence: 1, active: { observation: hidden }, history: [] } }, choice)).toBe(false);
    const wrongRevision = resolutionChoice(withResult, {
      options: [{ id: card.uuid, label: 'card', value: { cardUuid: card.uuid, zoneRevision: 1 } }],
    });
    expect(choiceSourceOrderVisible(state, wrongRevision)).toBe(false);
  });

  it('defaults to visible order for non-library and non-captured choices', () => {
    const room = libraryRoom();
    const object = searchObject(room);
    expect(choiceSourceOrderVisible(room, { ...resolutionChoice(object), kind: 'number' } as PendingChoice)).toBe(true);
    expect(
      choiceSourceOrderVisible(
        room,
        resolutionChoice(object, { continuation: { type: 'action', actionId: 'cast_spell', data: {}, field: 'modes' } }),
      ),
    ).toBe(true);
    const graveyardSearch: StackObject = {
      ...object,
      effects: [{ action: 'DRAW', params: {}, tags: [], targets: [], choice: { kind: 'search', zone: 'graveyard' } }],
    };
    expect(choiceSourceOrderVisible(room, resolutionChoice(graveyardSearch))).toBe(true);
    const noFrom: StackObject = {
      ...object,
      effects: [{ action: 'DRAW', params: {}, tags: [], targets: [], choice: { kind: 'search', zone: 'library' } }],
    };
    expect(choiceSourceOrderVisible(room, resolutionChoice(noFrom))).toBe(false);
    expect(choiceSourceOrderVisible(room, resolutionChoice(object))).toBe(false);
    const uncaptured: StackObject = {
      ...object,
      resolutionResults: { window: { name: 'window', kind: 'milled', cards: [] } },
    };
    expect(choiceSourceOrderVisible(room, resolutionChoice(uncaptured))).toBe(false);
    const observationMissing: StackObject = {
      ...withResult(withResult(object, room), room),
    } as StackObject;
    expect(choiceSourceOrderVisible(room, resolutionChoice(observationMissing))).toBe(false);
  });
});

function withResult(object: StackObject, room: GameRoom): StackObject {
  return {
    ...object,
    resolutionResults: {
      window: {
        name: 'window',
        kind: 'captured',
        observationId: 'observation',
        cards: [{ before: snapshotOf(room.players.player1.deck[0]) }],
      },
    },
  };
}

describe('triggered stack object typing helper', () => {
  it('treats a triggered object as a stack object', () => {
    const room = createTestRoom();
    const triggered: TriggeredStackObject = {
      uuid: 'trigger',
      type: 'triggered',
      controllerId: 'player1',
      source: room.battlefield[0] ?? creature('source', 'player1'),
      effects: [],
      countered: false,
    };
    expect(triggered.ability).toBeUndefined();
  });
});
