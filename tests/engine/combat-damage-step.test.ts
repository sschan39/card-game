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
});