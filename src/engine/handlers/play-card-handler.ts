// src/engine/handlers/play-card-handler.ts
import { v4 as uuidv4 } from 'uuid';
import type { ActionHandler, ActionData, ActionResult } from '../action-registry';
import { ActionValidator } from '../action-validator';
import { ModifierRegistry } from '../modifier-registry';
import { ModifierPipeline } from '../modifier-pipeline';
import { resolveEffects } from '../effect-resolver';
import { EventBus } from '../event-bus';
import type { GameRoom, PlayerId } from '../../types/game.room.types';
import type { CardInstance } from '../../types/card.types';
import type { StackObject, StackEffect, StackItemType, EffectDefinition, TargetPointer } from '../../types/effect.types';

function findCardInHand(room: GameRoom, playerId: PlayerId, cardUuid: string): CardInstance | undefined {
  return room.players[playerId].hand.find(c => c.uuid === cardUuid);
}

function buildStackEffects(definitions: EffectDefinition[] | undefined, controllerId: PlayerId): StackEffect[] {
  if (!definitions) return [];
  return definitions.map(def => {
    const targets: TargetPointer[] = [];
    if (def.targeting.type === 'self') {
      targets.push({ targetType: 'player', playerId: controllerId });
    }
    // For effects requiring targets, targets are filled by server-prompted targeting (future)
    return {
      action: def.action,
      params: def.params,
      tags: def.tags || [],
      targets,
    };
  });
}

export const playCardHandler: ActionHandler = {
  validate(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult {
    const card = findCardInHand(room, playerId, action.cardUuid);
    if (!card) {
      return { success: false, phase: 'validate', reason: 'Card not found in hand' };
    }

    if (!ModifierRegistry.canPlay(room, playerId, card)) {
      return { success: false, phase: 'validate', reason: 'A modifier prevents playing this card' };
    }
    if (action.targets && !ModifierRegistry.canTarget(room, playerId, card, action.targets as any)) {
      return { success: false, phase: 'validate', reason: 'Target is not legal' };
    }

    const modifiedAction = ModifierPipeline.apply(
      { action: 'cast_spell', params: {}, tags: [], targets: (action.targets as any) || [] },
      room,
      {} as StackObject
    );

    const validation = ActionValidator.canActivate(room, playerId, card, card.castRequirements);
    if (!validation.valid) {
      return { success: false, phase: 'validate', reason: validation.reason || 'Validation failed' };
    }

    return { success: true };
  },

  propose(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult {
    const card = findCardInHand(room, playerId, action.cardUuid);
    if (!card) {
      return { success: false, phase: 'propose', reason: 'Card not found in hand' };
    }

    const player = room.players[playerId];

    // Pay costs
    const cost = card.castRequirements.cost;
    if (cost?.mana) {
      for (const [color, amount] of Object.entries(cost.mana)) {
        player.mana[color as keyof typeof player.mana] -= amount;
      }
    }
    if (cost?.life) {
      player.life -= cost.life;
    }

    // Remove card from hand
    const handIndex = player.hand.findIndex(c => c.uuid === card.uuid);
    if (handIndex === -1) {
      return { success: false, phase: 'propose', reason: 'Card disappeared from hand' };
    }
    player.hand.splice(handIndex, 1);

    // Update card zone
    card.state.zone = 'stack';

    // Build effects from card definition
    const onCastEffects = (card as any).onCastEffects as EffectDefinition[] | undefined;
    const effects = buildStackEffects(onCastEffects, playerId);

    const stackType: StackItemType = 'spell';

    const stackObj: StackObject = {
      uuid: uuidv4(),
      type: stackType,
      controllerId: playerId,
      source: card,
      effects,
      timestamp: Date.now(),
      countered: false,
    };

    room.stack.push(stackObj);

    return { success: true, stackObject: stackObj };
  },

  resolve(room: GameRoom, stackObj: StackObject): ActionResult {
    // Effect resolution only — structural zone change is handled by the orchestrator
    // (ActionService.resolveTopOfStack or GameEngine.resolveTopOfStack).
    // The orchestrator also emits PERMANENT_ENTERED after zone change.
    resolveEffects(room, stackObj, new EventBus(room.roomId));
    return { success: true };
  },
};