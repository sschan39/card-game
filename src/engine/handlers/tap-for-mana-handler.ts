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
import type { GameMutation } from '../../types/game-mutation.types';
import type { GameRoom, PlayerId } from '../../types/game.room.types';
import type { CardInstance, ManaColor } from '../../types/card.types';

function findCardOnBattlefield(room: GameRoom, playerId: PlayerId, cardUuid: string): CardInstance | undefined {
  return room.battlefield.find(c => c.uuid === cardUuid && c.state.controllerId === playerId);
}

export const tapForManaHandler: ActionHandler = {
  validate(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult {
    if (!action.cardUuid) {
      return { success: false, phase: 'validate', reason: 'cardUuid is required' };
    }
    const card = findCardOnBattlefield(room, playerId, action.cardUuid);
    if (!card) {
      return { success: false, phase: 'validate', reason: 'Card not found on your battlefield' };
    }

    if (card.state.isTapped) {
      return { success: false, phase: 'validate', reason: 'Card is already tapped' };
    }

    // Lands are always valid mana sources. Non-lands need a pure mana ability.
    const isLand = card.blueprint.cardTypes.includes('Land');
    const manaAbility = card.blueprint.abilities.find(
      (a): a is Extract<typeof a, { type: 'activated' }> =>
        a.type === 'activated' && ManaPool.isPureAbility(a.effect.effectId)
    );
    const hasManaAbility = !!manaAbility;

    if (!isLand && !hasManaAbility) {
      return { success: false, phase: 'validate', reason: 'Card has no mana ability' };
    }

    // Summoning sickness (CR 302.6): only blocks {T}-costed abilities on
    // creatures. Lands never have sickness; a non-tap mana ability is usable
    // even while sick.
    const tapsAsCost = isLand ? true : (manaAbility?.cost?.tap ?? false);
    if (tapsAsCost && card.state.summoningSickness) {
      return { success: false, phase: 'validate', reason: 'Card has summoning sickness' };
    }

    return { success: true };
  },

  propose(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult {
    if (!action.cardUuid) {
      return { success: false, phase: 'propose', reason: 'cardUuid is required' };
    }
    const card = findCardOnBattlefield(room, playerId, action.cardUuid);
    if (!card) {
      return { success: false, phase: 'propose', reason: 'Card disappeared from battlefield' };
    }

    const mutations: GameMutation[] = [];

    // Tap the permanent (cost — happens now, cannot be responded to)
    mutations.push({ type: 'TAP_CARD', cardUuid: card.uuid });

    // Find the first pure mana ability on the card
    const manaAbility = card.blueprint.abilities.find(
      a => a.type === 'activated' && ManaPool.isPureAbility(a.effect.effectId)
    );

    if (manaAbility) {
      const params = manaAbility.effect.params as { color: string; amount: number };
      mutations.push({ type: 'ADD_MANA', playerId, color: params.color as ManaColor, amount: params.amount ?? 1 });
    } else {
      // Land fallback: 1 colorless mana
      mutations.push({ type: 'ADD_MANA', playerId, color: 'colorless', amount: 1 });
    }

    return { success: true, mutations };
  },

  resolve(_room: GameRoom, _stackObj: any): ActionResult {
    return { success: true };
  },
};