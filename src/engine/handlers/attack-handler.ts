// src/engine/handlers/attack-handler.ts
import type { ActionHandler, ActionData, ActionResult } from '../action-registry';
import type { GameMutation } from '../../types/game-mutation.types';
import type { GameRoom, PlayerId } from '../../types/game.room.types';
import type { CardInstance } from '../../types/card.types';
import type { StackObject, StackEffect } from '../../types/effect.types';
import { CardCharacteristicService } from '../card-characteristic-service';

function findCardOnBattlefield(room: GameRoom, playerId: PlayerId, cardUuid: string): CardInstance | undefined {
  return room.battlefield.find(c => c.uuid === cardUuid && c.state.controllerId === playerId);
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

    return { success: true };
  },

  /**
   * Propose an attack: tap the creature as cost and push a StackObject
   * so the opponent can respond before damage is dealt.
   *
   * Cost zone changes (tap) happen immediately. Damage is deferred to
   * stack resolution via a MODIFY_LIFE effect.
   */
  propose(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult {
    if (!action.cardUuid) {
      return { success: false, phase: 'propose', reason: 'cardUuid is required' };
    }
    const card = findCardOnBattlefield(room, playerId, action.cardUuid);
    if (!card) {
      return { success: false, phase: 'propose', reason: 'Creature disappeared from battlefield' };
    }

    const mutations: GameMutation[] = [];

    // --- COST: Tap the creature (happens now, cannot be responded to) ---
    mutations.push({ type: 'TAP_CARD', cardUuid: card.uuid });

    // --- BUILD STACK OBJECT: damage is an effect that resolves on the stack ---
    const opponentId = room.player1Id === playerId ? room.player2Id! : room.player1Id;
    const power = CardCharacteristicService.resolvePower(room, card);

    const effects: StackEffect[] = [{
      action: 'MODIFY_LIFE',
      params: { amount: -power },
      tags: ['damage', 'combat'],
      targets: [{ targetType: 'player', playerId: opponentId }],
    }];

    const stackObj: StackObject = {
      uuid: (action.stackUuid as string) || '',
      type: 'activated',
      controllerId: playerId,
      source: card,
      effects,
      countered: false,
    };

    mutations.push({ type: 'PUSH_STACK', stackObject: stackObj });

    return { success: true, stackObject: stackObj, mutations, attackingCard: card };
  },

  resolve(_room: GameRoom, _stackObj: StackObject): ActionResult {
    return { success: true };
  },
};