import { describe, expect, it } from 'vitest';
import { creature, combatRoom } from '../helpers/combat-fixture';
import { createTestRoom } from '../helpers/test-room-factory';
import { gameReducer } from '@engine/game-reducer';
import { declareAttackersHandler } from '@engine/handlers/declare-attackers-handler';
import { declareBlockersHandler } from '@engine/handlers/declare-blockers-handler';
import { reconcileCombat } from '@engine/combat-state';
import { CombatRuleRegistry } from '@engine/combat-rules';

describe('combat participant state', () => {
  it('removes an attacker immediately on departure; the same UUID cannot return to combat', () => {
    const attacker = creature('a', 'player1');
    const room = combatRoom(createTestRoom(), attacker);
    const left = gameReducer(room, { type: 'MOVE_CARD', cardUuid: 'a', playerId: 'player1', from: 'battlefield', to: 'exile' });
    expect(left.combat).toEqual([]);
    const returned = gameReducer(left, { type: 'MOVE_CARD', cardUuid: 'a', playerId: 'player1', from: 'exile', to: 'battlefield' });
    expect(returned.battlefield[0].uuid).toBe('a');
    expect(returned.combat).toEqual([]);
  });

  it('keeps explicit blocked status after all blockers leave', () => {
    const room = combatRoom(createTestRoom(), creature('a', 'player1'), [creature('b', 'player2')]);
    const after = gameReducer(room, { type: 'MOVE_CARD', cardUuid: 'b', playerId: 'player2', from: 'battlefield', to: 'hand' });
    expect(after.combat[0].blockers).toEqual([]);
    expect(after.combat[0].blocked).toBe(true);
    expect(room.combat[0].blockers).toHaveLength(1);
  });

  it('reconciles controller/revision/type changes and does not restore removed participation', () => {
    const room = combatRoom(createTestRoom(), creature('a', 'player1'), [creature('b', 'player2')]);
    const controlled = reconcileCombat({ ...room, battlefield: room.battlefield.map(c => c.uuid === 'b'
      ? { ...c, state: { ...c.state, controllerId: 'player1' } } : c) });
    expect(controlled.combat[0].blockers).toEqual([]);
    expect(reconcileCombat({ ...controlled, battlefield: room.battlefield }).combat[0].blockers).toEqual([]);
    expect(reconcileCombat({ ...room, battlefield: [{ ...room.battlefield[0], state: { ...room.battlefield[0].state, zoneRevision: 2 } }] }).combat).toEqual([]);
    expect(reconcileCombat({ ...room, battlefield: [{ ...room.battlefield[0], blueprint: { ...room.battlefield[0].blueprint, cardTypes: ['Artifact'] } }] }).combat).toEqual([]);
  });

  it('captures declaration snapshots by value', () => {
    const card = creature('a', 'player1');
    const room = { ...createTestRoom(), battlefield: [card], phase: 'declareAttackersStep' as const };
    const result = declareAttackersHandler.propose(room, 'player1', { attackers: [{ cardUuid: 'a' }] });
    if (!result.success) throw new Error(result.reason);
    const declared = result.mutations!.reduce(gameReducer, room);
    card.state.zoneRevision = 9;
    expect(declared.combat[0].attacker.state.zoneRevision).toBe(0);
    expect(declared.combat[0].blocked).toBe(false);
  });

  it('checks live Flying when declaring blockers and rejects repeated attacker entries', () => {
    const room = combatRoom(createTestRoom(), creature('a', 'player1'), [creature('b', 'player2')]);
    room.combat[0].blockers = []; room.combatDeclarations!.blockers = false; room.phase = 'declareBlockersStep';
    room.battlefield[0] = { ...room.battlefield[0], blueprint: { ...room.battlefield[0].blueprint, keywords: ['Flying'] } };
    const assignments = [{ attackerUuid: 'a', blockerUuids: ['b'] }];
    expect(declareBlockersHandler.validate(room, 'player2', { assignments }).success).toBe(false);
    room.battlefield[0] = { ...room.battlefield[0], blueprint: { ...room.battlefield[0].blueprint, keywords: [] } };
    expect(declareBlockersHandler.validate(room, 'player2', { assignments: [...assignments, { attackerUuid: 'a', blockerUuids: [] }] }).success).toBe(false);
  });

  it('allows a registered whole-declaration restriction without implementing a keyword', () => {
    const stop = CombatRuleRegistry.register({ validateAttackers: ({ attackers }) => attackers.length > 1 ? 'Only one attacker in this test' : undefined });
    try {
      const room = { ...createTestRoom(), battlefield: [creature('a', 'player1'), creature('b', 'player1')], phase: 'declareAttackersStep' as const };
      expect(declareAttackersHandler.validate(room, 'player1', { attackers: [{ cardUuid: 'a' }, { cardUuid: 'b' }] })).toMatchObject({ success: false, reason: 'Only one attacker in this test' });
      expect(room.battlefield.every(card => !card.state.isTapped)).toBe(true);
    } finally { stop(); }
  });

  it('allows an extension to permit attacking through summoning sickness', () => {
    const stop = CombatRuleRegistry.register({ canAttackWhileSummoningSick: () => true });
    try {
      const card = creature('a', 'player1'); card.state.summoningSickness = true;
      const room = { ...createTestRoom(), battlefield: [card], phase: 'declareAttackersStep' as const };
      expect(declareAttackersHandler.validate(room, 'player1', { attackers: [{ cardUuid: 'a' }] }).success).toBe(true);
    } finally { stop(); }
  });

  it('allows a pairwise blocking exception while preserving whole-declaration restrictions', () => {
    const room = combatRoom(createTestRoom(), creature('a', 'player1', 2, 4, ['Flying']), [creature('b', 'player2')]);
    room.phase = 'declareBlockersStep'; room.combatDeclarations!.blockers = false; room.combat[0].blockers = [];
    const stop = CombatRuleRegistry.register({ canBlockPair: () => true });
    try { expect(declareBlockersHandler.validate(room, 'player2', { assignments: [{ attackerUuid: 'a', blockerUuids: ['b'] }] }).success).toBe(true); }
    finally { stop(); }
  });

  it('exposes declaration consequence hooks while keeping declarations turn-based', () => {
    const stop = CombatRuleRegistry.register({
      attackerMutations: (_context, proposed) => proposed.filter(mutation => mutation.type !== 'TAP_CARD'),
      blockerMutations: (_context, proposed) => [{ type: 'ADD_COUNTER', cardUuid: 'b', counterType: 'test-block', amount: 1 }, ...proposed],
    });
    try {
      let room = { ...createTestRoom(), battlefield: [creature('a', 'player1'), creature('b', 'player2')], phase: 'declareAttackersStep' as const };
      const attack = declareAttackersHandler.propose(room, 'player1', { attackers: [{ cardUuid: 'a' }] });
      if (!attack.success) throw new Error(attack.reason);
      let declared = attack.mutations!.reduce(gameReducer, room);
      expect(declared.battlefield[0].state.isTapped).toBe(false);
      expect(declared.combat).toHaveLength(1);
      declared = { ...declared, phase: 'declareBlockersStep' };
      const block = declareBlockersHandler.propose(declared, 'player2', { assignments: [{ attackerUuid: 'a', blockerUuids: ['b'] }] });
      if (!block.success) throw new Error(block.reason);
      declared = block.mutations!.reduce(gameReducer, declared);
      expect(declared.battlefield[1].state.counters['test-block']).toBe(1);
      expect(declared.combatDeclarations?.blockers).toBe(true);
      expect(declared.stack).toEqual([]);
    } finally { stop(); }
  });
});
