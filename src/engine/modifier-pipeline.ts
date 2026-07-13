// src/engine/modifier-pipeline.ts
import type { GameRoom } from '../types/game.room.types';
import type { StackObject, StackEffect } from '../types/effect.types';

/**
 * ModifierPipeline — stub for value-transformation modifiers.
 *
 * Future: chains cost reducers, flash granters, target modifiers, etc.
 * Each modifier is a pure function: StackEffect → StackEffect.
 * Currently returns the effect unchanged (identity transform).
 */
export class ModifierPipeline {
  static apply(effect: StackEffect, _room: GameRoom, _stackObj: StackObject): StackEffect {
    // _room and _stackObj are reserved for future modifier context
    // (cost reducers, flash granters, target modifiers, etc.)
    return effect;
  }
}