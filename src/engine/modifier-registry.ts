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
    void room;
    void playerId;
    void card;
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
    void room;
    void playerId;
    void card;
    void targets;
    return true;
  }
}