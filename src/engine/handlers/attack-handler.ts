// src/engine/handlers/attack-handler.ts
import type { ActionHandler, ActionData, ActionResult } from '../action-registry';
import type { GameMutation } from '../../types/game-mutation.types';
import type { GameRoom, PlayerId } from '../../types/game.room.types';
import type { CardInstance } from '../../types/card.types';
import type { CombatDeclaration, TargetPointer } from '../../types/effect.types';
import { CardCharacteristicService } from '../card-characteristic-service';

function findCardOnBattlefield(room: GameRoom, playerId: PlayerId, cardUuid: string): CardInstance | undefined {
  return room.battlefield.find(c => c.uuid === cardUuid && c.state.controllerId === playerId);
}

function findAnyCardOnBattlefield(room: GameRoom, cardUuid: string): CardInstance | undefined {
  return room.battlefield.find(c => c.uuid === cardUuid);
}

export const attackHandler: ActionHandler = {
  validate(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult {
    if (!action.cardUuid) {
      return { success: false, phase: 'validate', reason: 'cardUuid is required' };
    }
    // Must be your turn
    if (room.activeTurnPlayerId !== playerId) {
      return { success: false, phase: 'validate', reason: 'Not your turn' };
    }

    // Must be in battle phase
    if (room.currentPhase !== 'stateBattlePhase') {
      return { success: false, phase: 'validate', reason: 'Can only attack during battle phase' };
    }

    const card = findCardOnBattlefield(room, playerId, action.cardUuid);
    if (!card) {
      return { success: false, phase: 'validate', reason: 'Creature not found on your battlefield' };
    }

    // Must be a creature
    if (!card.blueprint.cardTypes.includes('Creature')) {
      return { success: false, phase: 'validate', reason: 'Only creatures can attack' };
    }

    // Must be untapped
    if (card.state.isTapped) {
      return { success: false, phase: 'validate', reason: 'Creature is already tapped' };
    }

    // Must not have summoning sickness
    if (card.state.summoningSickness) {
      return { success: false, phase: 'validate', reason: 'Creature has summoning sickness' };
    }

    // Must not have already attacked this turn
    if (card.state.attackedThisTurn) {
      return { success: false, phase: 'validate', reason: 'Creature has already attacked this turn' };
    }

    // Validate target
    const targets = action.targets as TargetPointer[] | undefined;
    if (targets && targets.length > 0) {
      const target = targets[0];

      // Target is a creature
      if (target.targetType === 'permanent' && target.cardUuid) {
        const defender = findAnyCardOnBattlefield(room, target.cardUuid);
        if (!defender) {
          return { success: false, phase: 'validate', reason: 'Target creature not found on battlefield' };
        }
        if (!defender.blueprint.cardTypes.includes('Creature')) {
          return { success: false, phase: 'validate', reason: 'Target is not a creature' };
        }
        // Cannot attack your own creatures
        if (defender.state.controllerId === playerId) {
          return { success: false, phase: 'validate', reason: 'Cannot attack your own creature' };
        }
        // Flying evasion: non-flying creatures cannot attack flying creatures
        const attackerHasFlying = hasKeyword(card, 'Flying');
        const defenderHasFlying = hasKeyword(defender, 'Flying');
        if (defenderHasFlying && !attackerHasFlying) {
          return { success: false, phase: 'validate', reason: 'Cannot attack a Flying creature without Flying' };
        }
      }
      // Target is a player — always valid (attack the face)
      // No additional validation needed for player targets
    }
    // If no targets provided, default to attacking the opponent player (attack the face)

    return { success: true };
  },

  propose(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult {
    if (!action.cardUuid) {
      return { success: false, phase: 'propose', reason: 'cardUuid is required' };
    }
    const card = findCardOnBattlefield(room, playerId, action.cardUuid);
    if (!card) {
      return { success: false, phase: 'propose', reason: 'Creature disappeared from battlefield' };
    }

    const mutations: GameMutation[] = [];

    // --- COST: Tap the creature and mark as attacked ---
    mutations.push({ type: 'TAP_CARD', cardUuid: card.uuid });
    mutations.push({ type: 'SET_ATTACKED_THIS_TURN', cardUuid: card.uuid, value: true });

    const attackerPower = CardCharacteristicService.resolvePower(room, card);
    const targets = action.targets as TargetPointer[] | undefined;
    const targetCreature = targets && targets.length > 0 && targets[0].cardUuid
      ? findAnyCardOnBattlefield(room, targets[0].cardUuid)
      : undefined;

    const opponentId = room.player1Id === playerId ? room.player2Id! : room.player1Id;

    if (targetCreature) {
      // --- Creature-vs-creature combat ---
      const defenderPower = CardCharacteristicService.resolvePower(room, targetCreature);
      const defenderToughness = CardCharacteristicService.resolveToughness(room, targetCreature);

      // Attacker deals damage to defender (SET_DAMAGE accumulates on damageTaken)
      mutations.push({
        type: 'SET_DAMAGE',
        cardUuid: targetCreature.uuid,
        amount: (targetCreature.state.damageTaken || 0) + attackerPower,
      });

      // Defender deals counter-damage to attacker
      mutations.push({
        type: 'SET_DAMAGE',
        cardUuid: card.uuid,
        amount: (card.state.damageTaken || 0) + defenderPower,
      });

      // Trample: excess damage (attackerPower - defenderToughness) dealt to defending player
      if (hasKeyword(card, 'Trample') && attackerPower > defenderToughness) {
        const excessDamage = attackerPower - defenderToughness;
        const defenderControllerId = targetCreature.state.controllerId;
        const defenderPlayer = room.players[defenderControllerId];
        mutations.push({
          type: 'SET_LIFE',
          playerId: defenderControllerId,
          amount: defenderPlayer.life - excessDamage,
        });
      }
    } else {
      // --- Attack the face (opponent player) ---
      const opponent = room.players[opponentId];
      mutations.push({
        type: 'SET_LIFE',
        playerId: opponentId,
        amount: opponent.life - attackerPower,
      });
    }

    // Build CombatDeclaration for room.combat (for UI / future blocker step)
    const declaration: CombatDeclaration = {
      uuid: (action.stackUuid as string) || '',
      attacker: card,
      target: targetCreature
        ? { targetType: 'permanent', cardUuid: targetCreature.uuid }
        : { targetType: 'player', playerId: opponentId },
      attackerPower,
      defenderPower: targetCreature ? CardCharacteristicService.resolvePower(room, targetCreature) : undefined,
    };

    // Push to room.combat (turn-based action — NOT on the stack)
    mutations.push({ type: 'ADD_COMBAT_DECLARATION', declaration });

    // No stackObject — attack is a turn-based action, damage applied immediately.
    return { success: true, mutations, attackingCard: card, combatDeclaration: declaration };
  },
};

/** Check if a card has a keyword (from card_data.json `keywords` array). */
function hasKeyword(card: CardInstance, keyword: string): boolean {
  const keywords = (card.blueprint as any).keywords as string[] | undefined;
  return keywords?.includes(keyword) ?? false;
}