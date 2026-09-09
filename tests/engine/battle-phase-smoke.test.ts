// tests/engine/battle-phase-smoke.test.ts
// Smoke test replicating the server's phase-aware "End Turn" flow (server.ts):
//   Main Phase → (End Turn) → combat steps → next turn.
// This proves the combat pipeline is reachable in normal play and attacks resolve.
import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { createTestRoom } from '../helpers/test-room-factory';
import { ActionRegistry, registerAction } from '../../src/engine/action-registry';
import { attackHandler } from '../../src/engine/handlers/attack-handler';
import { playCardHandler } from '../../src/engine/handlers/play-card-handler';
import { tapForManaHandler } from '../../src/engine/handlers/tap-for-mana-handler';
import { endTurnHandler } from '../../src/engine/handlers/end-turn-handler';
import { instantiateCard } from '../../src/library/card-factory';
import { ACTION_IDS } from '../../src/types/action.ids';
import type { GameRoom } from '../../src/types/game.room.types';

/**
 * Replicates the server's `playerAction` endTurn branch (server.ts):
 * - From stateMainPhase → run the full five-step combat pipeline and complete
 *   the turn (endCombatStep → endPhase → cleanupStep → turnStart, switch turn,
 *   then draw phase → main phase).
 */
function serverEndTurn(engine: GameEngine, room: GameRoom, playerId: string) {
  const validate = endTurnHandler.validate(room, playerId, {});
  if (!validate.success) return { success: false, reason: validate.reason };

  const mutations: ReturnType<GameEngine['transition']> = [];
  if (room.currentPhase === 'stateMainPhase') {
    mutations.push(...engine.transition('beginCombatStep'));
    mutations.push(...engine.transition('declareAttackersStep'));
    mutations.push(...engine.transition('declareBlockersStep'));
    mutations.push(...engine.transition('combatDamageStep'));
    mutations.push(...engine.transition('endCombatStep'));
    mutations.push(...engine.transition('stateEndPhase'));
    mutations.push(...engine.transition('cleanupStep'));
    mutations.push(...engine.transition('stateTurnStart'));
    mutations.push(...engine.switchTurn());
    mutations.push(...engine.transition('stateDrawPhase'));
    mutations.push(...engine.transition('stateMainPhase'));
    mutations.push(...engine.givePriorityTo(engine.activeTurnPlayerId));
  }
  return { success: true, mutations };
}

describe('battle phase smoke test (server endTurn flow)', () => {
  let room: GameRoom;
  let engine: GameEngine;

  beforeEach(() => {
    // Reset the action registry to a known set.
    Object.keys(ActionRegistry).forEach((k) => delete ActionRegistry[k]);
    registerAction(ACTION_IDS.attack, attackHandler);
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
    // After the full chain, the turn has switched to player2 and we're back in main phase.
    expect(engine.roomState.activeTurnPlayerId).toBe('player2');
    expect(engine.roomState.currentPhase).toBe('stateMainPhase');
    // Combat is empty until an attack is declared.
    expect(engine.roomState.combat.length).toBe(0);
  });

  it('attacks the opponent player during main phase and applies damage', () => {
    room.currentPhase = 'stateMainPhase';
    room.priorityPlayerId = 'player1';

    const attacker = engine.roomState.battlefield.find(
      (c) => c.state.controllerId === 'player1'
    )!;
    const result = engine.proposeAndStack('player1', ACTION_IDS.attack, {
      cardUuid: attacker.uuid,
    });
    expect(result.success).toBe(true);

    const after = engine.roomState;
    // Damage applied immediately (turn-based action, not on stack).
    expect(after.players['player2'].life).toBe(19); // 20 - 1 power
    expect(after.stack.length).toBe(0);
    // Combat declaration recorded for UI.
    expect(after.combat.length).toBe(1);
    expect(after.combat[0].attacker.uuid).toBe(attacker.uuid);
    // Attacker tapped + marked attacked.
    const tapped = after.battlefield.find((c) => c.uuid === attacker.uuid)!;
    expect(tapped.state.isTapped).toBe(true);
    expect(tapped.state.attackedThisTurn).toBe(true);
  });

  it('completes the turn from main phase and clears combat', () => {
    // Declare an attack first so combat has a declaration to clear.
    room.currentPhase = 'stateMainPhase';
    room.priorityPlayerId = 'player1';
    const attacker = engine.roomState.battlefield.find(
      (c) => c.state.controllerId === 'player1'
    )!;
    engine.proposeAndStack('player1', ACTION_IDS.attack, { cardUuid: attacker.uuid });
    expect(engine.roomState.combat.length).toBe(1);

    // End turn from main phase (runs the full combat pipeline).
    const result = serverEndTurn(engine, engine.roomState, 'player1');
    expect(result.success).toBe(true);

    const after = engine.roomState;
    // Turn switched to player2, back in main phase.
    expect(after.activeTurnPlayerId).toBe('player2');
    expect(after.currentPhase).toBe('stateMainPhase');
    // Combat cleared at endCombatStep.
    expect(after.combat.length).toBe(0);
  });

  it('cannot attack outside the main phase', () => {
    room.currentPhase = 'beginCombatStep';
    room.priorityPlayerId = 'player1';
    const attacker = engine.roomState.battlefield.find(
      (c) => c.state.controllerId === 'player1'
    )!;
    const result = engine.proposeAndStack('player1', ACTION_IDS.attack, {
      cardUuid: attacker.uuid,
    });
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/main phase/i);
  });
});