// src/engine/effect-resolver.ts
import { EffectRegistry } from './effect-registry';
import { ModifierPipeline } from './modifier-pipeline';
import { EventBus } from './event-bus';
import type { GameRoom } from '../types/game.room.types';
import type { StackObject } from '../types/effect.types';

/**
 * Iterate all effects in a StackObject, run each through ModifierPipeline,
 * call the appropriate EffectRegistry handler, then emit STACK_ITEM_RESOLVED.
 * If the stack object is countered, effects are skipped entirely.
 */
export function resolveEffects(room: GameRoom, stackObj: StackObject, eventBus: EventBus): void {
  if (stackObj.countered) {
    // Countered spells don't resolve their effects
    eventBus.emit({
      eventId: 'STACK_ITEM_RESOLVED',
      roomId: room.roomId,
      payload: { stackObj },
    });
    return;
  }

  for (const effect of stackObj.effects) {
    const transformed = ModifierPipeline.apply(effect, room, stackObj);
    const handler = EffectRegistry[transformed.action];
    if (handler) {
      handler(room, stackObj, transformed);
    }
  }

  eventBus.emit({
    eventId: 'STACK_ITEM_RESOLVED',
    roomId: room.roomId,
    payload: { stackObj },
  });
}