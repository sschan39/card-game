import { describe, expect, it } from 'vitest';
import { reconcileCombatSelection, type CombatSelection } from '@client/store/combatSelection';
import { createTestRoom, instantiateCard } from '../helpers/client-view-fixture';

describe('combat selection reconciliation for the second seat', () => {
  it('retains an eligible pending blocker and block pair when the active player is the opponent', () => {
    const room = createTestRoom({ phase: 'declareBlockersStep', activeTurnPlayerId: 'player2' });
    const attacker = instantiateCard('empire-servant');
    attacker.state.controllerId = 'player2';
    attacker.state.ownerId = 'player2';
    const blocker = instantiateCard('empire-servant');
    blocker.state.controllerId = 'player1';
    blocker.state.isTapped = false;
    blocker.canBlock = true;
    room.battlefield = [blocker];
    room.combat = [{ uuid: attacker.uuid, attacker, attackerPower: 1, blockers: [], blocked: false }];

    const selection: CombatSelection = {
      attackers: [],
      blockerPairs: [{ attackerUuid: attacker.uuid, blockerUuid: blocker.uuid }],
      pendingBlocker: blocker.uuid,
    };

    const { selection: result, changed } = reconcileCombatSelection(selection, room);

    expect(result).toEqual(selection);
    expect(changed).toBe(false);
  });

  it('keeps the pending blocker only while the block declaration is open', () => {
    const room = createTestRoom({ phase: 'declareBlockersStep', activeTurnPlayerId: 'player2', combatDeclarations: { attackers: true, blockers: true } });
    const blocker = instantiateCard('empire-servant');
    blocker.state.controllerId = 'player1';
    blocker.canBlock = true;
    room.battlefield = [blocker];

    const { selection: result, changed } = reconcileCombatSelection({ attackers: [], blockerPairs: [], pendingBlocker: blocker.uuid }, room);

    expect(result.pendingBlocker).toBeNull();
    expect(changed).toBe(true);
  });

  it('keeps only eligible attackers for the active first seat', () => {
    const room = createTestRoom({ phase: 'declareAttackersStep', activeTurnPlayerId: 'player1' });
    const card = instantiateCard('empire-servant');
    card.state.controllerId = 'player1';
    card.state.isTapped = false;
    card.state.summoningSickness = false;
    card.state.attackedThisTurn = false;
    card.canAttack = true;
    card.canBlock = true;
    room.battlefield.push(card);

    const { selection: result, changed } = reconcileCombatSelection(
      { attackers: [card.uuid, 'departed'], blockerPairs: [], pendingBlocker: null },
      room,
    );

    expect(result.attackers).toEqual([card.uuid]);
    expect(changed).toBe(true);
  });
});
