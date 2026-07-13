"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EffectRegistry = void 0;
exports.EffectRegistry = {
    /**
     * Resolves a permanent or spell moving from the stack to its final destination.
     */
    'CAST_SPELL': (room, stackObj) => {
        const { source, controllerId } = stackObj;
        const player = room.players[controllerId];
        const isPermanent = source.cardTypes.some(type => ['Creature', 'Artifact', 'Enchantment', 'Land'].includes(type));
        if (isPermanent) {
            // Move to battlefield
            source.state.zone = 'battlefield';
            source.state.isTapped = false;
            // Apply summoning sickness if it's a creature
            if (source.cardTypes.includes('Creature')) {
                source.state.summoningSickness = true;
            }
            room.battlefield.push(source);
        }
        else {
            // Instants and Sorceries go straight to the graveyard after resolving
            source.state.zone = 'graveyard';
            player.graveyard.push(source);
        }
        // Note: If the spell has an ETB (Enters the Battlefield) or spell effect, 
        // you would push a new triggered ability onto the stack here!
    },
    /**
     * Adds mana to a player's pool.
     */
    'ADD_MANA': (room, stackObj) => {
        const player = room.players[stackObj.controllerId];
        // Extract parameters from the payload
        if ('params' in stackObj.payload && stackObj.payload.params) {
            const { color, amount } = stackObj.payload.params;
            player.mana[color] = (player.mana[color] || 0) + amount;
        }
    },
    /**
     * Used for the Rock-Paper-Scissors mini-game logic.
     */
    'DISCARD_HAND': (room, stackObj) => {
        const player = room.players[stackObj.controllerId];
        // Move all cards from hand to graveyard
        player.hand.forEach(card => {
            card.state.zone = 'graveyard';
            player.graveyard.push(card);
        });
        player.hand = [];
    },
    /**
     * Deals damage to a target (player or creature).
     */
    'DEAL_DAMAGE': (room, stackObj) => {
        if (!('params' in stackObj.payload))
            return;
        const { amount } = stackObj.payload.params;
        // Process targets
        stackObj.targets.forEach(target => {
            if (target.targetType === 'player' && target.playerId) {
                const targetPlayer = room.players[target.playerId];
                if (targetPlayer)
                    targetPlayer.life -= amount;
            }
            else if ((target.targetType === 'card' || target.targetType === 'permanent') && target.cardUuid) {
                const targetCard = room.battlefield.find(c => c.uuid === target.cardUuid);
                if (targetCard) {
                    targetCard.state.damageTaken = (targetCard.state.damageTaken || 0) + amount;
                }
            }
        });
    }
};
//# sourceMappingURL=effect-registry.js.map