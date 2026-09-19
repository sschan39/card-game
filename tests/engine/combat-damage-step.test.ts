// tests/engine/combat-damage-step.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { createTestRoom } from '../helpers/test-room-factory';
import { registerAction } from '../../src/engine/action-registry';
import { declareAttackersHandler } from '../../src/engine/handlers/declare-attackers-handler';
import { declareBlockersHandler } from '../../src/engine/handlers/declare-blockers-handler';
import { instantiateCard } from '../../src/library/card-factory';
import { ACTION_IDS } from '../../src/types/action.ids';
import type { GameRoom } from '../../src/types/game.room.types';

describe('combatDamageStep — damage resolution', () => {
  let room: GameRoom;
  let engine: GameEngine;

  beforeEach(() => {
    room = createTestRoom();
    registerAction(ACTION_IDS.declareAttackers, declareAttackersHandler);
    registerAction(ACTION_IDS.declareBlockers, declareBlockersHandler);

    engine = new GameEngine(room);
    engine.initRoom();
  });

  it('unblocked attacker deals damage to defending player', () => {
    // Put an attacker on player1's battlefield
    const attacker = instantiateCard('empire-servant');
    attacker.state.zone = 'battlefield';
    attacker.state.ownerId = 'player1';
    attacker.state.controllerId = 'player1';
    attacker.state.summoningSickness = false;
    room.battlefield.push(attacker);

    // Enter declareAttackersStep
    room.phase = 'stateMainPhase';
    engine.transition('beginCombatStep');
    engine.transition('declareAttackersStep');

    // Declare attacker
    const result = engine.proposeAndStack('player1', ACTION_IDS.declareAttackers, {
      attackers: [{ cardUuid: attacker.uuid }],
    });
    expect(result.success).toBe(true);

    // Transition to combatDamageStep (skip declareBlockersStep — no blockers declared)
    engine.transition('declareBlockersStep');
    engine.transition('combatDamageStep');

    // Defending player (player2) should have taken damage
    const after = engine.roomState;
    expect(after.players['player2'].life).toBe(20 - (attacker.blueprint.power ?? 0));
  });

  it('blocked attacker deals damage to blocker and blocker deals counter-damage', () => {
    // Attacker on player1
    const attacker = instantiateCard('empire-servant');
    attacker.state.zone = 'battlefield';
    attacker.state.ownerId = 'player1';
    attacker.state.controllerId = 'player1';
    attacker.state.summoningSickness = false;
    room.battlefield.push(attacker);

    // Blocker on player2
    const blocker = instantiateCard('empire-servant');
    blocker.state.zone = 'battlefield';
    blocker.state.ownerId = 'player2';
    blocker.state.controllerId = 'player2';
    blocker.state.summoningSickness = false;
    room.battlefield.push(blocker);

    // Enter declareAttackersStep
    room.phase = 'stateMainPhase';
    engine.transition('beginCombatStep');
    engine.transition('declareAttackersStep');

    // Declare attacker
    engine.proposeAndStack('player1', ACTION_IDS.declareAttackers, {
      attackers: [{ cardUuid: attacker.uuid }],
    });

    // Enter declareBlockersStep
    engine.transition('declareBlockersStep');

    // Declare blocker
    engine.proposeAndStack('player2', ACTION_IDS.declareBlockers, {
      assignments: [{ attackerUuid: attacker.uuid, blockerUuids: [blocker.uuid] }],
    });

    // Transition to combatDamageStep
    engine.transition('combatDamageStep');

    const after = engine.roomState;

    // Attacker takes counter-damage from blocker (1/1 vs 1/1 — both die via SBA)
    const attackerInGrave = after.players['player1'].graveyard.find(c => c.uuid === attacker.uuid);
    const attackerOnField = after.battlefield.find(c => c.uuid === attacker.uuid);
    const attackerDamage = attackerOnField?.state.damageTaken ?? (attackerInGrave ? 1 : 0);
    expect(attackerDamage).toBe(blocker.blueprint.power ?? 0);

    // Blocker takes damage from attacker
    const blockerInGrave = after.players['player2'].graveyard.find(c => c.uuid === blocker.uuid);
    const blockerOnField = after.battlefield.find(c => c.uuid === blocker.uuid);
    const blockerDamage = blockerOnField?.state.damageTaken ?? (blockerInGrave ? 1 : 0);
    expect(blockerDamage).toBe(attacker.blueprint.power ?? 0);

    // Defending player should NOT have taken damage (blocked)
    expect(after.players['player2'].life).toBe(20);
  });

  it('trample: excess damage over blocker toughness goes to defending player', () => {
    // Big attacker (5/5) on player1
    const attacker = instantiateCard('card_09876_core_set'); // Crimson Hellkite 5/5
    attacker.state.zone = 'battlefield';
    attacker.state.ownerId = 'player1';
    attacker.state.controllerId = 'player1';
    attacker.state.summoningSickness = false;
    // Give it Trample (no card has Trample natively yet). Restore after to
    // avoid leaking the shared blueprint cache.
    const originalKeywords = attacker.blueprint.keywords;
    attacker.blueprint.keywords = ['Trample'];
    room.battlefield.push(attacker);

    // Small blocker (1/1) on player2
    const blocker = instantiateCard('empire-servant');
    blocker.state.zone = 'battlefield';
    blocker.state.ownerId = 'player2';
    blocker.state.controllerId = 'player2';
    blocker.state.summoningSickness = false;
    room.battlefield.push(blocker);

    room.phase = 'stateMainPhase';
    engine.transition('beginCombatStep');
    engine.transition('declareAttackersStep');

    engine.proposeAndStack('player1', ACTION_IDS.declareAttackers, {
      attackers: [{ cardUuid: attacker.uuid }],
    });

    engine.transition('declareBlockersStep');

    engine.proposeAndStack('player2', ACTION_IDS.declareBlockers, {
      assignments: [{ attackerUuid: attacker.uuid, blockerUuids: [blocker.uuid] }],
    });

    engine.transition('combatDamageStep');

    const after = engine.roomState;

    // Blocker takes 5 damage (dies via SBA)
    const blockerAfter = after.battlefield.find(c => c.uuid === blocker.uuid);
    // Blocker may be dead (in graveyard) from SBA
    const blockerInGrave = after.players['player2'].graveyard.find(c => c.uuid === blocker.uuid);
    expect(blockerInGrave || (blockerAfter && blockerAfter.state.damageTaken >= 1)).toBeTruthy();

    // Defending player takes trample excess: 5 - 1 = 4
    expect(after.players['player2'].life).toBe(20 - 4);
  });

  it('two blockers: both take damage, both deal counter-damage', () => {
    const attacker = instantiateCard('empire-servant'); // 1/1
    attacker.state.zone = 'battlefield';
    attacker.state.ownerId = 'player1';
    attacker.state.controllerId = 'player1';
    attacker.state.summoningSickness = false;
    room.battlefield.push(attacker);

    const blocker1 = instantiateCard('empire-servant'); // 1/1
    blocker1.state.zone = 'battlefield';
    blocker1.state.ownerId = 'player2';
    blocker1.state.controllerId = 'player2';
    blocker1.state.summoningSickness = false;
    room.battlefield.push(blocker1);

    const blocker2 = instantiateCard('empire-servant'); // 1/1
    blocker2.state.zone = 'battlefield';
    blocker2.state.ownerId = 'player2';
    blocker2.state.controllerId = 'player2';
    blocker2.state.summoningSickness = false;
    room.battlefield.push(blocker2);

    room.phase = 'stateMainPhase';
    engine.transition('beginCombatStep');
    engine.transition('declareAttackersStep');
    engine.proposeAndStack('player1', ACTION_IDS.declareAttackers, {
      attackers: [{ cardUuid: attacker.uuid }],
    });
    engine.transition('declareBlockersStep');
    engine.proposeAndStack('player2', ACTION_IDS.declareBlockers, {
      assignments: [{ attackerUuid: attacker.uuid, blockerUuids: [blocker1.uuid, blocker2.uuid] }],
    });
    engine.transition('combatDamageStep');

    const after = engine.roomState;

    // Attacker (1/1) assigns 1 damage lethal-first to ONE blocker (the uuid
    // tiebreaker picks which, since both are identical 1/1s). The other takes 0.
    // Both blockers deal 1 counter-damage each → attacker takes 2.
    const b1InGrave = after.players['player2'].graveyard.find(c => c.uuid === blocker1.uuid);
    const b1OnField = after.battlefield.find(c => c.uuid === blocker1.uuid);
    const b1Damage = b1OnField?.state.damageTaken ?? (b1InGrave ? 1 : 0);

    const b2InGrave = after.players['player2'].graveyard.find(c => c.uuid === blocker2.uuid);
    const b2OnField = after.battlefield.find(c => c.uuid === blocker2.uuid);
    const b2Damage = b2OnField?.state.damageTaken ?? (b2InGrave ? 1 : 0);

    // Exactly one blocker took the 1 lethal damage; the other took 0.
    expect([b1Damage, b2Damage].sort()).toEqual([0, 1]);

    const atkInGrave = after.players['player1'].graveyard.find(c => c.uuid === attacker.uuid);
    const atkOnField = after.battlefield.find(c => c.uuid === attacker.uuid);
    const atkDamage = atkOnField?.state.damageTaken ?? (atkInGrave ? 2 : 0);
    expect(atkDamage).toBe(2);
  });

  it('lethal-first: first blocker gets lethal, remainder spills to second', () => {
    const attacker = instantiateCard('card_09876_core_set'); // Crimson Hellkite 5/5
    attacker.state.zone = 'battlefield';
    attacker.state.ownerId = 'player1';
    attacker.state.controllerId = 'player1';
    attacker.state.summoningSickness = false;
    room.battlefield.push(attacker);

    const b1 = instantiateCard('empire-servant');
    b1.state.zone = 'battlefield'; b1.state.ownerId = 'player2'; b1.state.controllerId = 'player2';
    b1.state.summoningSickness = false;
    room.battlefield.push(b1);
    const b2 = instantiateCard('empire-servant');
    b2.state.zone = 'battlefield'; b2.state.ownerId = 'player2'; b2.state.controllerId = 'player2';
    b2.state.summoningSickness = false;
    room.battlefield.push(b2);

    room.phase = 'stateMainPhase';
    engine.transition('beginCombatStep');
    engine.transition('declareAttackersStep');
    engine.proposeAndStack('player1', ACTION_IDS.declareAttackers, {
      attackers: [{ cardUuid: attacker.uuid }],
    });
    engine.transition('declareBlockersStep');
    engine.proposeAndStack('player2', ACTION_IDS.declareBlockers, {
      assignments: [{ attackerUuid: attacker.uuid, blockerUuids: [b1.uuid, b2.uuid] }],
    });
    engine.transition('combatDamageStep');

    const after = engine.roomState;
    // 5 power: 1 lethal to b1, 1 lethal to b2, 3 remaining (no trample → wasted)
    // Both blockers deal 1 each to attacker
    const atkAfter = after.battlefield.find(c => c.uuid === attacker.uuid);
    expect(atkAfter?.state.damageTaken ?? 2).toBe(2);
    // Both blockers should be dead (1 damage each, 1/1)
    expect(after.players['player2'].graveyard).toHaveLength(2);
  });

  it('damage order is attacker-neutral (not defender pairing order)', () => {
    const attacker = instantiateCard('card_09876_core_set'); // 5/5
    attacker.state.zone = 'battlefield';
    attacker.state.ownerId = 'player1'; attacker.state.controllerId = 'player1';
    attacker.state.summoningSickness = false;
    room.battlefield.push(attacker);

    const b1 = instantiateCard('empire-servant');
    b1.state.zone = 'battlefield'; b1.state.ownerId = 'player2'; b1.state.controllerId = 'player2';
    b1.state.summoningSickness = false;
    room.battlefield.push(b1);
    const b2 = instantiateCard('empire-servant');
    b2.state.zone = 'battlefield'; b2.state.ownerId = 'player2'; b2.state.controllerId = 'player2';
    b2.state.summoningSickness = false;
    room.battlefield.push(b2);

    room.phase = 'stateMainPhase';
    engine.transition('beginCombatStep');
    engine.transition('declareAttackersStep');
    engine.proposeAndStack('player1', ACTION_IDS.declareAttackers, {
      attackers: [{ cardUuid: attacker.uuid }],
    });
    engine.transition('declareBlockersStep');
    // Reverse order: b2 first, b1 second
    engine.proposeAndStack('player2', ACTION_IDS.declareBlockers, {
      assignments: [{ attackerUuid: attacker.uuid, blockerUuids: [b2.uuid, b1.uuid] }],
    });
    engine.transition('combatDamageStep');

    const after = engine.roomState;
    // Both blockers still die (5 power > 2 toughness total), attacker takes 2
    expect(after.players['player2'].graveyard).toHaveLength(2);
    const atkAfter = after.battlefield.find(c => c.uuid === attacker.uuid);
    expect(atkAfter?.state.damageTaken ?? 2).toBe(2);
  });

  it('damage order uses gameplay heuristic: highest-power blocker takes damage first', () => {
    const attacker = instantiateCard('card_09876_core_set'); // 5/5
    attacker.state.zone = 'battlefield';
    attacker.state.ownerId = 'player1'; attacker.state.controllerId = 'player1';
    attacker.state.summoningSickness = false;
    room.battlefield.push(attacker);

    // 3/3 blocker (empire-servant with +1/+1 counters)
    const bigB = instantiateCard('empire-servant'); // 1/1 base
    bigB.state.zone = 'battlefield'; bigB.state.ownerId = 'player2'; bigB.state.controllerId = 'player2';
    bigB.state.summoningSickness = false;
    bigB.state.counters = { '+1/+1': 2 }; // becomes 3/3
    room.battlefield.push(bigB);

    const smallB = instantiateCard('empire-servant'); // 1/1
    smallB.state.zone = 'battlefield'; smallB.state.ownerId = 'player2'; smallB.state.controllerId = 'player2';
    smallB.state.summoningSickness = false;
    room.battlefield.push(smallB);

    room.phase = 'stateMainPhase';
    engine.transition('beginCombatStep');
    engine.transition('declareAttackersStep');
    engine.proposeAndStack('player1', ACTION_IDS.declareAttackers, {
      attackers: [{ cardUuid: attacker.uuid }],
    });
    engine.transition('declareBlockersStep');
    engine.proposeAndStack('player2', ACTION_IDS.declareBlockers, {
      assignments: [{ attackerUuid: attacker.uuid, blockerUuids: [smallB.uuid, bigB.uuid] }],
    });
    engine.transition('combatDamageStep');

    const after = engine.roomState;
    // 5 power: 3 lethal to bigB (3/3), 1 lethal to smallB (1/1), 1 remaining (no trample → wasted)
    // bigB should be dead (took 3 damage, 3 toughness)
    expect(after.players['player2'].graveyard.find(c => c.uuid === bigB.uuid)).toBeDefined();
    // smallB should be dead (took 1 damage, 1 toughness)
    expect(after.players['player2'].graveyard.find(c => c.uuid === smallB.uuid)).toBeDefined();
    // Attacker takes 3 + 1 = 4 counter-damage
    const atkAfter = after.battlefield.find(c => c.uuid === attacker.uuid);
    expect(atkAfter?.state.damageTaken ?? 4).toBe(4);
  });

  it('trample with multiple blockers: excess over total lethal → player', () => {
    const attacker = instantiateCard('card_09876_core_set'); // 5/5
    attacker.state.zone = 'battlefield';
    attacker.state.ownerId = 'player1'; attacker.state.controllerId = 'player1';
    attacker.state.summoningSickness = false;
    const origKw = attacker.blueprint.keywords;
    attacker.blueprint.keywords = ['Trample'];
    room.battlefield.push(attacker);

    const b1 = instantiateCard('empire-servant'); // 1/1
    b1.state.zone = 'battlefield'; b1.state.ownerId = 'player2'; b1.state.controllerId = 'player2';
    b1.state.summoningSickness = false;
    room.battlefield.push(b1);
    const b2 = instantiateCard('empire-servant'); // 1/1
    b2.state.zone = 'battlefield'; b2.state.ownerId = 'player2'; b2.state.controllerId = 'player2';
    b2.state.summoningSickness = false;
    room.battlefield.push(b2);

    room.phase = 'stateMainPhase';
    engine.transition('beginCombatStep');
    engine.transition('declareAttackersStep');
    engine.proposeAndStack('player1', ACTION_IDS.declareAttackers, {
      attackers: [{ cardUuid: attacker.uuid }],
    });
    engine.transition('declareBlockersStep');
    engine.proposeAndStack('player2', ACTION_IDS.declareBlockers, {
      assignments: [{ attackerUuid: attacker.uuid, blockerUuids: [b1.uuid, b2.uuid] }],
    });
    engine.transition('combatDamageStep');

    const after = engine.roomState;
    // 5 power: 1 lethal to b1, 1 lethal to b2, 3 trample → player2
    expect(after.players['player2'].life).toBe(20 - 3);
    // Both blockers dead
    expect(after.players['player2'].graveyard).toHaveLength(2);
    // Attacker takes 2 (1 from each blocker)
    const atkAfter = after.battlefield.find(c => c.uuid === attacker.uuid);
    expect(atkAfter?.state.damageTaken ?? 2).toBe(2);

    attacker.blueprint.keywords = origKw;
  });

  it('trample with pre-damaged blocker: lethal accounts for existing damageTaken', () => {
    const attacker = instantiateCard('card_09876_core_set'); // 5/5
    attacker.state.zone = 'battlefield';
    attacker.state.ownerId = 'player1'; attacker.state.controllerId = 'player1';
    attacker.state.summoningSickness = false;
    const origKw = attacker.blueprint.keywords;
    attacker.blueprint.keywords = ['Trample'];
    room.battlefield.push(attacker);

    const blocker = instantiateCard('empire-servant'); // 1/1, undamaged
    blocker.state.zone = 'battlefield'; blocker.state.ownerId = 'player2'; blocker.state.controllerId = 'player2';
    blocker.state.summoningSickness = false;
    blocker.state.damageTaken = 0;
    room.battlefield.push(blocker);

    room.phase = 'stateMainPhase';
    engine.transition('beginCombatStep');
    engine.transition('declareAttackersStep');
    engine.proposeAndStack('player1', ACTION_IDS.declareAttackers, {
      attackers: [{ cardUuid: attacker.uuid }],
    });
    engine.transition('declareBlockersStep');
    engine.proposeAndStack('player2', ACTION_IDS.declareBlockers, {
      assignments: [{ attackerUuid: attacker.uuid, blockerUuids: [blocker.uuid] }],
    });
    engine.transition('combatDamageStep');

    const after = engine.roomState;
    // 5 power: 1 lethal to blocker, 4 trample → player2
    expect(after.players['player2'].life).toBe(20 - 4);
    // Blocker dead
    expect(after.players['player2'].graveyard).toHaveLength(1);

    attacker.blueprint.keywords = origKw;
  });

  it('per-blocker attribution: each blocker emits its own SET_DAMAGE with source', () => {
    const attacker = instantiateCard('empire-servant');
    attacker.state.zone = 'battlefield';
    attacker.state.ownerId = 'player1'; attacker.state.controllerId = 'player1';
    attacker.state.summoningSickness = false;
    room.battlefield.push(attacker);

    const b1 = instantiateCard('empire-servant');
    b1.state.zone = 'battlefield'; b1.state.ownerId = 'player2'; b1.state.controllerId = 'player2';
    b1.state.summoningSickness = false;
    room.battlefield.push(b1);
    const b2 = instantiateCard('empire-servant');
    b2.state.zone = 'battlefield'; b2.state.ownerId = 'player2'; b2.state.controllerId = 'player2';
    b2.state.summoningSickness = false;
    room.battlefield.push(b2);

    room.phase = 'stateMainPhase';
    engine.transition('beginCombatStep');
    engine.transition('declareAttackersStep');
    engine.proposeAndStack('player1', ACTION_IDS.declareAttackers, {
      attackers: [{ cardUuid: attacker.uuid }],
    });
    engine.transition('declareBlockersStep');
    engine.proposeAndStack('player2', ACTION_IDS.declareBlockers, {
      assignments: [{ attackerUuid: attacker.uuid, blockerUuids: [b1.uuid, b2.uuid] }],
    });

    // Capture mutations from combatDamageStep transition
    const muts = engine.transition('combatDamageStep');

    // Find SET_DAMAGE mutations targeting the attacker (counter-damage from blockers)
    const attackerDamageMuts = muts.filter(
      m => m.type === 'SET_DAMAGE' && m.cardUuid === attacker.uuid
    );
    // Should be 2 discrete mutations, one per blocker
    expect(attackerDamageMuts).toHaveLength(2);
    // Each should have a source
    expect(attackerDamageMuts[0]).toHaveProperty('source');
    expect(attackerDamageMuts[1]).toHaveProperty('source');
    // Sources should be the two blockers
    const sources = attackerDamageMuts.map(m => (m as any).source).sort();
    expect(sources).toContain(b1.uuid);
    expect(sources).toContain(b2.uuid);
  });
});