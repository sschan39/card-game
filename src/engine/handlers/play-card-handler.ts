// src/engine/handlers/play-card-handler.ts
import { v4 as uuidv4 } from 'uuid';
import type { ActionHandler, ActionData, ActionResult } from '../action-registry';
import { ActionValidator } from '../action-validator';
import { ModifierRegistry } from '../modifier-registry';
import { ModifierPipeline } from '../modifier-pipeline';
import { EffectRegistry } from '../effect-registry';
import type { GameRoom, PlayerId } from '../../types/game.room.types';
import type { CardInstance } from '../../types/card.types';
import type { StackObject, StackItemType } from '../../types/effect.types';

function findCardInHand(room: GameRoom, playerId: PlayerId, cardUuid: string): CardInstance | undefined {
  return room.players[playerId].hand.find(c => c.uuid === cardUuid);
}

export const playCardHandler: ActionHandler = {
  validate(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult {
    const card = findCardInHand(room, playerId, action.cardUuid);
    if (!card) {
      return { success: false, phase: 'validate', reason: 'Card not found in hand' };
    }

    // 1. Permission checks (stubs)
    if (!ModifierRegistry.canPlay(room, playerId, card)) {
      return { success: false, phase: 'validate', reason: 'A modifier prevents playing this card' };
    }
    if (action.targets && !ModifierRegistry.canTarget(room, playerId, card, action.targets)) {
      return { success: false, phase: 'validate', reason: 'Target is not legal' };
    }

    // 2. Value transformation (stub — identity for now)
    const modifiedAction = ModifierPipeline.apply(action, room, playerId);

    // 3. Standard validation
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

    // Determine stack item type
    const stackType: StackItemType = 'spell';

    // Create StackObject
    const stackObj: StackObject = {
      uuid: uuidv4(),
      type: stackType,
      controllerId: playerId,
      source: card,
      payload: {
        effectId: 'CAST_SPELL',
        params: {},
      },
      targets: action.targets || [],
      timestamp: Date.now(),
    };

    // Push to stack
    room.stack.push(stackObj);

    return { success: true, stackObject: stackObj };
  },

  resolve(room: GameRoom, stackObj: StackObject): ActionResult {
    const handler = EffectRegistry[stackObj.payload.effectId];
    if (!handler) {
      return { success: false, phase: 'resolve', reason: `No handler for effect: ${stackObj.payload.effectId}` };
    }

    handler(room, stackObj);
    return { success: true };
  },
};