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
  static apply(effect: StackEffect, room: GameRoom, stackObj: StackObject): StackEffect {
    void room;
    void stackObj;
    return effect;
  }
}