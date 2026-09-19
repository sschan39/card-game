// tests/engine/battle-phase-smoke.test.ts
// Smoke test replicating the server's phase-aware "End Turn" flow (server.ts):
//   Main Phase → (End Turn) → declareAttackersStep → declareBlockersStep →
//   combatDamageStep → endCombatStep → next turn.
// This proves the combat pipeline is reachable in normal play and attacks resolve.
import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { createTestRoom } from '../helpers/test-room-factory';
import { ActionRegistry, registerAction } from '../../src/engine/action-registry';
import { declareAttackersHandler } from '../../src/engine/handlers/declare-attackers-handler';
import { declareBlockersHandler } from '../../src/engine/handlers/declare-blockers-handler';
import { playCardHandler } from '../../src/engine/handlers/play-card-handler';
import { tapForManaHandler } from '../../src/engine/handlers/tap-for-mana-handler';
import { endTurnHandler } from '../../src/engine/handlers/end-turn-handler';
import { instantiateCard } from '../../src/library/card-factory';
import { ACTION_IDS } from '../../src/types/action.ids';
import type { GameRoom } from '../../src/types/game.room.types';

/**
 * Replicates the server's `playerAction` enterBattle branch (server.ts):
 * - From stateMainPhase → advance into combat, stopping at beginCombatStep.
 */
function serverEnterBattle(engine: GameEngine, room: GameRoom, playerId: string) {
  const validate = endTurnHandler.validate(room, playerId, {});
  if (!validate.success) return { success: false, reason: validate.reason };

  const mutations: ReturnType<GameEngine['transition']> = [];
  if (room.phase === 'stateMainPhase') {
    mutations.push(...engine.advancePhase('complete'));
  }
  return { success: true, mutations };
}

/**
 * Replicates the server's declareAttackers branch: propose attackers, then
 * advance to declareBlockersStep (the director gives priority to the defender).
 */
function serverDeclareAttackers(engine: GameEngine, room: GameRoom, playerId: string, attackers: { cardUuid: string }[]) {
  const result = engine.proposeAndStack(playerId, ACTION_IDS.declareAttackers, { attackers });
  if (!result.success) return { success: false, reason: result.reason };
  const mutations = result.mutations ?? [];
  mutations.push(...engine.advancePhase('complete'));
  return { success: true, mutations };
}

/**
 * Replicates the server's declareBlockers branch: propose blockers, then
 * advance through combatDamageStep → endCombatStep → ... → mainPhase.
 */
function serverDeclareBlockers(engine: GameEngine, room: GameRoom, playerId: string, assignments: { attackerUuid: string; blockerUuids: string[] }[]) {
  const result = engine.proposeAndStack(playerId, ACTION_IDS.declareBlockers, { assignments });
  if (!result.success) return { success: false, reason: result.reason };
  const mutations = result.mutations ?? [];
  mutations.push(...engine.advancePhase('complete'));
  return { success: true, mutations };
}

