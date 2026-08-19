// src/engine/handlers/tap-for-mana-handler.ts
//
// Atomic mana ability handler. Taps a permanent to add mana to the
// controlling player's pool. Bypasses the stack entirely — no
// StackObject is created, no priority is passed.
//
// Works with any permanent that has a pure ADD_MANA activated ability
// (Lands default to {colorless: 1} if no explicit ability is defined).

import type { ActionHandler, ActionData, ActionResult } from '../action-registry';
import { ManaPool } from '../mana-pool';
import type { GameRoom, PlayerId } from '../../types/game.room.types';
import type { CardInstance, ManaColor } from '../../types/card.types';

function findCardOnBattlefield(room: GameRoom, playerId: PlayerId, cardUuid: string): CardInstance | undefined {
  return room.battlefield.find(c => c.uuid === cardUuid && c.state.controllerId === playerId);
}

export const tapForManaHandler: ActionHandler = {
  validate(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult {
    const card = findCardOnBattlefield(room, playerId, action.cardUuid);
    if (!card) {
      return { success: false, phase: 'validate', reason: 'Card not found on your battlefield' };
    }

    if (card.state.isTapped) {
      return { success: false, phase: 'validate', reason: 'Card is already tapped' };
    }

    if (card.state.summoningSickness) {
      return { success: false, phase: 'validate', reason: 'Card has summoning sickness' };
    }

    // Lands are always valid mana sources. Non-lands need a pure mana ability.
    const isLand = card.blueprint.cardTypes.includes('Land');
    const hasManaAbility = card.blueprint.abilities.some(
      a => a.type === 'activated' && ManaPool.isPureAbility(a.effect.effectId)
    );

    if (!isLand && !hasManaAbility) {
      return { success: false, phase: 'validate', reason: 'Card has no mana ability' };
    }

    return { success: true };
  },

  propose(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult {
    const card = findCardOnBattlefield(room, playerId, action.cardUuid);
    if (!card) {
      return { success: false, phase: 'propose', reason: 'Card disappeared from battlefield' };
    }

    // Tap the permanent (cost — happens now, cannot be responded to)
    card.state.isTapped = true;

    // Find the first pure mana ability on the card
    const manaAbility = card.blueprint.abilities.find(
      a => a.type === 'activated' && ManaPool.isPureAbility(a.effect.effectId)
    );

    if (manaAbility) {
      const params = manaAbility.effect.params as { color: string; amount: number };
      ManaPool.add(room.players[playerId].mana, params.color as ManaColor, params.amount ?? 1);
    } else {
      // Land fallback: 1 colorless mana
      ManaPool.add(room.players[playerId].mana, 'colorless', 1);
    }

    return { success: true };
  },

  resolve(_room: GameRoom, _stackObj: any): ActionResult {
    return { success: true };
  },
};