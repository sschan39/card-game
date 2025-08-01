class card {
    constructor(cardId, type, name, cost, text, uuid) {
        this.cardId = cardId;
        this.type = type;
        this.name = name;
        this.cost = cost;
        this.text = text;
        this.uuid = uuid;
        this.isHidden = false; // Default value
    }
}

const cards = {}

cards['rock'] = {
    cardId: 'rock',
    type: 'minion',
    name: '石頭',
    isHidden: true,
    cost: {red: 0},
    onPlay(io, socket, room) {
        io.to(socket.id).emit('removeHand');
        if (socket.id === room.player1) {
            room.player1Hand = [];
        } else if (socket.id === room.player2) {
            room.player2Hand = [];
        } else {
            console.log("playerId unmatch");
            return;
        }
    },
    uuid: 'rock'
}
cards['paper'] = {
    cardId: 'paper',
    type: 'minion',
    name: '布',
    isHidden: true,
    cost: {red: 0},
    onPlay(io, socket, room) {
        io.to(socket.id).emit('removeHand');
        if (socket.id === room.player1) {
            room.player1Hand = [];
        } else if (socket.id === room.player2) {
            room.player2Hand = [];
        } else {
            console.log("playerId unmatch");
            return;
        }
    },
    uuid: 'paper'
}
cards['scissors'] = {
    cardId: 'scissors',
    type: 'minion',
    name: '剪刀',
    isHidden: true,
    cost: {red: 0},
    onPlay(io, socket, room) {
        io.to(socket.id).emit('removeHand');
        if (socket.id === room.player1) {
            room.player1Hand = [];
        } else if (socket.id === room.player2) {
            room.player2Hand = [];
        } else {
            console.log("playerId unmatch");
            return;
        }
    },
    uuid: 'scissors'
}

cards['empire-servant'] = {
    cardId: 'empire-servant',
    name: '帝國奴僕',
    type: 'minion',
    cost: {red: 1},
    power: 1,
    health: 1,
    text: '① 橫置：生產一點炎屬性能量',
    onboardOne(io, socket) {
        this.tapped = true;
        if (socket.id === rooms[socket.roomId].player1) {
            rooms[socket.roomId].player1Mana.red++;
        } else {
            rooms[socket.roomId].player2Mana.red++;
        }
    },
}

cards['land-red'] = {
    // === Core Identity ===
    cardId: 'land-red',
    name: '血炎山',
    type: 'land',
    
    // === Game Mechanics ===
    cost: {},  // Lands are free to play
    tapped: false,  // Starts untapped when played
    
    // === Mana Production ===
    manaTap: { red: 1 },  // What mana this produces
    
    // === Rules Text ===
    text: '此卡不受牌組構築上限限制 ① 橫置：生產一點炎屬性能量',
    
    // === Special Properties ===
    basic: true,  // Basic lands (no deck limit)
    // legendary: false,  // Most lands aren't legendary
    // etbTapped: false,  // Enters untapped by default
    
    // === Abilities ===
    onPlay(io, socket, room) {
        // When land is played from hand
        return {
            effects: [
                // Could add effects like:
                // { type: 'dealDamage', target: 'self', amount: 1 }  // Painful lands
                // { type: 'gainLife', target: 'self', amount: 1 }   // Healing lands
            ], 
            emits: []
        };
    },
    
    onTap(io, socket, room, cardInstance) {
        // When tapped for mana (activated ability)
        const playerId = socket.id;
        return {
            effects: [
                { type: 'addMana', playerId: playerId, color: 'red', amount: 1 },
                { type: 'tapCard', cardUuid: cardInstance.uuid }
            ],
            emits: [
                { 
                    target: playerId, 
                    event: 'manaAdded', 
                    data: { color: 'red', amount: 1 }
                }
            ]
        };
    },
    
    // === Activation Conditions ===
    canTap(room, playerId, cardInstance) {
        // Check if this land can be tapped for mana
        if (cardInstance.tapped) {
            return { valid: false, reason: 'Already tapped' };
        }
        
        // Check ownership
        const isPlayer1 = playerId === room.player1;
        const playerLands = isPlayer1 ? room.player1Lands : room.player2Lands;
        if (!playerLands.find(land => land.uuid === cardInstance.uuid)) {
            return { valid: false, reason: 'Not your land' };
        }
        
        return { valid: true };
    },
    
    // === Optional: Special Land Features ===
    // onUntap(io, socket, room, cardInstance) {
    //     // Triggered when untapped (start of turn)
    //     return { effects: [], emits: [] };
    // },
    
    // onEnterBattlefield(io, socket, room, cardInstance) {
    //     // When land enters play (different from onPlay)
    //     return { effects: [], emits: [] };
    // },
    
    // onLeaveBattlefield(io, socket, room, cardInstance) {
    //     // When land is destroyed/removed
    //     return { effects: [], emits: [] };
    // }
}

module.exports = {
    cards
}

const { wrapCardEffect } = require('./cardEffects');

// Wrap cards that have onPlay effects
const safeCards = {};
Object.keys(cards).forEach(cardId => {
    safeCards[cardId] = { ...cards[cardId] };
    if (cards[cardId].onPlay) {
        safeCards[cardId].onPlay = wrapCardEffect(cards[cardId].onPlay);
    }
});

module.exports = {
    cards: safeCards,  // Export wrapped versions
    rawCards: cards    // Export originals if needed for reference
};