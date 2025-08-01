const { cards } = require('./library');
const { decks } = require('./decks');
const { v4: uuidv4 } = require('uuid');

class GameLogic {
    constructor(io) {
        this.io = io;
    }

    // Card and hand utilities
    sortByString(hand) {
        hand.sort((a, b) => a.name.localeCompare(b.name));
        return hand;
    }

    generateCard() {
        const suits = ['♥', '♦', '♣', '♠'];
        const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
        const suit = suits[Math.floor(Math.random() * suits.length)];
        const value = values[Math.floor(Math.random() * values.length)];
        return `${value}${suit}`;
    }

    checkFunctions(card, func) {
        return typeof card[func] === 'function';
    }

    // Mana and cost utilities
    enoughCost(cost, mana) {
        let enough = true;
        Object.keys(cost).forEach(color => {
            if (cost[color] > mana[color]) {
                enough = false;
            }
        });
        return enough;
    }

    payCost(cost, mana) {
        Object.keys(cost).forEach(color => {
            mana[color] -= cost[color];
        });
    }

    findCardOnBattlefield(room, playerId, cardUuid) {
        const isPlayer1 = playerId === room.player1;
        const playerCards = [
            ...(isPlayer1 ? room.player1Lands || [] : room.player2Lands || []),
            ...(isPlayer1 ? room.player1Minion : room.player2Minion),
            ...(isPlayer1 ? room.player1Spell : room.player2Spell)
        ];
        
        return playerCards.find(card => card.uuid === cardUuid);
    }

    // Apply summoning sickness to creatures when they enter battlefield
    applySummoningSickness(card) {
        if (card.type === 'minion') {
            card.sick = true;
        }
        return card;
    }

    canActivateAbility(room, playerId, cardInstance, abilityType) {
        console.log('Checking ability activation:', { 
            playerId, 
            cardId: cardInstance.cardId, 
            uuid: cardInstance.uuid,
            abilityType, 
            tapped: cardInstance.tapped 
        });
        
        // Basic ownership check
        const isPlayer1 = playerId === room.player1;
        const playerCards = [
            ...(isPlayer1 ? room.player1Lands || [] : room.player2Lands || []),
            ...(isPlayer1 ? room.player1Minion : room.player2Minion),
            ...(isPlayer1 ? room.player1Spell : room.player2Spell)
        ];
        
        console.log('Player cards count:', playerCards.length);
        const ownsCard = playerCards.find(card => card.uuid === cardInstance.uuid);
        console.log('Owns card:', !!ownsCard);
        
        if (!ownsCard) {
            console.log('Cannot activate: Player does not control card');
            return { valid: false, reason: 'You do not control this card' };
        }
        
        // Ability-specific checks
        if (abilityType === 'tapForMana') {
            if (cardInstance.tapped) {
                console.log('Cannot activate: Card already tapped');
                return { valid: false, reason: 'Card is already tapped' };
            }
            
            console.log('Can tap for mana: true');
            // Mana abilities can be used anytime (no timing restrictions)
            return { valid: true };
        }
        
        console.log('Cannot activate: Unknown ability type');
        return { valid: false, reason: 'Unknown ability type' };
    }

