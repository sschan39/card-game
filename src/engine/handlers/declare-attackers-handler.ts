// src/engine/handlers/declare-attackers-handler.ts
import type { ActionHandler, ActionData, ActionResult } from '../action-registry';
import type { GameMutation } from '../../types/game-mutation.types';
import type { GameRoom, PlayerId } from '../../types/game.room.types';
import type { CardInstance } from '../../types/card.types';
import type { CombatDeclaration } from '../../types/effect.types';
import { CardCharacteristicService } from '../card-characteristic-service';

function findCardOnBattlefield(room: GameRoom, playerId: PlayerId, cardUuid: string): CardInstance | undefined {
  return room.battlefield.find(c => c.uuid === cardUuid && c.state.controllerId === playerId);
}

export const declareAttackersHandler: ActionHandler = {
  validate(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult {
    const attackers = action.attackers as { cardUuid: string }[] | undefined;
    if (!attackers || attackers.length === 0) {
      return { success: false, phase: 'validate', reason: 'At least one attacker is required' };
    }

    // Must be your turn
    if (room.activeTurnPlayerId !== playerId) {
      return { success: false, phase: 'validate', reason: 'Not your turn' };
    }

    // Must be in declareAttackersStep
    if (room.currentPhase !== 'declareAttackersStep') {
      return { success: false, phase: 'validate', reason: 'Can only declare attackers during declare attackers step' };
    }

    // Check for duplicate cardUuids
    const uuids = attackers.map(a => a.cardUuid);
    if (new Set(uuids).size !== uuids.length) {
      return { success: false, phase: 'validate', reason: 'Duplicate attackers are not allowed' };
    }

    for (const { cardUuid } of attackers) {
      const card = findCardOnBattlefield(room, playerId, cardUuid);
      if (!card) {
        return { success: false, phase: 'validate', reason: `Creature ${cardUuid} not found on your battlefield` };
      }

      if (!card.blueprint.cardTypes.includes('Creature')) {
        return { success: false, phase: 'validate', reason: `Card ${cardUuid} is not a creature` };
      }

      if (card.state.isTapped) {
        return { success: false, phase: 'validate', reason: `Creature ${cardUuid} is already tapped` };
      }

      if (card.state.summoningSickness) {
        return { success: false, phase: 'validate', reason: `Creature ${cardUuid} has summoning sickness` };
      }

      if (card.state.attackedThisTurn) {
        return { success: false, phase: 'validate', reason: `Creature ${cardUuid} has already attacked this turn` };
      }
    }

    return { success: true };
  },

  propose(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult {
    const attackers = action.attackers as { cardUuid: string }[];
    const mutations: GameMutation[] = [];
    const declarations: CombatDeclaration[] = [];

    for (const { cardUuid } of attackers) {
      const card = findCardOnBattlefield(room, playerId, cardUuid);
      if (!card) {
        return { success: false, phase: 'propose', reason: `Creature ${cardUuid} disappeared from battlefield` };
      }

      // Cost: tap and mark as attacked
      mutations.push({ type: 'TAP_CARD', cardUuid: card.uuid });
      mutations.push({ type: 'SET_ATTACKED_THIS_TURN', cardUuid: card.uuid, value: true });

      const attackerPower = CardCharacteristicService.resolvePower(room, card);

      declarations.push({
        uuid: card.uuid, // use card uuid as declaration uuid for blocker assignment lookup
        attacker: card,
        attackerPower,
        blockers: [],
      });
    }

    // Batch declare all attackers at once
    mutations.push({ type: 'DECLARE_ATTACKERS', declarations });

    // No stackObject — turn-based action, damage applied later in combatDamageStep
    return { success: true, mutations };
  },
};