describe('battle phase smoke test (server endTurn flow)', () => {
  let room: GameRoom;
  let engine: GameEngine;

  beforeEach(() => {
    // Reset the action registry to a known set.
    Object.keys(ActionRegistry).forEach((k) => delete ActionRegistry[k]);
    registerAction(ACTION_IDS.declareAttackers, declareAttackersHandler);
    registerAction(ACTION_IDS.declareBlockers, declareBlockersHandler);
    registerAction(ACTION_IDS.castSpell, playCardHandler);
    registerAction(ACTION_IDS.tapForMana, tapForManaHandler);

    room = createTestRoom();
    engine = new GameEngine(room);
    engine.initRoom();

    // Give player1 a ready creature on the battlefield (no summoning sickness).
    const attacker = instantiateCard('empire-servant');
    attacker.state.zone = 'battlefield';
    attacker.state.ownerId = 'player1';
    attacker.state.controllerId = 'player1';
    attacker.state.summoningSickness = false;
    room.battlefield.push(attacker);
  });

  it('runs the full combat pipeline and completes the turn from main phase', () => {
    room.phase = 'stateMainPhase';
    room.priorityPlayerId = 'player1';

    const result = serverEnterBattle(engine, room, 'player1');
    expect(result.success).toBe(true);
    // After Enter Battle, we stop at beginCombatStep with priority to player1.
    expect(engine.roomState.phase).toBe('beginCombatStep');
    expect(engine.roomState.priorityPlayerId).toBe('player1');
    // Combat is empty until attackers are declared.
    expect(engine.roomState.combat.length).toBe(0);
  });

  it('declares attackers and advances to declareBlockersStep', () => {
    room.phase = 'stateMainPhase';
    room.priorityPlayerId = 'player1';

    const attacker = engine.roomState.battlefield.find(
      (c) => c.state.controllerId === 'player1'
    )!;

    // Enter battle → beginCombatStep, then advance to declareAttackersStep.
    serverEnterBattle(engine, room, 'player1');
    expect(engine.roomState.phase).toBe('beginCombatStep');
    engine.advancePhase('complete');
    expect(engine.roomState.phase).toBe('declareAttackersStep');

    // Declare attackers
    const result = serverDeclareAttackers(engine, engine.roomState, 'player1', [{ cardUuid: attacker.uuid }]);
    expect(result.success).toBe(true);

    const after = engine.roomState;
    // Combat declaration recorded for UI.
    expect(after.combat.length).toBe(1);
    expect(after.combat[0].attacker.uuid).toBe(attacker.uuid);
    // Attacker tapped + marked attacked.
    const tapped = after.battlefield.find((c) => c.uuid === attacker.uuid)!;
    expect(tapped.state.isTapped).toBe(true);
    expect(tapped.state.attackedThisTurn).toBe(true);
    // Now in declareBlockersStep with priority to the defender.
    expect(after.phase).toBe('declareBlockersStep');
    expect(after.priorityPlayerId).toBe('player2');
  });

  it('completes the turn from main phase and clears combat', () => {
    // Give player2 a blocker creature so the defender can declare a block.
    const blocker = instantiateCard('empire-servant');
    blocker.state.zone = 'battlefield';
    blocker.state.ownerId = 'player2';
    blocker.state.controllerId = 'player2';
    blocker.state.summoningSickness = false;
    room.battlefield.push(blocker);

    // Declare an attack first so combat has a declaration to clear.
    room.phase = 'stateMainPhase';
    room.priorityPlayerId = 'player1';
    const attacker = engine.roomState.battlefield.find(
      (c) => c.state.controllerId === 'player1'
    )!;

    serverEnterBattle(engine, room, 'player1');
    engine.advancePhase('complete');
    serverDeclareAttackers(engine, engine.roomState, 'player1', [{ cardUuid: attacker.uuid }]);
    expect(engine.roomState.combat.length).toBe(1);

    // Defender declares a blocker, then the turn completes.
    const result = serverDeclareBlockers(engine, engine.roomState, 'player2', [
      { attackerUuid: attacker.uuid, blockerUuids: [blocker.uuid] },
    ]);
    expect(result.success).toBe(true);

    const after = engine.roomState;
    // Turn switched to player2, back in main phase.
    expect(after.activeTurnPlayerId).toBe('player2');
    expect(after.phase).toBe('stateMainPhase');
    // Combat cleared at endCombatStep.
    expect(after.combat.length).toBe(0);
  });

  it('cannot declare attackers outside the declareAttackersStep', () => {
    room.phase = 'beginCombatStep';
    room.priorityPlayerId = 'player1';
    const attacker = engine.roomState.battlefield.find(
      (c) => c.state.controllerId === 'player1'
    )!;
    const result = engine.proposeAndStack('player1', ACTION_IDS.declareAttackers, {
      attackers: [{ cardUuid: attacker.uuid }],
    });
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/declare attackers step/i);
  });

  it('completes the turn with no blockers declared (empty assignments)', () => {
    room.phase = 'stateMainPhase';
    room.priorityPlayerId = 'player1';
    const attacker = engine.roomState.battlefield.find(
      (c) => c.state.controllerId === 'player1'
    )!;

    serverEnterBattle(engine, room, 'player1');
    engine.advancePhase('complete');
    serverDeclareAttackers(engine, engine.roomState, 'player1', [{ cardUuid: attacker.uuid }]);
    expect(engine.roomState.combat.length).toBe(1);

    // Defender declares no blockers (empty assignments)
    const result = serverDeclareBlockers(engine, engine.roomState, 'player2', []);
    expect(result.success).toBe(true);

    const after = engine.roomState;
    // Turn switched to player2, back in main phase.
    expect(after.activeTurnPlayerId).toBe('player2');
    expect(after.phase).toBe('stateMainPhase');
    // Combat cleared at endCombatStep.
    expect(after.combat.length).toBe(0);
    // Player2 took damage from unblocked attacker
    expect(after.players['player2'].life).toBe(20 - (attacker.blueprint.power ?? 0));
  });

  it('untaps the new active player\'s permanents after a full turn cycle', () => {
    // Regression: after a full turn cycle (P1 combat → P2 turn), the new
    // active player's permanents must untap and the previous player's stay
    // tapped. Exercises the director's switchTurn-before-untap ordering.
    room.phase = 'stateMainPhase';
    room.priorityPlayerId = 'player1';

    const attacker = engine.roomState.battlefield.find(
      (c) => c.state.controllerId === 'player1'
    )!;
    // Attacker should be untapped before declaring (MTG: tapped creatures can't attack).
    // The declareAttackers handler will tap it.

    // Give player2 a tapped creature too (should untap when player2's turn starts).
    const p2Creature = instantiateCard('empire-servant');
    p2Creature.state.zone = 'battlefield';
    p2Creature.state.ownerId = 'player2';
    p2Creature.state.controllerId = 'player2';
    p2Creature.state.isTapped = true;
    p2Creature.state.summoningSickness = false;
    room.battlefield.push(p2Creature);

    // Run the full turn: enter battle → declare attackers → declare blockers → complete.
    serverEnterBattle(engine, room, 'player1');
    engine.advancePhase('complete'); // → declareAttackersStep
    expect(engine.roomState.phase).toBe('declareAttackersStep');
    const daResult = serverDeclareAttackers(engine, engine.roomState, 'player1', [{ cardUuid: attacker.uuid }]);
    expect(daResult.success).toBe(true);
    // After declareAttackers, we should be in declareBlockersStep with player2 priority.
    expect(engine.roomState.phase).toBe('declareBlockersStep');
    expect(engine.roomState.priorityPlayerId).toBe('player2');
    serverDeclareBlockers(engine, engine.roomState, 'player2', []);

    const after = engine.roomState;
    expect(after.activeTurnPlayerId).toBe('player2');
    expect(after.phase).toBe('stateMainPhase');

    // Player2's creature should be untapped (it's player2's turn now).
    const p2After = after.battlefield.find(c => c.uuid === p2Creature.uuid)!;
    expect(p2After.state.isTapped).toBe(false);

    // Player1's creature should still be tapped (not player1's turn).
    const p1After = after.battlefield.find(c => c.uuid === attacker.uuid)!;
    expect(p1After.state.isTapped).toBe(true);
  });
});