    processEffects(room, effects) {
        effects.forEach(effect => {
            switch (effect.type) {
                case 'addMana':
                    const isPlayer1 = effect.playerId === room.player1;
                    const playerMana = isPlayer1 ? room.player1Mana : room.player2Mana;
                    playerMana[effect.color] = (playerMana[effect.color] || 0) + effect.amount;
                    break;
                    
                case 'tapCard':
                    // Find card across all zones since we might not have playerId
                    let card = null;
                    if (effect.playerId) {
                        card = this.findCardOnBattlefield(room, effect.playerId, effect.cardUuid);
                    } else {
                        // Search both players' zones
                        card = this.findCardOnBattlefield(room, room.player1, effect.cardUuid) ||
                               this.findCardOnBattlefield(room, room.player2, effect.cardUuid);
                    }
                    if (card) {
                        card.tapped = true;
                        console.log('Card tapped:', card.cardId, card.uuid);
                    } else {
                        console.log('Card not found for tapping:', effect.cardUuid);
                    }
                    break;
                    
                case 'untapCard':
                    const untapCard = this.findCardOnBattlefield(room, effect.playerId, effect.cardUuid);
                    if (untapCard) {
                        untapCard.tapped = false;
                    }
                    break;
                    
                case 'removeSick':
                    const healCard = this.findCardOnBattlefield(room, effect.playerId, effect.cardUuid);
                    if (healCard) {
                        healCard.sick = false;
                    }
                    break;
                    
                // Add other effect types as needed
                default:
                    console.warn('Unknown effect type:', effect.type);
            }
        });
    }

    // Game setup
    initializeRoom(roomId, player1Id) {
        return {
            players: [player1Id], 
            player1: player1Id, 
            player2: 0, 
            gameState: null, // Will be set later
            player1Heath: 20, 
            player2Health: 20, 
            player1Mana: {red:0, black:0, green:0, grey: 0, yellow:0, blue:0},
            player2Mana: {red:0, black:0, green:0, grey: 0, yellow:0, blue:0},
            player1Minion: [], 
            player2Minion: [], 
            player1Spell: [], 
            player2Spell: [],
            playedCards: {}, 
            player1Played: [], 
            player2Played: [], 
            player1Hand: [], 
            player2Hand: [],
            player1Grave: [], 
            player2Grave: [], 
            player1Banished: [], 
            player2Banished: [],
            player1Board: [], 
            player2Board: [],
            player1Deck: decks['redDeck'].map(card => ({ ...card, uuid: uuidv4() })), 
            player2Deck: decks['redDeck'].map(card => ({ ...card, uuid: uuidv4() })),
            RPS: 0
        };
    }

    dealRPSCards(room) {
        // Clear all game areas
        room.player1Minion = [];
        room.player2Minion = [];
        room.player1Spell = [];
        room.player2Spell = [];
        room.player1Played = [];
        room.player2Played = [];
        room.playedCards = {};
        room.player1Board = [];
        room.player2Board = [];
        
        // Give RPS cards
        room.player1Hand = [{ ...cards['rock'] }, { ...cards['paper'] }, { ...cards['scissors'] }];
        room.player2Hand = [{ ...cards['rock'] }, { ...cards['paper'] }, { ...cards['scissors'] }];
    }

    dealStartingHands(room) {
        // Clear hands and board areas
        room.player1Hand = [];
        room.player2Hand = [];
        room.player1Minion = [];
        room.player2Minion = [];
        room.player1Spell = [];
        room.player2Spell = [];
        room.player1Played = [];
        room.player2Played = [];
        room.player1Board = [];
        room.player2Board = [];
        
        // Each player draws 4 cards to start
        for (let i = 0; i < 4; i++) {
            // Player 1 draws
            if (room.player1Deck.length > 0) {
                const card = room.player1Deck.pop();
                room.player1Hand.push(card);
            }
            
            // Player 2 draws  
            if (room.player2Deck.length > 0) {
                const card = room.player2Deck.pop();
                room.player2Hand.push(card);
            }
        }
    }

    // Turn and game state checks
    checkTurn(socket, room) {
        // During RPS, both players can play (no turn restrictions)
        if (room.gameState.state === 'RPS') {
            return true;
        }
        
        // During normal gameplay, check turns
        if (!room.gameState.isPlayerTurn(socket.id)) {
            console.log('Not your turn:', socket.id);
            return false;
        } else {
            return true;
        }
    }

