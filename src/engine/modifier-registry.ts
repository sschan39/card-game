// src/engine/modifier-registry.ts
import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { CardInstance } from '../types/card.types';
import type { TargetPointer } from '../types/effect.types';
import { targetPermissionsAllow } from '../shared/target-legality';
import { actionPermission } from '../shared/action-permissions';

/**
 * Permission checks shared across announcement and resolution.
 * Target rules extend built-in keyword permissions; play restrictions remain a hook.
 */
export class ModifierRegistry {
  private static targetRules = new Set<(room: GameRoom, playerId: PlayerId, source: CardInstance, target: TargetPointer) => boolean>();

  static registerTargetRule(rule: (room: GameRoom, playerId: PlayerId, source: CardInstance, target: TargetPointer) => boolean): () => void {
    this.targetRules.add(rule);
    return () => { this.targetRules.delete(rule); };
  }
  /**
   * Check if a card can be played. Stub — always returns true.
   * Future: checks for "can't cast spells", "can't play creatures", etc.
   */
  static canPlay(room: GameRoom, playerId: PlayerId, card: CardInstance): boolean {
    return actionPermission(room, playerId, card, 'cast').allowed;
  }

  /**
   * Check keyword permissions and registered restrictions against live state.
   */
  static canTarget(
    room: GameRoom,
    playerId: PlayerId,
    card: CardInstance,
    targets: TargetPointer[]
  ): boolean {
    return targets.every(target => targetPermissionsAllow(room, playerId, card, target) &&
      [...this.targetRules].every(rule => rule(room, playerId, card, target)));
  }
}
