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
 * Replicates the server's `playerAction` endTurn branch (server.ts):
 * - From stateMainPhase → enter combat and stop at declareAttackersStep.
 */
function serverEndTurn(engine: GameEngine, room: GameRoom, playerId: string) {
  const validate = endTurnHandler.validate(room, playerId, {});
  if (!validate.success) return { success: false, reason: validate.reason };

  const mutations: ReturnType<GameEngine['transition']> = [];
  if (room.currentPhase === 'stateMainPhase') {
    mutations.push(...engine.transition('beginCombatStep'));
    mutations.push(...engine.transition('declareAttackersStep'));
    mutations.push(...engine.givePriorityTo(engine.activeTurnPlayerId));
  }
  return { success: true, mutations };
}

/**
 * Replicates the server's declareAttackers branch: propose attackers, then
 * advance to declareBlockersStep and give priority to the defender.
 */
function serverDeclareAttackers(engine: GameEngine, room: GameRoom, playerId: string, attackers: { cardUuid: string }[]) {
  const result = engine.proposeAndStack(playerId, ACTION_IDS.declareAttackers, { attackers });
  if (!result.success) return { success: false, reason: result.reason };
  const mutations = result.mutations ?? [];
  mutations.push(...engine.transition('declareBlockersStep'));
  const defenderId = room.player1Id === playerId ? room.player2Id! : room.player1Id;
  mutations.push(...engine.givePriorityTo(defenderId));
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
  mutations.push(...engine.transition('combatDamageStep'));
  mutations.push(...engine.transition('endCombatStep'));
  mutations.push(...engine.transition('stateEndPhase'));
  mutations.push(...engine.transition('cleanupStep'));
  mutations.push(...engine.transition('stateTurnStart'));
  mutations.push(...engine.switchTurn());
  mutations.push(...engine.transition('stateDrawPhase'));
  mutations.push(...engine.transition('stateMainPhase'));
  mutations.push(...engine.givePriorityTo(engine.activeTurnPlayerId));
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
    room.currentPhase = 'stateMainPhase';
    room.priorityPlayerId = 'player1';

    const result = serverEndTurn(engine, room, 'player1');
    expect(result.success).toBe(true);
    // After End Turn, we stop at declareAttackersStep with priority to player1.
    expect(engine.roomState.currentPhase).toBe('declareAttackersStep');
    expect(engine.roomState.priorityPlayerId).toBe('player1');
    // Combat is empty until attackers are declared.
    expect(engine.roomState.combat.length).toBe(0);
  });

  it('declares attackers and advances to declareBlockersStep', () => {
    room.currentPhase = 'stateMainPhase';
    room.priorityPlayerId = 'player1';

    const attacker = engine.roomState.battlefield.find(
      (c) => c.state.controllerId === 'player1'
    )!;

    // End turn → declareAttackersStep
    serverEndTurn(engine, room, 'player1');
    expect(engine.roomState.currentPhase).toBe('declareAttackersStep');

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
    expect(after.currentPhase).toBe('declareBlockersStep');
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
    room.currentPhase = 'stateMainPhase';
    room.priorityPlayerId = 'player1';
    const attacker = engine.roomState.battlefield.find(
      (c) => c.state.controllerId === 'player1'
    )!;

    serverEndTurn(engine, room, 'player1');
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
    expect(after.currentPhase).toBe('stateMainPhase');
    // Combat cleared at endCombatStep.
    expect(after.combat.length).toBe(0);
  });

  it('cannot declare attackers outside the declareAttackersStep', () => {
    room.currentPhase = 'beginCombatStep';
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
    room.currentPhase = 'stateMainPhase';
    room.priorityPlayerId = 'player1';
    const attacker = engine.roomState.battlefield.find(
      (c) => c.state.controllerId === 'player1'
    )!;

    serverEndTurn(engine, room, 'player1');
    serverDeclareAttackers(engine, engine.roomState, 'player1', [{ cardUuid: attacker.uuid }]);
    expect(engine.roomState.combat.length).toBe(1);

    // Defender declares no blockers (empty assignments)
    const result = serverDeclareBlockers(engine, engine.roomState, 'player2', []);
    expect(result.success).toBe(true);

    const after = engine.roomState;
    // Turn switched to player2, back in main phase.
    expect(after.activeTurnPlayerId).toBe('player2');
    expect(after.currentPhase).toBe('stateMainPhase');
    // Combat cleared at endCombatStep.
    expect(after.combat.length).toBe(0);
    // Player2 took damage from unblocked attacker
    expect(after.players['player2'].life).toBe(20 - (attacker.blueprint.power ?? 0));
  });
});