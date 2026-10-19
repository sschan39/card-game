import { CardCharacteristicService } from '../card-characteristic-service';
// src/engine/handlers/play-card-handler.ts
import type { ActionHandler, ActionData, ActionResult } from '../action-registry';
import { ActionValidator } from '../action-validator';
import { ModifierRegistry } from '../modifier-registry';
import { buildStackEffects } from '../effect-resolver';
import { planActionCosts } from '../action-costs';
import { resetCardForZone } from '../zone-transitions';
import type { GameMutation } from '../../types/game-mutation.types';
import type { GameRoom, PlayerId } from '../../types/game.room.types';
import type { CardInstance } from '../../types/card.types';
import type { StackObject, StackItemType } from '../../types/effect.types';
import { planTargetGroups } from '../target-groups';
import { selectModeEffects } from '../../shared/action-modes';
import { planAnnouncedDistributions } from '../announced-distributions';
import { prepareAnnouncement, spellAnnouncementDefinition } from '../announcement-values';

function findCardInHand(room: GameRoom, playerId: PlayerId, cardUuid: string): CardInstance | undefined {
  return room.players[playerId].hand.find(c => c.uuid === cardUuid);
}

export const playCardHandler: ActionHandler = {
  validate(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult {
    if (!action.cardUuid) {
      return { success: false, phase: 'validate', reason: 'cardUuid is required' };
    }
    const card = findCardInHand(room, playerId, action.cardUuid);
    if (!card) {
      return { success: false, phase: 'validate', reason: 'Card not found in hand' };
    }

    if (CardCharacteristicService.resolveTypes(room, card).includes('Land')) return { success: false, phase: 'validate', reason: 'Lands are played directly, not cast as spells' };
    if (!ModifierRegistry.canPlay(room, playerId, card)) {
      return { success: false, phase: 'validate', reason: 'A modifier prevents playing this card' };
    }
    const announcement = prepareAnnouncement(card, spellAnnouncementDefinition(CardCharacteristicService.resolveBlueprint(room, card)), action);
    if (!announcement.success) return { success: false, phase: 'validate', reason: announcement.reason };
    if (announcement.missing) return { success: false, phase: 'validate', reason: 'Choose all declared numbers' };
    if (announcement.missingCostRoute) return { success: false, phase: 'validate', reason: 'Choose a cost route' };
    const effects = selectModeEffects(CardCharacteristicService.resolveBlueprint(room, card).onCastEffects ?? [], CardCharacteristicService.resolveBlueprint(room, card).modes, action.modes, CardCharacteristicService.resolveBlueprint(room, card).modeCount, { room, playerId });
    if (!effects) return { success: false, phase: 'validate', reason: 'Select valid modes' };
    const targets = planTargetGroups(room, playerId, card, buildStackEffects(effects, playerId, card), action);
    if (!targets.success) return { ...targets, phase: 'validate' };
    const distributions = planAnnouncedDistributions(targets.effects, action);
    if (!distributions.success) return { ...distributions, phase: 'validate' };

    const validation = ActionValidator.canActivate(room, playerId, card, { ...CardCharacteristicService.resolveBlueprint(room, card).castRequirements, cost: undefined });
    if (!validation.valid) {
      return { success: false, phase: 'validate', reason: validation.reason || 'Validation failed' };
    }

    const costs = planActionCosts(room, playerId, card, announcement.cost, action);
    if (!costs.success) return { success: false, phase: 'validate', reason: costs.reason };
    return { success: true };
  },

  /**
   * Propose playing a card: pay costs and push to stack.
   * Returns mutations instead of mutating room directly.
   *
   * Cost zone changes (hand → stack) happen via MOVE_CARD mutation.
   * The StackObject is built with a caller-supplied UUID (from actionData.stackUuid).
   */
  propose(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult {
    if (!action.cardUuid) {
      return { success: false, phase: 'propose', reason: 'cardUuid is required' };
    }
    const card = findCardInHand(room, playerId, action.cardUuid);
    if (!card) {
      return { success: false, phase: 'propose', reason: 'Card not found in hand' };
    }
    if (CardCharacteristicService.resolveTypes(room, card).includes('Land')) return { success: false, phase: 'propose', reason: 'Lands are played directly, not cast as spells' };

    const announcement = prepareAnnouncement(card, spellAnnouncementDefinition(CardCharacteristicService.resolveBlueprint(room, card)), action);
    if (!announcement.success) return { success: false, phase: 'propose', reason: announcement.reason };
    if (announcement.missing) return { success: false, phase: 'propose', reason: 'Choose all declared numbers' };
    if (announcement.missingCostRoute) return { success: false, phase: 'propose', reason: 'Choose a cost route' };
    const costs = planActionCosts(room, playerId, card, announcement.cost, action);
    if (!costs.success) return { success: false, phase: 'propose', reason: costs.reason };
    const mutations: GameMutation[] = [...costs.mutations];

    // --- BUILD STACK OBJECT (snapshot values locked here) ---
    const onCastEffects = selectModeEffects(CardCharacteristicService.resolveBlueprint(room, card).onCastEffects ?? [], CardCharacteristicService.resolveBlueprint(room, card).modes, action.modes, CardCharacteristicService.resolveBlueprint(room, card).modeCount, { room, playerId });
    if (!onCastEffects) return { success: false, phase: 'propose', reason: 'Select valid modes' };
    const targets = planTargetGroups(room, playerId, card, buildStackEffects(onCastEffects, playerId, card), action);
    if (!targets.success) return { ...targets, phase: 'propose' };
    const distributions = planAnnouncedDistributions(targets.effects, action);
    if (!distributions.success) return { ...distributions, phase: 'propose' };
    const effects = distributions.effects;

    const stackType: StackItemType = 'spell';

    // Preview the same reset state the atomic MOVE_CARD applies to its source.
    const stackCard = resetCardForZone(card, 'stack', playerId);

    const stackObj: Extract<StackObject, { type: 'spell' }> = {
      uuid: (action.stackUuid as string) || '',
      type: stackType,
      controllerId: playerId,
      source: stackCard,
      effects,
      targetGroups: targets.groups,
      countered: false,
      ...(Object.keys(announcement.bindings).length ? { numericBindings: announcement.bindings } : {}),
    };

    mutations.push({ type: 'MOVE_CARD', cardUuid: card.uuid, playerId: card.state.ownerId,
      from: 'hand', to: 'stack', stackObject: stackObj, reason: 'cast' });

    return { success: true, stackObject: stackObj, mutations };
  },

  // resolve is handled by the orchestrator (ActionService / GameEngine)
  // via resolveStackObject() which performs structural zone change +
  // effect resolution + PERMANENT_ENTERED emission.
  resolve(_room: GameRoom, _stackObj: StackObject): ActionResult {
    return { success: true };
  },
};
