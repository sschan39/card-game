class EffectHandler {
    constructor(io, roomId) {
        this.io = io;
        this.roomId = roomId;
    }

    // Main method to execute an effect
    executeEffect(effect, sourceAction, gameState) {
        switch(effect.type) {
            case 'deal_damage':
                this.dealDamage(effect.amount, effect.target, sourceAction);
                break;
                
            case 'add_mana':
                this.addMana(effect.color, effect.amount, effect.target || sourceAction.playerId);
                break;
                
            case 'summon_creature':
                this.summonCreature(effect.cardId, effect.controller || sourceAction.playerId);
                break;
                
            case 'play_land':
                this.playLand(effect.cardId, effect.controller || sourceAction.playerId);
                break;
                
            case 'counter_spell':
                this.counterSpell(effect.target, gameState);
                break;
                
            case 'draw_cards':
                this.drawCards(effect.amount, effect.target || sourceAction.playerId);
                break;
                
            case 'clear_hand':
                this.clearHand(effect.target || sourceAction.playerId);
                break;
                
            default:
                console.error('Unknown effect type:', effect.type);
        }
    }

    // Execute multiple effects from an action
    executeAction(action, gameState) {
        console.log(`Executing action: ${action.type} with ${action.effects.length} effects`);
        
        // Execute each effect in the action
        action.effects.forEach((effect, index) => {
            console.log(`Executing effect ${index + 1}:`, effect);
            this.executeEffect(effect, action, gameState);
        });
        
        // Notify players that action resolved
        this.io.to(this.roomId).emit('actionResolved', {
            action: action,
            remainingStackSize: gameState.stack ? gameState.stack.length : 0
        });
    }

    // Helper methods for different effect types
    dealDamage(amount, target, sourceAction) {
        console.log(`Dealing ${amount} damage to`, target);
        // Implementation depends on your game state structure
        this.io.to(this.roomId).emit('damageDealt', {
            amount: amount,
            target: target,
            source: sourceAction.sourceCard
        });
    }

    addMana(color, amount, playerId) {
        console.log(`Adding ${amount} ${color} mana to ${playerId}`);
        // Implementation depends on your mana system
        this.io.to(playerId).emit('manaAdded', {
            color: color,
            amount: amount
        });
    }

    summonCreature(cardId, controller) {
        console.log(`Summoning creature ${cardId} for ${controller}`);
        // Implementation depends on your battlefield system
        this.io.to(this.roomId).emit('creatureSummoned', {
            cardId: cardId,
            controller: controller
        });
    }

    playLand(cardId, controller) {
        console.log(`Playing land ${cardId} for ${controller}`);
        // Implementation depends on your land system
        this.io.to(this.roomId).emit('landPlayed', {
            cardId: cardId,
            controller: controller
        });
    }

    counterSpell(targetActionId, gameState) {
        console.log(`Countering spell with ID: ${targetActionId}`);
        if (gameState.stack) {
            const targetIndex = gameState.stack.findIndex(action => action.id === targetActionId);
            if (targetIndex !== -1) {
                const counteredAction = gameState.stack.splice(targetIndex, 1)[0];
                this.io.to(this.roomId).emit('spellCountered', {
                    counteredAction: counteredAction
                });
            }
        }
    }

    drawCards(amount, playerId) {
        console.log(`${playerId} draws ${amount} cards`);
        // Implementation depends on your deck/hand system
        this.io.to(playerId).emit('drawCards', {
            amount: amount
        });
    }

    clearHand(playerId) {
        console.log(`${playerId} clears their hand`);
        // Implementation depends on your hand system
        this.io.to(playerId).emit('handCleared');
    }
}

module.exports = EffectHandler;
