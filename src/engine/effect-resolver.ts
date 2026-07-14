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

/**
 * Re-validate targets at resolve time. Filters out targets that are no longer
 * legal (e.g., a creature that was bounced back to hand after the spell was cast).
 *
 * Validation rules:
 * - 'permanent' / 'card' targets: must exist on the battlefield (by cardUuid)
 * - 'player' targets: must exist in room.players
 * - 'stack' targets: must still be on the stack (by stackUuid)
 * - 'self' targets: always valid (controller always exists)
 *
 * Returns a new StackEffect with only the valid targets. If all targets are
 * removed and the effect required targets, the effect is marked with an empty
 * targets array — the EffectRegistry handler will simply do nothing.
 */
export function revalidateTargets(room: GameRoom, effect: StackEffect): StackEffect {
  const validTargets = effect.targets.filter(target => {
    switch (target.targetType) {
      case 'permanent':
      case 'card': {
        if (!target.cardUuid) return false;
        return room.battlefield.some(c => c.uuid === target.cardUuid);
      }
      case 'player': {
        if (!target.playerId) return false;
        return target.playerId in room.players;
      }
      case 'stack': {
        if (!target.stackUuid) return false;
        return room.stack.some(s => s.uuid === target.stackUuid);
      }
      case 'self': {
        // Self always resolves to the controller — always valid
        return true;
      }
      default:
        return false;
    }
  });

  return {
    ...effect,
    targets: validTargets,
  };
}

/**
 * Compute dynamic parameter values at resolve time.
 *
 * Dynamic markers in params are strings prefixed with 'DYNAMIC:':
 * - 'DYNAMIC:source.power' → stackObj.source.power (current power at resolve time)
 * - 'DYNAMIC:source.toughness' → stackObj.source.toughness
 * - 'DYNAMIC:target.power' → first target's current power
 *
 * Non-dynamic params are left as-is. The result is merged into effect.dynamicParams
 * so EffectRegistry handlers can use `effect.dynamicParams?.power ?? effect.params.power`.
 */
export function buildDynamicParams(
  room: GameRoom,
  stackObj: StackObject,
  effect: StackEffect
): Record<string, unknown> {
  const dynamic: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(effect.params)) {
    if (typeof value !== 'string' || !value.startsWith('DYNAMIC:')) continue;

    const path = value.slice('DYNAMIC:'.length);

    if (path === 'source.power') {
      dynamic[key] = (stackObj.source as any)?.power;
    } else if (path === 'source.toughness') {
      dynamic[key] = (stackObj.source as any)?.toughness;
    } else if (path === 'target.power') {
      const firstTarget = effect.targets[0];
      if (firstTarget?.cardUuid) {
        const card = room.battlefield.find(c => c.uuid === firstTarget.cardUuid);
        dynamic[key] = card?.power;
      }
    } else if (path === 'target.toughness') {
      const firstTarget = effect.targets[0];
      if (firstTarget?.cardUuid) {
        const card = room.battlefield.find(c => c.uuid === firstTarget.cardUuid);
        dynamic[key] = card?.toughness;
      }
    }
  }

  return dynamic;
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