"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.playCardHandler = void 0;
// src/engine/handlers/play-card-handler.ts
const uuid_1 = require("uuid");
const action_validator_1 = require("../action-validator");
const modifier_registry_1 = require("../modifier-registry");
const modifier_pipeline_1 = require("../modifier-pipeline");
const effect_registry_1 = require("../effect-registry");
function findCardInHand(room, playerId, cardUuid) {
    return room.players[playerId].hand.find(c => c.uuid === cardUuid);
}
exports.playCardHandler = {
    validate(room, playerId, action) {
        const card = findCardInHand(room, playerId, action.cardUuid);
        if (!card) {
            return { success: false, phase: 'validate', reason: 'Card not found in hand' };
        }
        // 1. Permission checks (stubs)
        if (!modifier_registry_1.ModifierRegistry.canPlay(room, playerId, card)) {
            return { success: false, phase: 'validate', reason: 'A modifier prevents playing this card' };
        }
        if (action.targets && !modifier_registry_1.ModifierRegistry.canTarget(room, playerId, card, action.targets)) {
            return { success: false, phase: 'validate', reason: 'Target is not legal' };
        }
        // 2. Value transformation (stub — identity for now)
        const modifiedAction = modifier_pipeline_1.ModifierPipeline.apply(action, room, playerId);
        // 3. Standard validation
        const validation = action_validator_1.ActionValidator.canActivate(room, playerId, card, card.castRequirements);
        if (!validation.valid) {
            return { success: false, phase: 'validate', reason: validation.reason || 'Validation failed' };
        }
        return { success: true };
    },
    propose(room, playerId, action) {
        const card = findCardInHand(room, playerId, action.cardUuid);
        if (!card) {
            return { success: false, phase: 'propose', reason: 'Card not found in hand' };
        }
        const player = room.players[playerId];
        // Pay costs
        const cost = card.castRequirements.cost;
        if (cost?.mana) {
            for (const [color, amount] of Object.entries(cost.mana)) {
                player.mana[color] -= amount;
            }
        }
        if (cost?.life) {
            player.life -= cost.life;
        }
        // Remove card from hand
        const handIndex = player.hand.findIndex(c => c.uuid === card.uuid);
        if (handIndex === -1) {
            return { success: false, phase: 'propose', reason: 'Card disappeared from hand' };
        }
        player.hand.splice(handIndex, 1);
        // Update card zone
        card.state.zone = 'stack';
        // Determine stack item type
        const stackType = 'spell';
        // Create StackObject
        const stackObj = {
            uuid: (0, uuid_1.v4)(),
            type: stackType,
            controllerId: playerId,
            source: card,
            payload: {
                effectId: 'CAST_SPELL',
                params: {},
            },
            targets: action.targets || [],
            timestamp: Date.now(),
        };
        // Push to stack
        room.stack.push(stackObj);
        return { success: true, stackObject: stackObj };
    },
    resolve(room, stackObj) {
        const handler = effect_registry_1.EffectRegistry[stackObj.payload.effectId];
        if (!handler) {
            return { success: false, phase: 'resolve', reason: `No handler for effect: ${stackObj.payload.effectId}` };
        }
        handler(room, stackObj);
        return { success: true };
    },
};
//# sourceMappingURL=play-card-handler.js.map