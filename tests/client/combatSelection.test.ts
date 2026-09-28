import { describe, it, expect } from 'vitest';
import { reconcileCombatSelection, EMPTY_COMBAT_SELECTION, type CombatSelection } from '../../src/client/store/combatSelection';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '../../src/library/card-factory';

describe('reconcileCombatSelection', () => {
  it('drops attackers no longer on the battlefield', () => {
    const room = createTestRoom();
    const selection: CombatSelection = {
      attackers: ['gone-uuid', 'also-gone'],
      blockerPairs: [],
      pendingBlocker: null,
    };
    const { selection: result, changed } = reconcileCombatSelection(selection, room);
    expect(result.attackers).toEqual([]);
    expect(changed).toBe(true);
  });

  it('drops attackers that are no longer eligible (tapped)', () => {
    const room = createTestRoom();
    const card = instantiateCard('empire-servant');
    card.state.zone = 'battlefield';
    card.state.controllerId = 'player1'; // active player
    card.state.isTapped = true; // tapped → not eligible
    card.state.summoningSickness = false;
    room.battlefield.push(card);

    const selection: CombatSelection = {
      attackers: [card.uuid],
      blockerPairs: [],
      pendingBlocker: null,
    };
    const { selection: result, changed } = reconcileCombatSelection(selection, room);
    expect(result.attackers).toEqual([]);
    expect(changed).toBe(true);
  });

  it('keeps eligible attackers', () => {
    const room = createTestRoom();
    const card = instantiateCard('empire-servant');
    card.state.zone = 'battlefield';
    card.state.controllerId = 'player1'; // active player
    card.state.isTapped = false;
    card.state.summoningSickness = false;
    card.state.attackedThisTurn = false;
    room.battlefield.push(card);

    const selection: CombatSelection = {
      attackers: [card.uuid],
      blockerPairs: [],
      pendingBlocker: null,
    };
    const { selection: result, changed } = reconcileCombatSelection(selection, room);
    expect(result.attackers).toEqual([card.uuid]);
    expect(changed).toBe(false);
  });

  it('drops blockerPairs whose attacker left combat', () => {
    const room = createTestRoom();
    // No combat declarations
    const selection: CombatSelection = {
      attackers: [],
      blockerPairs: [{ attackerUuid: 'gone', blockerUuid: 'some-blocker' }],
      pendingBlocker: null,
    };
    const { selection: result, changed } = reconcileCombatSelection(selection, room);
    expect(result.blockerPairs).toEqual([]);
    expect(changed).toBe(true);
  });

  it('drops blockerPairs whose blocker is no longer eligible', () => {
    const room = createTestRoom();
    // Add a combat declaration
    const attacker = instantiateCard('empire-servant');
    attacker.state.zone = 'battlefield';
    room.combat = [{ uuid: attacker.uuid, attacker, attackerPower: 1, blockers: [] }];

    const selection: CombatSelection = {
      attackers: [],
      blockerPairs: [{ attackerUuid: attacker.uuid, blockerUuid: 'gone-blocker' }],
      pendingBlocker: null,
    };
    const { selection: result, changed } = reconcileCombatSelection(selection, room);
    expect(result.blockerPairs).toEqual([]);
    expect(changed).toBe(true);
  });

  it('clears pendingBlocker if that creature is gone', () => {
    const room = createTestRoom();
    const selection: CombatSelection = {
      attackers: [],
      blockerPairs: [],
      pendingBlocker: 'gone',
    };
    const { selection: result, changed } = reconcileCombatSelection(selection, room);
    expect(result.pendingBlocker).toBeNull();
    expect(changed).toBe(true);
  });

  it('returns changed: false when nothing is purged', () => {
    const room = createTestRoom();
    const card = instantiateCard('empire-servant');
    card.state.zone = 'battlefield';
    card.state.controllerId = 'player1';
    card.state.isTapped = false;
    card.state.summoningSickness = false;
    card.state.attackedThisTurn = false;
    room.battlefield.push(card);

    const selection: CombatSelection = {
      attackers: [card.uuid],
      blockerPairs: [],
      pendingBlocker: null,
    };
    const { changed } = reconcileCombatSelection(selection, room);
    expect(changed).toBe(false);
  });
});
