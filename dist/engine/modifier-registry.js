"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModifierRegistry = void 0;
/**
 * ModifierRegistry — stub for permission-check modifiers.
 *
 * Future: scans all permanents, emblems, and continuous effects for
 * restrictions like "can't play creatures", hexproof, shroud, etc.
 * Currently all checks pass through (no restrictions).
 */
class ModifierRegistry {
    /**
     * Check if a card can be played. Stub — always returns true.
     * Future: checks for "can't cast spells", "can't play creatures", etc.
     */
    static canPlay(room, playerId, card) {
        console.log(`[ModifierRegistry] canPlay: ${card.name} by ${playerId} — allowed (stub)`);
        void room;
        return true;
    }
    /**
     * Check if targets are legal. Stub — always returns true.
     * Future: checks hexproof, shroud, protection, etc.
     */
    static canTarget(room, playerId, card, targets) {
        console.log(`[ModifierRegistry] canTarget: ${targets.length} targets for ${card.name} — allowed (stub)`);
        void room;
        void playerId;
        return true;
    }
}
exports.ModifierRegistry = ModifierRegistry;