    // RPS logic
    processRPSResults(room, data, updateHandCallback, sendFullBoardStateCallback) {
        room.RPS++;
        
        // Wait until both players have played
        if (room.RPS < 2) {
            console.log('Waiting for other player... RPS count:', room.RPS);
            return;
        }
        
        // Both players have played, now determine the winner
        const player1 = room.player1;
        const player2 = room.player2;
        const card1 = room.playedCards[player1];
        const card2 = room.playedCards[player2];
        
        console.log(`RPS Results: Player1 played ${card1}, Player2 played ${card2}`);
        
        let result;
        let winner = null;
        
        if (card1 === card2) {
            // It's a tie - restart RPS
            result = 'It\'s a tie! Playing again...';
            this.io.to(data.roomId).emit('gameResult', { result });
            
            // Reset for another round of RPS
            room.playedCards = {};
            room.RPS = 0;
            this.dealRPSCards(room);
            updateHandCallback(data, 'player1');
            updateHandCallback(data, 'player2');
            sendFullBoardStateCallback(data.roomId);
            
            // Stay in RPS state
            console.log('RPS tied, staying in RPS state');
            
        } else if ((card1 === 'rock' && card2 === 'scissors') ||
                   (card1 === 'scissors' && card2 === 'paper') ||
                   (card1 === 'paper' && card2 === 'rock')) {
            // Player 1 wins
            winner = player1;
            result = `Player 1 wins RPS and goes first!`;
            
        } else {
            // Player 2 wins
            winner = player2;
            result = `Player 2 wins RPS and goes first!`;
        }
        
        // If there's a winner, start the actual game
        if (winner) {
            this.io.to(data.roomId).emit('gameResult', { result });
            
            // Clean up RPS state
            room.playedCards = {};
            room.RPS = 0;
            
            // Set the winner as current player and transition to game start
            room.gameState.currentPlayer = winner;
            room.gameState.transition('stateTurnStart');
            
            // Send turn notifications
            this.io.to(winner).emit('yourTurn');
            const opponent = winner === player1 ? player2 : player1;
            this.io.to(opponent).emit('opponentTurn');
            
            console.log(`Game starting with ${winner} going first`);
            
            // Deal starting hands
            this.dealStartingHands(room);
            updateHandCallback(data, 'player1');
            updateHandCallback(data, 'player2');
            sendFullBoardStateCallback(data.roomId);
        }
    }

    // Options for cards
    getOptions(card, place, roomId, mana, room, playerId) {
        const options = [];
        const uuid = card.uuid;
        options.push({ label: 'Default', actionId: 'defaultAction', data: { card, uuid }});
        
        if (place === 'hand') {
            if (this.enoughCost(card.cost || {}, mana)) {
                options.push({
                    label: 'Play',
                    actionId: 'playCardAction',
                    data: { roomId, card }
                });
            }
        }
        
        if (place === 'battlefield') {
            console.log('Getting battlefield options for card:', card.cardId);
            
            // Get card definition to check for abilities
            const { cards } = require('./library');
            const cardDef = cards[card.cardId];
            
            console.log('Card definition found:', !!cardDef);
            console.log('Has onTap:', !!cardDef?.onTap);
            
            // Check for tap abilities (like lands)
            if (cardDef && cardDef.onTap) {
                // Check if card can be tapped
                const canTap = this.canActivateAbility(room, playerId, card, 'tapForMana');
                console.log('Can tap result:', canTap);
                
                if (canTap.valid) {
                    let tapLabel = 'Tap for Mana';
                    
                    // Show what mana it produces
                    if (cardDef.manaTap) {
                        const manaColors = Object.keys(cardDef.manaTap);
                        if (manaColors.length === 1) {
                            const color = manaColors[0];
                            const amount = cardDef.manaTap[color];
                            tapLabel = `Tap: Add ${amount} ${color} mana`;
                        }
                    }
                    
                    console.log('Adding tap option:', tapLabel);
                    options.push({
                        label: tapLabel,
                        actionId: 'tapForManaAction',
                        data: { card, uuid }
                    });
                }
            }
            
            // Add other battlefield abilities here as needed
            // e.g., activated abilities, attack, etc.
        }
        
        return options;
    }
}

module.exports = GameLogic;
