// src/engine/handlers/tap-for-mana-handler.ts
import type { ActionHandler, ActionData, ActionResult } from '../action-registry';
import type { GameRoom, PlayerId } from '../../types/game.room.types';
import type { CardInstance, ManaColor } from '../../types/card.types';

function findCardOnBattlefield(room: GameRoom, playerId: PlayerId, cardUuid: string): CardInstance | undefined {
  return room.battlefield.find(c => c.uuid === cardUuid && c.state.controllerId === playerId);
}

/**
 * Tap a land (or other mana source) to add mana to the player's pool.
 * This is a special action that does NOT use the stack (like MTG's mana abilities).
 */
export const tapForManaHandler: ActionHandler = {
  validate(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult {
    const card = findCardOnBattlefield(room, playerId, action.cardUuid);
    if (!card) {
      return { success: false, phase: 'validate', reason: 'Card not found on your battlefield' };
    }

    if (!card.blueprint.cardTypes.includes('Land')) {
      return { success: false, phase: 'validate', reason: 'Only lands can tap for mana' };
    }

    if (card.state.isTapped) {
      return { success: false, phase: 'validate', reason: 'Card is already tapped' };
    }

    if (card.state.summoningSickness) {
      return { success: false, phase: 'validate', reason: 'Card has summoning sickness' };
    }

    return { success: true };
  },

  propose(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult {
    const card = findCardOnBattlefield(room, playerId, action.cardUuid);
    if (!card) {
      return { success: false, phase: 'propose', reason: 'Card disappeared from battlefield' };
    }

    // Tap the land
    card.state.isTapped = true;

    // Find the first activated mana ability on the card
    const manaAbility = card.blueprint.abilities.find(
      a => a.type === 'activated' && a.effect.effectId === 'ADD_MANA'
    );

    if (manaAbility) {
      const params = manaAbility.effect.params as { color: string; amount: number };
      const color = params.color as ManaColor;
      const amount = params.amount ?? 1;
      room.players[playerId].mana[color] += amount;
    } else {
      // Fallback: add 1 colorless mana
      room.players[playerId].mana.colorless += 1;
    }

    return { success: true };
  },

  resolve(_room: GameRoom, _stackObj: any): ActionResult {
    return { success: true };
  },
};