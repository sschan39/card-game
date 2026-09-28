import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { createTestRoom } from '../helpers/test-room-factory';
import { registerAction } from '../../src/engine/action-registry';
import { declareAttackersHandler } from '../../src/engine/handlers/declare-attackers-handler';
import { declareBlockersHandler } from '../../src/engine/handlers/declare-blockers-handler';
import { instantiateCard } from '../../src/library/card-factory';
import { ACTION_IDS } from '../../src/types/action.ids';
import type { GameRoom } from '../../src/types/game.room.types';

describe('Combat Integration — attack → block → damage → SBA → death trigger', () => {
  let room: GameRoom;
  let engine: GameEngine;

  beforeEach(() => {
    room = createTestRoom();
    room.phase = 'stateMainPhase';
    registerAction(ACTION_IDS.declareAttackers, declareAttackersHandler);
    registerAction(ACTION_IDS.declareBlockers, declareBlockersHandler);

    // Attacker: Crimson Hellkite (5/5 Flying) on player1's battlefield
    const attacker = instantiateCard('card_09876_core_set');
    attacker.state.zone = 'battlefield';
    attacker.state.ownerId = 'player1';
    attacker.state.controllerId = 'player1';
    attacker.state.summoningSickness = false;
    room.battlefield.push(attacker);

    // Defender: empire-servant (1/1) on player2's battlefield with an ON_DIE trigger
    const defender = instantiateCard('empire-servant');
    defender.state.zone = 'battlefield';
    defender.state.ownerId = 'player2';
    defender.state.controllerId = 'player2';
    defender.state.summoningSickness = false;
    // Give defender Flying so it can block the Flying attacker, plus an ON_DIE
    // trigger that draws a card for its controller. The keywords are restored
    // at the end of the test to avoid leaking the shared blueprint cache.
    (defender.blueprint as any).__originalKeywords = defender.blueprint.keywords;
    defender.blueprint.keywords = [...(defender.blueprint.keywords ?? []), 'Flying'];
    (defender.blueprint as any).abilities = [
      ...defender.blueprint.abilities,
      {
        type: 'triggered',
        triggerCondition: 'ON_DIE',
        effect: { effectId: 'DRAW', params: { amount: 1 } },
        castSpeed: 'instant',
      },
    ];
    room.battlefield.push(defender);

    engine = new GameEngine(room);
    engine.initRoom();
  });

  it('full combat flow: declare attacker → block → both take damage → defender dies → death trigger fires', () => {
    const attacker = room.battlefield.find(c => c.state.controllerId === 'player1')!;
    const defender = room.battlefield.find(c => c.state.controllerId === 'player2')!;

    // Enter declareAttackersStep
    engine.transition('beginCombatStep');
    engine.transition('declareAttackersStep');

    // Declare attacker (attackers always target the defending player)
    const declareResult = engine.proposeAndStack('player1', ACTION_IDS.declareAttackers, {
      attackers: [{ cardUuid: attacker.uuid }],
    });
    expect(declareResult.success).toBe(true);

    // Attacker should be tapped and marked as attacked
    const roomAfterDeclare = engine.roomState;
    const attackerAfter = roomAfterDeclare.battlefield.find(c => c.uuid === attacker.uuid)!;
    expect(attackerAfter.state.isTapped).toBe(true);
    expect(attackerAfter.state.attackedThisTurn).toBe(true);

    // Combat declaration recorded in room.combat (no target — attackers hit the player)
    expect(roomAfterDeclare.combat.length).toBe(1);
    expect(roomAfterDeclare.combat[0].attacker.uuid).toBe(attacker.uuid);
    expect(roomAfterDeclare.combat[0].blockers).toEqual([]);

    // Enter declareBlockersStep and declare a blocker
    engine.transition('declareBlockersStep');
    const blockResult = engine.proposeAndStack('player2', ACTION_IDS.declareBlockers, {
      assignments: [{ attackerUuid: attacker.uuid, blockerUuids: [defender.uuid] }],
    });
    expect(blockResult.success).toBe(true);

    // Enter combatDamageStep — damage resolves here
    engine.transition('combatDamageStep');
    const roomAfterDamage = engine.roomState;

    // Defender (5 damage >= 1 toughness) dies and moves to the graveyard.
    const defenderInGraveyard = roomAfterDamage.players['player2'].graveyard.find(
      c => c.uuid === defender.uuid
    );
    expect(defenderInGraveyard).toBeDefined();

    // Attacker should still be on battlefield with 1 damage (defender's counter-attack)
    const attackerOnBoard = roomAfterDamage.battlefield.find(c => c.uuid === attacker.uuid)!;
    expect(attackerOnBoard).toBeDefined();
    expect(attackerOnBoard.state.damageTaken).toBe(1); // defender's power

    // ON_DIE trigger should have fired — a triggered StackObject should be on the stack
    // (the death trigger pushes a new StackObject for the draw)
    expect(roomAfterDamage.stack.length).toBeGreaterThanOrEqual(1);
    const deathTrigger = roomAfterDamage.stack.find(
      s => s.type === 'triggered' && s.source.uuid === defender.uuid
    );
    expect(deathTrigger).toBeDefined();

    // Restore the shared blueprint keywords to avoid leaking into other tests.
    (defender.blueprint as any).keywords = (defender.blueprint as any).__originalKeywords;
  });

  it('attack the face: unblocked attacker deals damage to the defending player', () => {
    const attacker = room.battlefield.find(c => c.state.controllerId === 'player1')!;
    const initialLife = room.players['player2'].life;

    // Enter declareAttackersStep and declare attacker
    engine.transition('beginCombatStep');
    engine.transition('declareAttackersStep');
    const result = engine.proposeAndStack('player1', ACTION_IDS.declareAttackers, {
      attackers: [{ cardUuid: attacker.uuid }],
    });
    expect(result.success).toBe(true);

    // No blockers declared — skip to combatDamageStep
    engine.transition('declareBlockersStep');
    engine.transition('combatDamageStep');

    const roomAfter = engine.roomState;
    // Player2 should have taken 5 damage (attacker's power = 5 from Crimson Hellkite)
    expect(roomAfter.players['player2'].life).toBe(initialLife - 5);

    // No stack object for the attack itself
    expect(roomAfter.stack.length).toBe(0);
  });

  it('mutual destruction: both creatures have lethal damage → both die', () => {
    // Use two empire-servants (both 1/1) for mutual destruction
    // Remove the existing creatures and add two 1/1s
    room.battlefield = [];
    engine = new GameEngine(room);
    engine.initRoom();

    const attacker = instantiateCard('empire-servant');
    attacker.state.zone = 'battlefield';
    attacker.state.ownerId = 'player1';
    attacker.state.controllerId = 'player1';
    attacker.state.summoningSickness = false;
    room.battlefield.push(attacker);

    const defender = instantiateCard('empire-servant');
    defender.state.zone = 'battlefield';
    defender.state.ownerId = 'player2';
    defender.state.controllerId = 'player2';
    defender.state.summoningSickness = false;
    room.battlefield.push(defender);

    engine = new GameEngine(room);
    engine.initRoom();

    // Enter declareAttackersStep and declare attacker
    engine.transition('beginCombatStep');
    engine.transition('declareAttackersStep');
    const declareResult = engine.proposeAndStack('player1', ACTION_IDS.declareAttackers, {
      attackers: [{ cardUuid: attacker.uuid }],
    });
    expect(declareResult.success).toBe(true);

    // Enter declareBlockersStep and declare blocker
    engine.transition('declareBlockersStep');
    const blockResult = engine.proposeAndStack('player2', ACTION_IDS.declareBlockers, {
      assignments: [{ attackerUuid: attacker.uuid, blockerUuids: [defender.uuid] }],
    });
    expect(blockResult.success).toBe(true);

    // Enter combatDamageStep — damage resolves, SBA runs
    engine.transition('combatDamageStep');
    const roomAfter = engine.roomState;

    // Both should be in graveyards
    const attackerInYard = roomAfter.players['player1'].graveyard.find(c => c.uuid === attacker.uuid);
    const defenderInYard = roomAfter.players['player2'].graveyard.find(c => c.uuid === defender.uuid);
    expect(attackerInYard).toBeDefined();
    expect(defenderInYard).toBeDefined();

    // Both should be off the battlefield
    expect(roomAfter.battlefield.find(c => c.uuid === attacker.uuid)).toBeUndefined();
    expect(roomAfter.battlefield.find(c => c.uuid === defender.uuid)).toBeUndefined();
  });
});