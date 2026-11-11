import { describe, expect, it } from 'vitest';
import { declareAttackersHandler } from '@engine/handlers/declare-attackers-handler';
import { CombatRuleRegistry } from '@engine/combat-rules';
import { parseCardDefinition } from '@library/card-parser';
import type { GameRoom } from '@shared/game.room.types';
import type { CardInstance } from '@shared/card.types';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';

const data = (attackers: { cardUuid: string }[] | undefined) => ({ attackers }) as never;

function ready(...cards: CardInstance[]): GameRoom {
  return {
    ...createTestRoom(),
    phase: 'declareAttackersStep',
    activeTurnPlayerId: 'player1',
    battlefield: cards,
  };
}

function land(uuid: string, controllerId = 'player1'): CardInstance {
  return {
    uuid,
    blueprint: parseCardDefinition({ schemaVersion: 1, id: uuid, name: uuid, cardTypes: ['Land'], abilities: [] }),
    state: {
      zone: 'battlefield',
      zoneRevision: 0,
      ownerId: controllerId,
      controllerId,
      isTapped: false,
      damageTaken: 0,
      summoningSickness: false,
      attackedThisTurn: false,
      counters: {},
    },
  };
}

describe('declareAttackersHandler.validate', () => {
  it('refuses to declare while the stack or a declaration is open', () => {
    const room = ready(creature('a', 'player1'));
    expect(declareAttackersHandler.validate({ ...room, stack: [{} as never] }, 'player1', data([{ cardUuid: 'a' }]))).toEqual({
      success: false,
      phase: 'validate',
      reason: 'Combat declaration is already complete or responses are pending',
    });
    expect(
      declareAttackersHandler.validate({ ...room, combatDeclarations: { attackers: true, blockers: false } }, 'player1', data([{ cardUuid: 'a' }])),
    ).toEqual({ success: false, phase: 'validate', reason: 'Combat declaration is already complete or responses are pending' });
  });

  it('requires the attacker list, the right turn and the right step', () => {
    const room = ready(creature('a', 'player1'));
    expect(declareAttackersHandler.validate(room, 'player1', data(undefined))).toEqual({
      success: false,
      phase: 'validate',
      reason: 'attackers is required',
    });
    expect(declareAttackersHandler.validate(room, 'player2', data([{ cardUuid: 'a' }]))).toEqual({
      success: false,
      phase: 'validate',
      reason: 'Not your turn',
    });
    expect(declareAttackersHandler.validate({ ...room, phase: 'stateMainPhase' }, 'player1', data([{ cardUuid: 'a' }]))).toEqual({
      success: false,
      phase: 'validate',
      reason: 'Can only declare attackers during declare attackers step',
    });
  });

  it('refuses duplicate, unknown, non-creature and unavailable attackers', () => {
    const room = ready(creature('a', 'player1'), creature('b', 'player2'), land('plot'));
    expect(declareAttackersHandler.validate(room, 'player1', data([{ cardUuid: 'a' }, { cardUuid: 'a' }]))).toEqual({
      success: false,
      phase: 'validate',
      reason: 'Duplicate attackers are not allowed',
    });
    expect(declareAttackersHandler.validate(room, 'player1', data([{ cardUuid: 'b' }]))).toEqual({
      success: false,
      phase: 'validate',
      reason: 'Creature b not found on your battlefield',
    });
    expect(declareAttackersHandler.validate(room, 'player1', data([{ cardUuid: 'plot' }]))).toEqual({
      success: false,
      phase: 'validate',
      reason: 'Card plot is not a creature',
    });

    const tapped = creature('tapped', 'player1');
    tapped.state.isTapped = true;
    expect(declareAttackersHandler.validate(ready(tapped), 'player1', data([{ cardUuid: 'tapped' }]))).toEqual({
      success: false,
      phase: 'validate',
      reason: 'tapped is already tapped',
    });

    const attacked = creature('attacked', 'player1');
    attacked.state.attackedThisTurn = true;
    expect(declareAttackersHandler.validate(ready(attacked), 'player1', data([{ cardUuid: 'attacked' }]))).toEqual({
      success: false,
      phase: 'validate',
      reason: 'attacked has already attacked this turn',
    });
  });

  it('enforces summoning sickness unless a combat rule grants the attack', () => {
    const sick = creature('sick', 'player1');
    sick.state.summoningSickness = true;
    expect(declareAttackersHandler.validate(ready(sick), 'player1', data([{ cardUuid: 'sick' }]))).toEqual({
      success: false,
      phase: 'validate',
      reason: 'sick has summoning sickness',
    });

    const release = CombatRuleRegistry.register({ canAttackWhileSummoningSick: () => true });
    try {
      expect(declareAttackersHandler.validate(ready(sick), 'player1', data([{ cardUuid: 'sick' }]))).toEqual({ success: true });
    } finally {
      release();
    }
  });

  it('reports the first combat rule that rejects the declaration', () => {
    const room = ready(creature('a', 'player1'));
    const release = CombatRuleRegistry.register({ validateAttackers: () => 'No attacking today' });
    try {
      expect(declareAttackersHandler.validate(room, 'player1', data([{ cardUuid: 'a' }]))).toEqual({
        success: false,
        phase: 'validate',
        reason: 'No attacking today',
      });
    } finally {
      release();
    }
    expect(declareAttackersHandler.validate(room, 'player1', data([{ cardUuid: 'a' }]))).toEqual({ success: true });
  });
});

describe('declareAttackersHandler.propose', () => {
  it('taps the attackers, records the attack and declares combat', () => {
    const room = ready(creature('a', 'player1', 3, 3));
    const result = declareAttackersHandler.propose(room, 'player1', data([{ cardUuid: 'a' }]));
    expect(result).toEqual({
      success: true,
      mutations: [
        { type: 'TAP_CARD', cardUuid: 'a' },
        { type: 'SET_ATTACKED_THIS_TURN', cardUuid: 'a', value: true },
        {
          type: 'DECLARE_ATTACKERS',
          declarations: [
            expect.objectContaining({ uuid: 'a', attackerPower: 3, blockers: [], blocked: false }),
          ],
        },
      ],
    });
  });

  it('appends the mutations contributed by combat rules', () => {
    const room = ready(creature('a', 'player1'));
    const release = CombatRuleRegistry.register({
      attackerMutations: (_context, proposed) => [...proposed, { type: 'SET_ATTACKED_THIS_TURN', cardUuid: 'rule', value: true }],
    });
    try {
      const result = declareAttackersHandler.propose(room, 'player1', data([{ cardUuid: 'a' }]));
      expect(result.success && result.mutations).toContainEqual({ type: 'SET_ATTACKED_THIS_TURN', cardUuid: 'rule', value: true });
      // The declaration remains the last mutation so the step reads a complete board.
      expect(result.success && result.mutations!.at(-1)).toMatchObject({ type: 'DECLARE_ATTACKERS' });
    } finally {
      release();
    }
  });

  it('fails when an attacker left the battlefield after validation', () => {
    expect(declareAttackersHandler.propose(ready(), 'player1', data([{ cardUuid: 'gone' }]))).toEqual({
      success: false,
      phase: 'propose',
      reason: 'Creature gone disappeared from battlefield',
    });
  });
});
