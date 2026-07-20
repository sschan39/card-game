"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.playCardHandler = void 0;
// src/engine/handlers/play-card-handler.ts
const uuid_1 = require("uuid");
const action_validator_1 = require("../action-validator");
const modifier_registry_1 = require("../modifier-registry");
const modifier_pipeline_1 = require("../modifier-pipeline");
const effect_resolver_1 = require("../effect-resolver");
function findCardInHand(room, playerId, cardUuid) {
    return room.players[playerId].hand.find(c => c.uuid === cardUuid);
}
exports.playCardHandler = {
    validate(room, playerId, action) {
        const card = findCardInHand(room, playerId, action.cardUuid);
        if (!card) {
            return { success: false, phase: 'validate', reason: 'Card not found in hand' };
        }
        if (!modifier_registry_1.ModifierRegistry.canPlay(room, playerId, card)) {
            return { success: false, phase: 'validate', reason: 'A modifier prevents playing this card' };
        }
        if (action.targets && !modifier_registry_1.ModifierRegistry.canTarget(room, playerId, card, action.targets)) {
            return { success: false, phase: 'validate', reason: 'Target is not legal' };
        }
        const modifiedAction = modifier_pipeline_1.ModifierPipeline.apply({ action: 'cast_spell', params: {}, tags: [], targets: action.targets || [] }, room, {});
        const validation = action_validator_1.ActionValidator.canActivate(room, playerId, card, card.castRequirements);
        if (!validation.valid) {
            return { success: false, phase: 'validate', reason: validation.reason || 'Validation failed' };
        }
        return { success: true };
    },
    /**
     * Propose playing a card: pay costs and push to stack.
     *
     * Zone changes performed here (COST zone changes):
     * - Card moves from hand → stack (this is a cost, not an effect)
     *
     * Zone changes NOT performed here (EFFECT/STRUCTURAL zone changes):
     * - stack → battlefield (permanents) — done by applyStructuralZoneChange() in the orchestrator
     * - stack → graveyard (non-permanents) — done by applyStructuralZoneChange() in the orchestrator
     * - Any MOVE_ZONE effects — done by EffectRegistry during resolveEffects()
     *
     * This separation ensures cost zone changes cannot be countered or modified,
     * while effect zone changes go through the full pipeline (modifiers, revalidation).
     */
    propose(room, playerId, action) {
        const card = findCardInHand(room, playerId, action.cardUuid);
        if (!card) {
            return { success: false, phase: 'propose', reason: 'Card not found in hand' };
        }
        const player = room.players[playerId];
        // --- COST PAYMENT (happens now, cannot be responded to) ---
        const cost = card.castRequirements.cost;
        if (cost?.mana) {
            for (const [color, amount] of Object.entries(cost.mana)) {
                player.mana[color] -= amount;
            }
        }
        if (cost?.life) {
            player.life -= cost.life;
        }
        // --- COST ZONE CHANGE: hand → stack ---
        // This is a cost, not an effect. It happens immediately and cannot be
        // countered or modified. The card is now "on the stack" waiting to resolve.
        const handIndex = player.hand.findIndex(c => c.uuid === card.uuid);
        if (handIndex === -1) {
            return { success: false, phase: 'propose', reason: 'Card disappeared from hand' };
        }
        player.hand.splice(handIndex, 1);
        card.state.zone = 'stack';
        // --- BUILD STACK OBJECT (snapshot values locked here) ---
        const onCastEffects = card.onCastEffects;
        const effects = (0, effect_resolver_1.buildStackEffects)(onCastEffects, playerId);
        const stackType = 'spell';
        const stackObj = {
            uuid: (0, uuid_1.v4)(),
            type: stackType,
            controllerId: playerId,
            source: card, // Card lives inside the StackObject while on stack
            effects, // Effects with targets locked at propose time
            timestamp: Date.now(),
            countered: false,
        };
        room.stack.push(stackObj);
        return { success: true, stackObject: stackObj };
    },
    // resolve is handled by the orchestrator (ActionService / GameEngine)
    // via resolveStackObject() which performs structural zone change +
    // effect resolution + PERMANENT_ENTERED emission.
    resolve(_room, _stackObj) {
        return { success: true };
    },
};
