// This intercepts card effects and makes them safe
class EffectCollector {
    constructor() {
        this.effects = [];
        this.emits = [];
    }
    
    // Safe methods cards can call
    clearHand(playerId) {
        this.effects.push({ type: 'clearHand', playerId });
    }
    
    addMana(playerId, color, amount) {
        this.effects.push({ type: 'addMana', playerId, color, amount });
    }
    
    emit(target, event, data) {
        this.emits.push({ target, event, data });
    }
}

function wrapCardEffect(originalOnPlay) {
    return function(io, socket, room) {
        const collector = new EffectCollector();
        
        // Create proxy room that intercepts modifications
        const safeRoom = new Proxy(room, {
            set(target, prop, value) {
                // Intercept hand clearing
                if ((prop === 'player1Hand' || prop === 'player2Hand') && 
                    Array.isArray(value) && value.length === 0) {
                    collector.clearHand(socket.id);
                    return true;
                }
                // Prevent other direct modifications
                console.warn('Direct room modification prevented');
                return true;
            }
        });
        
        // Create safe io that queues emits
        const safeIo = {
            to: (target) => ({
                emit: (event, data) => collector.emit(target, event, data)
            })
        };
        
        // Call original function with safe objects
        originalOnPlay.call(this, safeIo, socket, safeRoom);
        
        // Return collected effects
        return collector;
    };
}

module.exports = { wrapCardEffect };