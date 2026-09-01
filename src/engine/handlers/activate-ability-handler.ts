// src/engine/handlers/activate-ability-handler.ts
//
// Generic non-mana activated-ability handler. Lets any battlefield permanent
// with an `activated` ability (other than a pure mana ability, which is instead
// served by tapForManaHandler) be activated: pay the cost (mana / life / tap),
// put an `activated` StackObject on the stack, and resolve its effect through
// the normal effect pipeline.
//
// Ability selection: the action carries `abilityIndex`, the 0-based index of
// the desired ability among the card's *activated* abilities (in blueprint
// order). Falls back to the first activated ability when omitted.
//
// The source permanent stays on the battlefield; resolution relies on the
// round-13 POP_STACK fallback in effect-resolver to pop the StackObject off
// the stack (its source is not MOVE_CARDed out of the stack zone).

import type { ActionHandler, ActionData, ActionResult } from '../action-registry';
import { ActionValidator } from '../action-validator';
import type { GameMutation } from '../../types/game-mutation.types';
import type { GameRoom, PlayerId } from '../../types/game.room.types';
import type { CardInstance, ManaColor, ActivatedAbility } from '../../types/card.types';
import type { StackObject, StackEffect } from '../../types/effect.types';

function findCardOnBattlefield(room: GameRoom, playerId: PlayerId, cardUuid: string): CardInstance | undefined {
  return room.battlefield.find(c => c.uuid === cardUuid && c.state.controllerId === playerId);
}

/** The card's activated abilities that are NOT pure mana producers. */
function nonManaActivatedAbilities(card: CardInstance): ActivatedAbility[] {
  return card.blueprint.abilities.filter(
    (a): a is ActivatedAbility => a.type === 'activated' && a.effect.effectId !== 'ADD_MANA'
  );
}

function pickAbility(card: CardInstance, action: ActionData): ActivatedAbility | undefined {
  const abilities = nonManaActivatedAbilities(card);
  if (abilities.length === 0) return undefined;
  const index = typeof action.abilityIndex === 'number' ? action.abilityIndex : 0;
  return abilities[index] ?? undefined;
}

/** Build a StackEffect from an activated ability (self-targeted, like triggers). */
function abilityToStackEffect(ability: ActivatedAbility, controllerId: string): StackEffect {
  return {
    action: ability.effect.effectId,
    params: ability.effect.params ?? {},
    tags: [],
    targets: [{ targetType: 'player', playerId: controllerId }],
  };
}

export const activateAbilityHandler: ActionHandler = {
  validate(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult {
    if (!action.cardUuid) {
      return { success: false, phase: 'validate', reason: 'cardUuid is required' };
    }
    const card = findCardOnBattlefield(room, playerId, action.cardUuid);
    if (!card) {
      return { success: false, phase: 'validate', reason: 'Card not found on your battlefield' };
    }

    const ability = pickAbility(card, action);
    if (!ability) {
      return { success: false, phase: 'validate', reason: 'Card has no non-mana activated ability' };
    }

    const validation = ActionValidator.canActivate(room, playerId, card, {
      allowedZones: ['battlefield'],
      speed: ability.castSpeed,
      cost: ability.cost,
    });
    if (!validation.valid) {
      return { success: false, phase: 'validate', reason: validation.reason || 'Validation failed' };
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

    const ability = pickAbility(card, action);
    if (!ability) {
      return { success: false, phase: 'propose', reason: 'Card has no non-mana activated ability' };
    }

    const player = room.players[playerId];
    const mutations: GameMutation[] = [];

    // --- COST PAYMENT (happens now, cannot be responded to) ---
    const cost = ability.cost;
    if (cost?.mana) {
      mutations.push({ type: 'SPEND_MANA', playerId, cost: cost.mana });
    }
    if (cost?.life) {
      mutations.push({ type: 'SET_LIFE', playerId, amount: player.life - cost.life });
    }
    if (cost?.tap) {
      // tap cost: cannot be paid if already tapped (validated in canPayCost)
      mutations.push({ type: 'TAP_CARD', cardUuid: card.uuid });
    }
    if (cost?.discard) {
      // Discard cost: move the top N cards of the player's hand to the graveyard.
      for (const cardToDiscard of [...player.hand].slice(0, cost.discard)) {
        mutations.push({
          type: 'MOVE_CARD',
          cardUuid: cardToDiscard.uuid,
          playerId: playerId,
          from: 'hand',
          to: 'graveyard',
        });
      }
    }

    // --- BUILD STACK OBJECT (snapshot values locked here) ---
    const stackObj: StackObject = {
      uuid: (action.stackUuid as string) || '',
      type: 'activated',
      controllerId: playerId,
      source: card, // remains a battlefield permanent; not re-entered on resolution
      effects: [abilityToStackEffect(ability, playerId)],
      countered: false,
    };

    mutations.push({ type: 'PUSH_STACK', stackObject: stackObj });

    return { success: true, stackObject: stackObj, mutations };
  },

  resolve(_room: GameRoom, _stackObj: any): ActionResult {
    return { success: true };
  },
};