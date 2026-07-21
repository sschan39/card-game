// src/engine/modifier-registry.ts
import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { CardInstance } from '../types/card.types';
import type { TargetPointer } from '../types/effect.types';

/**
 * ModifierRegistry — stub for permission-check modifiers.
 *
 * Future: scans all permanents, emblems, and continuous effects for
 * restrictions like "can't play creatures", hexproof, shroud, etc.
 * Currently all checks pass through (no restrictions).
 */
export class ModifierRegistry {
  /**
   * Check if a card can be played. Stub — always returns true.
   * Future: checks for "can't cast spells", "can't play creatures", etc.
   */
  static canPlay(room: GameRoom, playerId: PlayerId, card: CardInstance): boolean {
    console.log(`[ModifierRegistry] canPlay: ${card.blueprint.name} by ${playerId} — allowed (stub)`);
    void room;
    return true;
  }

  /**
   * Check if targets are legal. Stub — always returns true.
   * Future: checks hexproof, shroud, protection, etc.
   */
  static canTarget(
    room: GameRoom,
    playerId: PlayerId,
    card: CardInstance,
    targets: TargetPointer[]
  ): boolean {
    console.log(`[ModifierRegistry] canTarget: ${targets.length} targets for ${card.blueprint.name} — allowed (stub)`);
    void room;
    void playerId;
    return true;
  }
}