// src/engine/handlers/play-card-handler.ts
import type { ActionHandler, ActionData, ActionResult } from '../action-registry';
import { ActionValidator } from '../action-validator';
import { ModifierRegistry } from '../modifier-registry';
import { buildStackEffects } from '../effect-resolver';
import { ManaPool } from '../mana-pool';
import type { GameMutation } from '../../types/game-mutation.types';
import type { GameRoom, PlayerId } from '../../types/game.room.types';
import type { CardInstance } from '../../types/card.types';
import type { StackObject, StackEffect, StackItemType, TargetPointer } from '../../types/effect.types';

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

    if (!ModifierRegistry.canPlay(room, playerId, card)) {
      return { success: false, phase: 'validate', reason: 'A modifier prevents playing this card' };
    }
    if (action.targets && !ModifierRegistry.canTarget(room, playerId, card, action.targets as any)) {
      return { success: false, phase: 'validate', reason: 'Target is not legal' };
    }

    // Structural target legality (CR 601.2c): if the card has an effect that
    // requires explicit targets, validate the chosen targets against its
    // targeting definition. Pure — safe to re-evaluate mid-flight.
    const targetingDef = (card.blueprint.onCastEffects || []).find(
      e => e.targeting && e.targeting.type !== 'self' && !e.targeting.all
    )?.targeting;
    if (targetingDef && !ActionValidator.canTarget(room, playerId, card, (action.targets as TargetPointer[]) || [], targetingDef)) {
      return { success: false, phase: 'validate', reason: 'Target is not legal' };
    }

    const validation = ActionValidator.canActivate(room, playerId, card, card.blueprint.castRequirements);
    if (!validation.valid) {
      return { success: false, phase: 'validate', reason: validation.reason || 'Validation failed' };
    }

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

    const player = room.players[playerId];
    const mutations: GameMutation[] = [];

    // --- COST PAYMENT (happens now, cannot be responded to) ---
    const cost = card.blueprint.castRequirements.cost;
    if (cost?.mana) {
      mutations.push({ type: 'SPEND_MANA', playerId, cost: cost.mana });
    }
    if (cost?.life) {
      mutations.push({ type: 'SET_LIFE', playerId, amount: player.life - cost.life });
    }

    // --- COST ZONE CHANGE: hand → stack ---
    mutations.push({
      type: 'MOVE_CARD',
      cardUuid: card.uuid,
      playerId: card.state.ownerId,
      from: 'hand',
      to: 'stack',
    });

    // --- BUILD STACK OBJECT (snapshot values locked here) ---
    const onCastEffects = card.blueprint.onCastEffects;
    const effects = buildStackEffects(onCastEffects, playerId);

    // Merge client-chosen targets into explicit-target effects.
    // `action.targets` is the ordered list of TargetPointers the client selected.
    // Each effect that requires explicit targets consumes a slice of that list,
    // capped at its `maxTargets`. Self/all effects keep their auto-filled targets.
    const clientTargets: TargetPointer[] = (action.targets as TargetPointer[]) || [];
    let targetCursor = 0;
    for (const effect of effects) {
      const def = effect.targeting;
      if (!def || def.type === 'self' || def.all) continue;
      const max = def.maxTargets ?? clientTargets.length;
      const slice = clientTargets.slice(targetCursor, targetCursor + max);
      if (slice.length > 0) {
        effect.targets = slice;
        targetCursor += slice.length;
      }
    }

    const stackType: StackItemType = 'spell';

    // Create a zone-updated copy of the card for the stack object source.
    // The MOVE_CARD mutation will also update the zone via the reducer,
    // but the stackObject.source needs the correct zone immediately.
    const stackCard: CardInstance = {
      ...card,
      state: { ...card.state, zone: 'stack' as const },
    };

    const stackObj: StackObject = {
      uuid: (action.stackUuid as string) || '',
      type: stackType,
      controllerId: playerId,
      source: stackCard,
      effects,
      countered: false,
    };

    mutations.push({ type: 'PUSH_STACK', stackObject: stackObj });

    return { success: true, stackObject: stackObj, mutations };
  },

  // resolve is handled by the orchestrator (ActionService / GameEngine)
  // via resolveStackObject() which performs structural zone change +
  // effect resolution + PERMANENT_ENTERED emission.
  resolve(_room: GameRoom, _stackObj: StackObject): ActionResult {
    return { success: true };
  },
};