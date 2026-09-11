// src/engine/handlers/declare-blockers-handler.ts
import type { ActionHandler, ActionData, ActionResult } from '../action-registry';
import type { GameMutation } from '../../types/game-mutation.types';
import type { GameRoom, PlayerId } from '../../types/game.room.types';
import type { CardInstance } from '../../types/card.types';
import { hasKeyword } from '../card-utils';

function findCardOnBattlefield(room: GameRoom, cardUuid: string): CardInstance | undefined {
  return room.battlefield.find(c => c.uuid === cardUuid);
}

export const declareBlockersHandler: ActionHandler = {
  validate(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult {
    const assignments = action.assignments as { attackerUuid: string; blockerUuids: string[] }[] | undefined;

    // Must be the defending player (NOT the active player)
    const defendingPlayerId = room.activeTurnPlayerId === room.player1Id
      ? room.player2Id! : room.player1Id;
    if (playerId !== defendingPlayerId) {
      return { success: false, phase: 'validate', reason: 'Only the defending player can declare blockers' };
    }

    // Must be in declareBlockersStep
    if (room.currentPhase !== 'declareBlockersStep') {
      return { success: false, phase: 'validate', reason: 'Can only declare blockers during declare blockers step' };
    }

    // Empty assignments = no blockers declared (valid — defender chooses not to block)
    if (!assignments || assignments.length === 0) {
      return { success: true };
    }

    // Track which blockers have been assigned (no duplicate blocking)
    const assignedBlockers = new Set<string>();

    for (const { attackerUuid, blockerUuids } of assignments) {
      // Attacker must exist in room.combat
      const combatDecl = room.combat.find(d => d.uuid === attackerUuid);
      if (!combatDecl) {
        return { success: false, phase: 'validate', reason: `Attacker ${attackerUuid} not found in combat declarations` };
      }

      const attackerHasFlying = hasKeyword(combatDecl.attacker, 'Flying');

      for (const blockerUuid of blockerUuids) {
        // Blocker must not already be assigned to another attacker
        if (assignedBlockers.has(blockerUuid)) {
          return { success: false, phase: 'validate', reason: `Blocker ${blockerUuid} is already assigned to another attacker` };
        }

        const blocker = findCardOnBattlefield(room, blockerUuid);
        if (!blocker) {
          return { success: false, phase: 'validate', reason: `Blocker ${blockerUuid} not found on battlefield` };
        }

        // Blocker must be controlled by the defending player
        if (blocker.state.controllerId !== playerId) {
          return { success: false, phase: 'validate', reason: `Blocker ${blockerUuid} is not on your battlefield` };
        }

        // Must be a creature
        if (!blocker.blueprint.cardTypes.includes('Creature')) {
          return { success: false, phase: 'validate', reason: `Card ${blockerUuid} is not a creature` };
        }

        // Must be untapped (MTG CR 509.1a — only untapped creatures can block)
        if (blocker.state.isTapped) {
          return { success: false, phase: 'validate', reason: `Creature ${blockerUuid} is tapped` };
        }

        // Flying evasion: non-flying creatures cannot block flying attackers
        if (attackerHasFlying && !hasKeyword(blocker, 'Flying')) {
          return { success: false, phase: 'validate', reason: `Cannot block Flying creature ${attackerUuid} without Flying` };
        }

        assignedBlockers.add(blockerUuid);
      }
    }

    return { success: true };
  },

  propose(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult {
    const assignments = action.assignments as { attackerUuid: string; blockerUuids: string[] }[] | undefined;
    const mutations: GameMutation[] = [];

    // Empty assignments = no blockers (valid)
    if (assignments && assignments.length > 0) {
      for (const { attackerUuid, blockerUuids } of assignments) {
        mutations.push({ type: 'ASSIGN_BLOCKERS', attackerUuid, blockerUuids });
      }
    }

    // Blocking does NOT tap the blocker (MTG CR 509.1f)
    // No stackObject — turn-based action
    return { success: true, mutations };
  },
};