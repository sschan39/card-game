// src/engine/handlers/play-card-handler.ts
import { v4 as uuidv4 } from 'uuid';
import type { ActionHandler, ActionData, ActionResult } from '../action-registry';
import { ActionValidator } from '../action-validator';
import { ModifierRegistry } from '../modifier-registry';
import { ModifierPipeline } from '../modifier-pipeline';
import { buildStackEffects } from '../effect-resolver';
import type { GameRoom, PlayerId } from '../../types/game.room.types';
import type { CardInstance } from '../../types/card.types';
import type { StackObject, StackEffect, StackItemType, TargetPointer } from '../../types/effect.types';

function findCardInHand(room: GameRoom, playerId: PlayerId, cardUuid: string): CardInstance | undefined {
  return room.players[playerId].hand.find(c => c.uuid === cardUuid);
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

    const validation = ActionValidator.canActivate(room, playerId, card, card.blueprint.castRequirements);
    if (!validation.valid) {
      return { success: false, phase: 'validate', reason: validation.reason || 'Validation failed' };
    }

    return { success: true };
  },

  /**
   * Propose playing a card: pay costs and push to stack.
   *
   * Zone changes performed here (COST zone changes):
   * - Card moves from hand → stack (this is a cost, not an effect)
   *
   * Zone changes NOT performed here (EFFECT/STRUCTURAL zone changes):
   * - stack → battlefield (permanents) — done by applyStructuralZoneChange() in the orchestrator
   * - stack → graveyard (non-permanents) — done by applyStructuralZoneChange() in the orchestrator
   * - Any MOVE_ZONE effects — done by EffectRegistry during resolveEffects()
   *
   * This separation ensures cost zone changes cannot be countered or modified,
   * while effect zone changes go through the full pipeline (modifiers, revalidation).
   */
  propose(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult {
    const card = findCardInHand(room, playerId, action.cardUuid);
    if (!card) {
      return { success: false, phase: 'propose', reason: 'Card not found in hand' };
    }

    const player = room.players[playerId];

    // --- COST PAYMENT (happens now, cannot be responded to) ---
    const cost = card.blueprint.castRequirements.cost;
    if (cost?.mana) {
      for (const [color, amount] of Object.entries(cost.mana)) {
        player.mana[color as keyof typeof player.mana] -= amount;
      }
    }
    if (cost?.life) {
      player.life -= cost.life;
    }

    // --- COST ZONE CHANGE: hand → stack ---
    // This is a cost, not an effect. It happens immediately and cannot be
    // countered or modified. The card is now "on the stack" waiting to resolve.
    const handIndex = player.hand.findIndex(c => c.uuid === card.uuid);
    if (handIndex === -1) {
      return { success: false, phase: 'propose', reason: 'Card disappeared from hand' };
    }
    player.hand.splice(handIndex, 1);
    card.state.zone = 'stack';

    // --- BUILD STACK OBJECT (snapshot values locked here) ---
    const onCastEffects = card.blueprint.onCastEffects;
    const effects = buildStackEffects(onCastEffects, playerId);

    const stackType: StackItemType = 'spell';

    const stackObj: StackObject = {
      uuid: uuidv4(),
      type: stackType,
      controllerId: playerId,
      source: card,              // Card lives inside the StackObject while on stack
      effects,                   // Effects with targets locked at propose time
      timestamp: Date.now(),
      countered: false,
    };

    room.stack.push(stackObj);

    return { success: true, stackObject: stackObj };
  },

  // resolve is handled by the orchestrator (ActionService / GameEngine)
  // via resolveStackObject() which performs structural zone change +
  // effect resolution + PERMANENT_ENTERED emission.
  resolve(_room: GameRoom, _stackObj: StackObject): ActionResult {
    return { success: true };
  },
};