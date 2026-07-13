"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OptionService = void 0;
// src/engine/option-service.ts
const action_validator_1 = require("./action-validator");
class OptionService {
    getOptions(room, playerId, cardUuid, zone) {
        const card = this.findCard(room, playerId, cardUuid, zone);
        if (!card)
            return [];
        if (zone === 'hand') {
            return this.getHandOptions(room, playerId, card);
        }
        return this.getBattlefieldOptions(room, playerId, card);
    }
    findCard(room, playerId, cardUuid, zone) {
        if (zone === 'hand') {
            return room.players[playerId].hand.find(c => c.uuid === cardUuid);
        }
        return room.battlefield.find(c => c.uuid === cardUuid && c.state.controllerId === playerId);
    }
    getHandOptions(room, playerId, card) {
        const options = [];
        const canPlay = action_validator_1.ActionValidator.canActivate(room, playerId, card, card.castRequirements);
        options.push({
            actionId: 'playCardAction',
            label: 'Play Card',
            disabled: !canPlay.valid,
            disabledReason: canPlay.valid ? undefined : canPlay.reason,
        });
        return options;
    }
    getBattlefieldOptions(room, playerId, card) {
        const options = [];
        // Tap for mana (lands)
        if (card.cardTypes.includes('Land')) {
            const canTap = !card.state.isTapped && !card.state.summoningSickness;
            options.push({
                actionId: 'tapForManaAction',
                label: 'Tap for Mana',
                disabled: !canTap,
                disabledReason: card.state.isTapped ? 'Already tapped' : undefined,
            });
        }
        // Activated abilities from card definition
        for (const ability of card.abilities) {
            if (ability.type === 'activated') {
                const canActivate = action_validator_1.ActionValidator.canActivate(room, playerId, card, {
                    allowedZones: ['battlefield'],
                    speed: ability.castSpeed,
                    cost: ability.cost,
                });
                options.push({
                    actionId: `activateAbility_${ability.effect.effectId}`,
                    label: `Activate: ${ability.effect.effectId}`,
                    disabled: !canActivate.valid,
                    disabledReason: canActivate.valid ? undefined : canActivate.reason,
                });
            }
        }
        return options;
    }
}
exports.OptionService = OptionService;
//# sourceMappingURL=option-service.js.map