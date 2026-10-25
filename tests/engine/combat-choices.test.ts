import { describe, expect, it } from 'vitest';
import { creature, combatRoom } from '../helpers/combat-fixture';
import { createTestRoom } from '../helpers/test-room-factory';
import { GameEngine } from '@engine/game-engine';
import { CombatRuleRegistry } from '@engine/combat-rules';

describe('manual combat damage', () => {
  function setup(power = 5, keywords: string[] = [], blockers = [creature('b', 'player2', 1, 6), creature('c', 'player2', 2, 4)]) {
    const room = combatRoom(createTestRoom({ phase: 'declareBlockersStep' }), creature('a', 'player1', power, 9, keywords), blockers);
    const engine = new GameEngine(room); engine.initRoom(); return engine;
  }
  function enter(engine: GameEngine) {
    expect(engine.executePlayerAction('player1', 'pass_priority').success).toBe(true);
    expect(engine.executePlayerAction('player2', 'pass_priority').success).toBe(true);
    expect(engine.phase).toBe('combatDamageStep');
  }
  function answer(engine: GameEngine, allocations: Record<string, number>, playerId = engine.roomState.pendingChoice!.playerId) {
    return engine.executePlayerAction(playerId, 'choose', { choiceId: engine.roomState.pendingChoice!.id, allocations });
  }
  function id(engine: GameEngine, recipient: string) {
    return engine.roomState.pendingChoice!.options.find(option => option.label === recipient)!.id;
  }

  it('waits for player splits and commits attacker/blocker damage simultaneously', () => {
    const engine = setup(); enter(engine);
    expect(engine.roomState.pendingChoice).toMatchObject({ playerId: 'player1', kind: 'distribution', total: 5, continuation: { type: 'combat' } });
    expect(engine.priorityPlayerId).toBeNull();
    expect(engine.roomState.battlefield.every(card => card.state.damageTaken === 0)).toBe(true);
    expect(answer(engine, { [id(engine, 'b')]: 3, [id(engine, 'c')]: 2 }).success).toBe(true);
    expect(engine.roomState.battlefield.every(card => card.state.damageTaken === 0)).toBe(true);
    expect(engine.roomState.pendingChoice?.playerId).toBe('player2');
    expect(answer(engine, { [id(engine, 'a')]: 1 }).success).toBe(true);
    expect(answer(engine, { [id(engine, 'a')]: 2 }).success).toBe(true);
    expect(engine.roomState.pendingChoice).toBeNull();
    expect(engine.roomState.battlefield.map(card => card.state.damageTaken)).toEqual([3, 3, 2]);
    expect(engine.priorityPlayerId).toBe('player1');
    expect(engine.roomState.stack).toEqual([]);
  });

  it('allows all power to be overassigned to one blocker', () => {
    const engine = setup(5, [], [creature('b', 'player2', 0, 1), creature('c', 'player2', 0, 6)]); enter(engine);
    expect(answer(engine, { [id(engine, 'b')]: 5 }).success).toBe(true);
    expect(engine.roomState.players.player2.graveyard.map(card => card.uuid)).toEqual(['b']);
    expect(engine.roomState.battlefield.find(card => card.uuid === 'c')?.state.damageTaken).toBe(0);
  });

  it('checks full power, recipient IDs, nonnegative integers, ownership and stale choices', () => {
    const engine = setup(); enter(engine);
    const before = JSON.stringify(engine.roomState);
    const key = id(engine, 'b');
    for (const allocations of [{ [key]: 4 }, { [key]: 6 }, { missing: 5 }, { [key]: 4.5, [id(engine, 'c')]: 0.5 }, { [key]: -1, [id(engine, 'c')]: 6 }]) expect(answer(engine, allocations).success).toBe(false);
    expect(answer(engine, { [key]: 5 }, 'player2').success).toBe(false);
    expect(engine.executePlayerAction('player1', 'choose', { choiceId: 'old', allocations: { [key]: 5 } }).success).toBe(false);
    expect(engine.executePlayerAction('player1', 'pass_priority').success).toBe(false);
    expect(engine.executePlayerAction('player1', 'end_turn').success).toBe(false);
    expect(JSON.stringify(engine.roomState)).toBe(before);
  });

  it('validates Trample spillover but permits blocker overassignment', () => {
    const engine = setup(5, ['Trample'], [creature('b', 'player2', 0, 2)]); enter(engine);
    const block = id(engine, 'b'), player = id(engine, 'player2');
    expect(answer(engine, { [block]: 1, [player]: 4 }).success).toBe(false);
    expect(answer(engine, { [block]: 3, [player]: 2 }).success).toBe(true);
    expect(engine.roomState.players.player2.life).toBe(18);
  });

  it('keeps blocked status when the last blocker disappears; Trample retains a player recipient', () => {
    for (const keywords of [[], ['Trample']]) {
      const engine = setup(5, keywords, [creature('b', 'player2', 0, 2)]);
      engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: 'b', playerId: 'player2', from: 'battlefield', to: 'exile' }]);
      enter(engine);
      if (keywords.length) expect(answer(engine, { [id(engine, 'player2')]: 5 }).success).toBe(true);
      else expect(engine.roomState.pendingChoice).toBeFalsy();
      expect(engine.roomState.players.player2.life).toBe(keywords.length ? 15 : 20);
    }
  });

  it('uses live power and clamps nonpositive power', () => {
    for (const power of [-2, 0, 3]) {
      const engine = setup(2, [], []);
      engine.roomState.battlefield[0] = { ...engine.roomState.battlefield[0], blueprint: { ...engine.roomState.battlefield[0].blueprint, power } };
      enter(engine);
      if (power > 0) { expect(engine.roomState.pendingChoice?.total).toBe(3); expect(answer(engine, { [id(engine, 'player2')]: 3 }).success).toBe(true); }
      expect(engine.roomState.players.player2.life).toBe(20 - Math.max(0, power));
    }
  });

  it('resumes a serialized room after one controller has allocated', () => {
    let engine = setup(); enter(engine);
    expect(answer(engine, { [id(engine, 'b')]: 3, [id(engine, 'c')]: 2 }).success).toBe(true);
    const saved = JSON.stringify(engine.roomState); engine.dispose();
    engine = new GameEngine(JSON.parse(saved)); engine.initRoom();
    expect(answer(engine, { [id(engine, 'a')]: 1 }).success).toBe(true);
    expect(answer(engine, { [id(engine, 'a')]: 2 }).success).toBe(true);
    expect(engine.roomState.battlefield.map(card => card.state.damageTaken)).toEqual([3, 3, 2]);
  });

  it('retains participants through the end-combat response window and clears them on leaving combat', () => {
    const engine = setup(2, [], []); enter(engine);
    expect(answer(engine, { [id(engine, 'player2')]: 2 }).success).toBe(true);
    engine.passPriority('player1'); engine.passPriority('player2');
    expect(engine.phase).toBe('endCombatStep');
    expect(engine.roomState.combat).toHaveLength(1);
    engine.passPriority('player1'); engine.passPriority('player2');
    expect(engine.phase).toBe('postcombatMainPhase');
    expect(engine.roomState.combat).toEqual([]);
  });

  it('clears combat when the flow debug command skips to the end of the turn', () => {
    const engine = setup(2, [], []); engine.roomState.debugMode = 'flow'; enter(engine);
    expect(answer(engine, { [id(engine, 'player2')]: 2 }).success).toBe(true);
    expect(engine.executePlayerAction('player1', 'end_turn').success).toBe(true);
    expect(engine.roomState.combat).toEqual([]);
    expect(engine.roomState.combatDamage).toBeNull();
  });

  it('supports generic damage passes with a response window between passes', () => {
    const stop = CombatRuleRegistry.register({ damagePasses: () => ['test-pass', 'normal'], dealsDamage: ({ pass }) => pass === 'normal' });
    try {
      const engine = setup(2, [], []); enter(engine);
      expect(engine.roomState.pendingChoice).toBeFalsy();
      expect(engine.priorityPlayerId).toBe('player1');
      expect(engine.roomState.players.player2.life).toBe(20);
      enter(engine);
      expect(engine.roomState.pendingChoice?.total).toBe(2);
      expect(answer(engine, { [id(engine, 'player2')]: 2 }).success).toBe(true);
      expect(engine.roomState.players.player2.life).toBe(18);
      expect(engine.drainEventBatches().flatMap(batch => batch.events).filter(event => event.eventId === 'COMBAT_DAMAGE_RESOLVED')).toHaveLength(2);
    } finally { stop(); }
  });

  it('does not multiply damage when recipient extensions overlap', () => {
    const stop = CombatRuleRegistry.register({ damageRecipients: (_context, recipients) => [...recipients, ...recipients] });
    try {
      const engine = setup(5, [], []); enter(engine);
      expect(answer(engine, { [id(engine, 'player2')]: 5 }).success).toBe(true);
      expect(engine.roomState.players.player2.life).toBe(15);
    } finally { stop(); }
  });

  it('rejects a changed live plan without accepting part of the transaction', () => {
    const engine = setup(5, [], []); enter(engine);
    engine.applyMutations([{ type: 'ADD_COUNTER', cardUuid: 'a', counterType: '+1/+1', amount: 1 }]);
    const before = JSON.stringify(engine.roomState);
    expect(answer(engine, { [id(engine, 'player2')]: 5 })).toMatchObject({ success: false, reason: 'Combat damage plan is stale' });
    expect(JSON.stringify(engine.roomState)).toBe(before);
  });

  it('reconciles live state between two nonempty passes and restores the saved pass position', () => {
    const stop = CombatRuleRegistry.register({ damagePasses: () => ['test-pass', 'normal'] });
    try {
      let engine = setup(2, ['Trample'], [creature('b', 'player2', 0, 9)]); enter(engine);
      expect(answer(engine, { [id(engine, 'b')]: 2 }).success).toBe(true);
      expect(engine.roomState.battlefield[1].state.damageTaken).toBe(2);
      expect(engine.priorityPlayerId).toBe('player1');
      engine.applyMutations([{ type: 'ADD_COUNTER', cardUuid: 'a', counterType: '+1/+1', amount: 1 },
        { type: 'MOVE_CARD', cardUuid: 'b', playerId: 'player2', from: 'battlefield', to: 'exile' }]);
      const saved = JSON.stringify(engine.roomState); engine.dispose();
      engine = new GameEngine(JSON.parse(saved)); engine.initRoom();
      enter(engine);
      expect(engine.roomState.combatDamage?.passIndex).toBe(1);
      expect(engine.roomState.pendingChoice?.total).toBe(3);
      expect(answer(engine, { [id(engine, 'player2')]: 3 }).success).toBe(true);
      expect(engine.roomState.players.player2.life).toBe(17);
    } finally { stop(); }
  });

  it('exposes lethal-threshold and allocation-constraint hooks without hardcoding consumers', () => {
    const stop = CombatRuleRegistry.register({ lethalDamage: () => 1,
      validateAllocation: (_context, assignments) => assignments.some(assignment => assignment.amount === 4) ? 'Synthetic allocation restriction' : undefined });
    try {
      const engine = setup(5, ['Trample'], [creature('b', 'player2', 0, 9)]); enter(engine);
      const block = id(engine, 'b'), player = id(engine, 'player2');
      expect(answer(engine, { [block]: 1, [player]: 4 })).toMatchObject({ success: false, reason: 'Synthetic allocation restriction' });
      expect(answer(engine, { [block]: 2, [player]: 3 }).success).toBe(true);
      expect(engine.roomState.players.player2.life).toBe(17);
    } finally { stop(); }
  });
});
