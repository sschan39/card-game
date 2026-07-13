// src/engine/effect-resolver.ts
import { EffectRegistry } from './effect-registry';
import { ModifierPipeline } from './modifier-pipeline';
import { EventBus } from './event-bus';
import type { GameRoom } from '../types/game.room.types';
import type { StackObject, StackEffect, EffectDefinition, TargetPointer } from '../types/effect.types';
import type { CardInstance } from '../types/card.types';

/**
 * Convert card definition effects into StackEffects with auto-filled self-targets.
 * Used by both playCardHandler (onCastEffects) and TriggerManager (onEnterEffects).
 */
export function buildStackEffects(
  definitions: EffectDefinition[] | undefined,
  controllerId: string
): StackEffect[] {
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

function isPermanent(card: CardInstance): boolean {
  return card.cardTypes.some(type =>
    ['Creature', 'Artifact', 'Enchantment', 'Land'].includes(type)
  );
}

/**
 * Perform the structural zone change for a resolving StackObject.
 * This is a game rule, not an effect — permanents enter the battlefield,
 * non-permanents go to the graveyard. Countered spells go to graveyard
 * regardless of type.
 *
 * Returns the card after zone change (for PERMANENT_ENTERED emission).
 */
export function applyStructuralZoneChange(room: GameRoom, stackObj: StackObject): CardInstance {
  const card = stackObj.source as CardInstance;

  if (stackObj.countered) {
    card.state.zone = 'graveyard';
    const ownerId = card.state.controllerId || card.state.ownerId;
    room.players[ownerId]?.graveyard.push(card);
  } else if (isPermanent(card)) {
    card.state.zone = 'battlefield';
    card.state.isTapped = false;
    if (card.cardTypes.includes('Creature')) {
      card.state.summoningSickness = true;
    }
    room.battlefield.push(card);
  } else {
    card.state.zone = 'graveyard';
    const ownerId = card.state.controllerId || card.state.ownerId;
    room.players[ownerId]?.graveyard.push(card);
  }

  return card;
}

/**
 * Resolve all effects on a StackObject by dispatching each to the EffectRegistry.
 * Skips resolution if the stack object is countered.
 * Emits STACK_ITEM_RESOLVED after each effect.
 */
export function resolveEffects(room: GameRoom, stackObj: StackObject, eventBus: EventBus): void {
  if (stackObj.countered) return;

  for (const effect of stackObj.effects) {
    const handler = EffectRegistry[effect.action];
    if (handler) {
      ModifierPipeline.apply(effect, room, stackObj);
      handler(room, stackObj, effect);
    }
    eventBus.emit({
      eventId: 'STACK_ITEM_RESOLVED',
      roomId: room.roomId,
      payload: { effectId: effect.action, stackObj },
    });
  }
}

/**
 * Full resolution of a single StackObject: structural zone change,
 * effect execution, and post-resolution events (PERMANENT_ENTERED, STACK_RESOLVED).
 * Used by both ActionService and GameEngine to avoid duplicated logic.
 */
export function resolveStackObject(room: GameRoom, stackObj: StackObject, eventBus: EventBus): void {
  const card = applyStructuralZoneChange(room, stackObj);

  // Resolve effects via shared resolver
  resolveEffects(room, stackObj, eventBus);

  // Emit PERMANENT_ENTERED for permanents (triggers ETB via TriggerManager)
  if (!stackObj.countered && isPermanent(card)) {
    eventBus.emit({
      eventId: 'PERMANENT_ENTERED',
      roomId: room.roomId,
      payload: { card, controllerId: stackObj.controllerId },
    });
  }

  eventBus.emit({
    eventId: 'STACK_RESOLVED',
    roomId: room.roomId,
    payload: { effectId: stackObj.effects[0]?.action || 'structural' },
  });
}