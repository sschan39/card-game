const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const { cards } = require('./library');
const { decks } = require('./decks');
const stateMachine = require('./stateMachine');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};


io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('createRoom', () => {
        const roomId = uuidv4();
        socket.join(roomId);
        socket.roomId = roomId;

        const State = new stateMachine(io, roomId, socket.id, null);

        rooms[roomId] = { 
            players: [], player1: 0, player2: 0, gameState: State,
            player1Heath: 20, player2Health: 20, 
            player1Mana: {red:0, black:0, green:0, grey: 0, yellow:0, blue:0},
            player2Mana: {red:0, black:0, green:0, grey: 0, yellow:0, blue:0},
            player1Minion: [], player2Minion: [], player1Spell: [], player2Spell: [],
            playedCards: {}, player1Played: [], player2Played: [], player1Hand: [], player2Hand: [],
            player1Grave: [], player2Grave: [], player1Banished: [], player2Banished: [],
            player1Board: [], player2Board: [],
            player1Deck: decks['redDeck'], 
            player2Deck: decks['redDeck'],
            RPS: 0};
        console.log(`Room created with ID: ${roomId}`);
        socket.emit('roomCreated', { roomId });
        rooms[roomId].players.push(socket.id);
        rooms[roomId].player1 = socket.id;
        //console.log(rooms[roomId].player1)
        rooms[roomId].player1Deck = rooms[roomId].player1Deck.map(card => ({ ...card, uuid: uuidv4() }));
        rooms[roomId].player2Deck = rooms[roomId].player2Deck.map(card => ({ ...card, uuid: uuidv4() }));
    });

    socket.on('joinRoom', (data) => {
        const room = rooms[data.roomId];
        if (room && room.players.length < 2) {
            socket.join(data.roomId);
            socket.roomId = data.roomId;

            console.log(`User ${socket.id} joined room: ${data.roomId}`);
            socket.emit('roomJoined', { roomId: data.roomId });
            room.players.push(socket.id);
            room.player2 = socket.id;
            room.gameState.player2 = socket.id;

            io.to(data.roomId).emit('playerJoined', { playerId: socket.id });
    
            if (room.players.length === 2) {
                console.log(`Starting game in room: ${data.roomId}`);
                io.to(data.roomId).emit('startGame', { roomId: data.roomId });
                
                // Start with RPS to determine who goes first
                room.gameState.transition('RPS');
                console.log('Game state:', room.gameState.state);
                
                // Deal RPS cards and update hands
                dealRPSCards(data.roomId);
                updateHand(data, 'player1');
                updateHand(data, 'player2');
                
                // No specific turn player during RPS - both can play
                io.to(data.roomId).emit('rpsPhase', { message: 'Choose Rock, Paper, or Scissors!' });
            }
        } else {
            socket.emit('roomFull');
        }
    });

    socket.on('endTurn', (data) => {
        const room = rooms[data.roomId];
        const gameState = room.gameState;
        
        // Don't allow ending turn during RPS phase
        if (gameState.state === 'RPS') {
            console.log(`Cannot end turn during RPS phase`);
            socket.emit('error', { message: 'Cannot end turn during Rock Paper Scissors phase!' });
            return;
        }
    
        if (!gameState.isPlayerTurn(socket.id)) {
            console.log(`It's not ${socket.id}'s turn.`);
            socket.emit('error', { message: 'Not your turn!' });
            return;
        }
        
        gameState.transition('stateEndPhase');
        console.log(`${socket.id} ended their turn.`);
        gameState.transition('cleanupStep');
        gameState.transition('stateTurnStart');

        gameState.switchTurn();
    });

    socket.on('drawCard', (data) => {
        const room = rooms[data.roomId];
        let card;
        //let cardId = generateCard();
        if (socket.id === room.player1) {
            if (room.player1Deck.length === 0) {
                io.to(socket.id).emit('GameEnded', 'You Lose, Deck Out');
                io.to(room.player2).emit('GameEnded', 'You Win, Deck Out');
                return;
            } else {
                card = room.player1Deck.pop();
            };
        } else {
            if (room.player2Deck.length === 0) {
                io.to(socket.id).emit('GameEnded', 'You Lose, Deck Out');
                io.to(room.player1).emit('GameEnded', 'You Win, Deck Out');
                return;
            } else {
                card = room.player2Deck.pop();
            };
        };
        if (card === undefined || card.cardId === undefined) {
            console.log('Card-draw not found:', card);
            return;
        }
        data.cardId = card.cardId;
        console.log(`${socket.id} drew a card:`, data.cardId, data.state);
        if (socket.id === room.player1) {
            //console.log('Card:', card);
            card.isHidden = data.state == 'hidden' ? true : false;
            room.player1Hand.push(card);
            updateHand(data, 'player1');
        } else {
            card.isHidden = data.state == 'hidden' ? true : false;
            room.player2Hand.push(card);
            updateHand(data, 'player2');
        }
    });

    socket.on('HandGetOptionsForCard', (data , callback) => {
        const card = data.card;
        const uuid = card.uuid;
        const roomId = data.roomId;
        const room = rooms[roomId];
        //console.log("room: ", room, data.roomId);
        const player = socket.id === room.player1 ? 'player1' : 'player2';
        var mana = player === 'player1' ? room.player1Mana : room.player2Mana;
        //console.log('Getting options for card:', room.player1Hand);
        //console.log('Card:', card); 
        if (card === undefined) {
            console.log('Card not found:', uuid, room[player + 'Hand']);
            return;
        }
        //console.log('mana:', mana);
        const options = getOptions(card, 'hand', roomId, mana);
        callback(options);
    });

    socket.on('playCard', (data) => {
        const cardId = data.card.cardId;
        const uuid = data.card.uuid;
        const roomId = data.roomId;
        if (cards[cardId] === undefined) {
            console.log('Card-play not found:', cardId);
            return;
        }
        if (cards[cardId]?.isHidden === true) {
            data.state = 'hidden';
        }
        if (uuid === undefined) {
            console.log('uuid not found:', uuid);
            return;
        }
        const room = rooms[roomId];
        cards[cardId]?.type === 'minion' ?  data.cardType = 'minion' : data.cardType = 'spell';
        if (checkTurn(socket, data)) {
            console.log(`${socket.id} played a card:`, cardId);
            if (!room.player1Hand.some(card => card.uuid === uuid) && !room.player2Hand.some(card => card.uuid === uuid)) {
                console.log('Invalid card played:', cardId, socket.id, uuid);
                console.log('Player 1 Hand:', room.player1Hand);
                console.log('Player 2 Hand:', room.player2Hand);
                return;
            };
            if (socket.id === room.player1) {
                const cardIndex = room.player1Hand.findIndex(card => card.uuid === uuid);
                if (cardIndex !== -1) {
                    room.player1Hand.splice(cardIndex, 1);
                } else {
                    console.log('Card not found in hand:', uuid, room.player1Hand);
                    return;
                }
                room.player1Played.push(data.card);
                cards[cardId]?.type === 'minion' ? room.player1Minion.push(data.card) : room.player1Spell.push(data.card);
                updateHand(data, 'player1');
            } else {
                const cardIndex = room.player2Hand.findIndex(card => card.uuid === uuid);
                if (cardIndex !== -1) {
                    room.player2Hand.splice(cardIndex, 1);
                } else {
                    console.log('Card not found in hand:', data.uuid, room.player2Hand);
                    return;
                }
                room.player2Played.push(data.card);
                cards[cardId]?.type === 'minion' ? room.player2Minion.push(data.card) : room.player2Spell.push(data.card);
                updateHand(data, 'player2');
            }
            // Send specific card-played event instead of full board rebuild
            const cardData = {
                card: data.card,
                cardType: data.cardType,
                isHidden: cards[cardId]?.isHidden || false  // Include visibility info
            };
            
            // Tell the player who played the card (always visible to them)
            socket.emit('cardAddedToBoard', { 
                ...cardData, 
                player: 'self',
                showHidden: false  // Player always sees their own cards
            });
            
            // Tell the opponent (respect isHidden property)
            const opponentId = socket.id === room.player1 ? room.player2 : room.player1;
            io.to(opponentId).emit('cardAddedToBoard', { 
                ...cardData, 
                player: 'opponent',
                showHidden: cardData.isHidden  // Hide if card has isHidden = true
            });
            
            room.playedCards[socket.id] = cardId;

            if (checkFunctions(cards[cardId], 'onPlay')) {
                const effectResult = cards[cardId].onPlay(io, socket, room);
                // Process the collected effects
                effectResult.effects.forEach(effect => {
                    switch (effect.type) {
                        case 'clearHand':
                            if (effect.playerId === room.player1) {
                                room.player1Hand = [];
                            } else {
                                room.player2Hand = [];
                            }
                            break;
                        case 'addMana':
                            if (effect.playerId === room.player1) {
                                room.player1Mana[effect.color] += effect.amount;
                            } else {
                                room.player2Mana[effect.color] += effect.amount;
                            }
                            break;
                        default:
                            console.warn('Unknown effect type:', effect.type);
                    }
                });
                // Process queued emits
                if (effectResult?.emits) {
                    effectResult.emits.forEach(emit => {
                        io.to(emit.target).emit(emit.event, emit.data);
                    });
                }
            }

            if (room.gameState.state === 'RPS') {
                processRPSResults(room, data, dealRPSCards, updateHand);
            } else {console.log(room.gameState.state);}
        }
    });



    socket.on('disconnect', () => {
        if (socket.roomId) {
            socket.broadcast.to(socket.roomId).emit('GameEnded', { roomId: socket.roomId });
            console.log('A user disconnected:', socket.id, 'Room ID:', socket.roomId);
            delete rooms[socket.roomId];
        } else {
            console.log('A user disconnected but no roomId found:', socket.id);
        }
    });

    socket.on('player-leave', () => {
        if (socket.roomId) {
            socket.broadcast.to(socket.roomId).emit('GameEnded', { roomId: socket.roomId });
            console.log('A user left the room:', socket.id, 'Room ID:', socket.roomId);
            socket.leave(socket.roomId);
            delete rooms[socket.roomId];
            socket.roomId = null;
        } else {
            console.log('A user left but no roomId found:', socket.id);
        }
    });

    function relayMessage(socket, event, data) {
        const room = rooms[data.roomId];
        if (socket.id === room.player1) {
            io.to(room.player2).emit(event, data);
        } else {
            io.to(room.player1).emit(event, data);
        }
    };

    function updateHand(data, player) {
        const room = rooms[data.roomId];
        //console.log('Updating hand:', room.player1Hand);
        if (player === 'player1') {
            data.hand = sortBySring(room.player1Hand);
            io.to(room.player1).emit('updateHand', data);
            io.to(room.player2).emit('updateOpponentHand', data);
        } else {
            data.hand = sortBySring(room.player2Hand);
            io.to(room.player2).emit('updateHand', data);
            io.to(room.player1).emit('updateOpponentHand', data);
        }
    };

    function updateBoard(data) {
        const room = rooms[data.roomId];
        
        // Send board state to player 1
        const player1BoardData = {
            roomId: data.roomId,
            playerMinion: room.player1Minion,
            playerSpell: room.player1Spell,
            opponentMinion: room.player2Minion,
            opponentSpell: room.player2Spell
        };
        io.to(room.player1).emit('updateBoard', player1BoardData);
        io.to(room.player1).emit('updateOpponentBoard', player1BoardData);
        
        // Send board state to player 2
        const player2BoardData = {
            roomId: data.roomId,
            playerMinion: room.player2Minion,
            playerSpell: room.player2Spell,
            opponentMinion: room.player1Minion,
            opponentSpell: room.player1Spell
        };
        io.to(room.player2).emit('updateBoard', player2BoardData);
        io.to(room.player2).emit('updateOpponentBoard', player2BoardData);
    }

    function sortBySring(hand) {
        hand.sort((a, b) => a.name.localeCompare(b.name));
        return hand;
    };

    function checkTurn(socket, data) {
        const room = rooms[data.roomId];
        
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
    };

    function dealRPSCards(roomId) {
        const room = rooms[roomId];
        //const playerIds = room.players;
        //console.log(playerIds);
        room.player1Minion = [];
        room.player2Minion = [];
        room.player1Spell = [];
        room.player2Spell = [];
        room.player1Played = [];
        room.player2Played = [];
        room.playedCards = {};
        room.player1Board = [];
        room.player2Board = [];
        
        room.player1Hand = [{ ...cards['rock'] }, { ...cards['paper'] }, { ...cards['scissors'] }];
        room.player2Hand = [{ ...cards['rock'] }, { ...cards['paper'] }, { ...cards['scissors'] }];
    };
    function generateCard() {
        const suits = ['♥', '♦', '♣', '♠'];
        const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
        const suit = suits[Math.floor(Math.random() * suits.length)];
        const value = values[Math.floor(Math.random() * values.length)];
        return `${value}${suit}`;
    };

    function checkFunctions(card, func) {
        if (typeof card[func] === 'function') {
            return true;
        } else {
            return false;
        }
    };
        
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

// Move sendFullBoardState outside so it can be accessed by processRPSResults
function sendFullBoardState(roomId) {
    const room = rooms[roomId];
    
    // Send complete board state to both players
    const player1BoardData = {
        roomId: roomId,
        playerMinion: room.player1Minion,
        playerSpell: room.player1Spell,
        opponentMinion: room.player2Minion,
        opponentSpell: room.player2Spell
    };
    io.to(room.player1).emit('fullBoardUpdate', player1BoardData);
    
    const player2BoardData = {
        roomId: roomId,
        playerMinion: room.player2Minion,
        playerSpell: room.player2Spell,
        opponentMinion: room.player1Minion,
        opponentSpell: room.player1Spell
    };
    io.to(room.player2).emit('fullBoardUpdate', player2BoardData);
}

function processRPSResults(room, data, dealRPSCards, updateHand) {
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
        io.to(data.roomId).emit('gameResult', { result });
        
        // Reset for another round of RPS
        room.playedCards = {};
        room.RPS = 0;
        dealRPSCards(data.roomId);
        updateHand(data, 'player1');
        updateHand(data, 'player2');
        sendFullBoardState(data.roomId);
        
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
        io.to(data.roomId).emit('gameResult', { result });
        
        // Clean up RPS state
        room.playedCards = {};
        room.RPS = 0;
        
        // Set the winner as current player and transition to game start
        room.gameState.currentPlayer = winner;
        room.gameState.transition('stateTurnStart');
        
        // Send turn notifications
        io.to(winner).emit('yourTurn');
        const opponent = winner === player1 ? player2 : player1;
        io.to(opponent).emit('opponentTurn');
        
        console.log(`Game starting with ${winner} going first`);
        
        // Clear RPS cards and reset all game areas
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
        
        updateHand(data, 'player1');
        updateHand(data, 'player2');
        sendFullBoardState(data.roomId);
    }
}

function enoughCost(cost, mana) {
    let enough = true;
    Object.keys(cost).forEach(color => {
        if (cost[color] > mana[color]) {
            enough = false;
        }
    });
    return enough;
}

function payCost(cost, mana) {
    Object.keys(cost).forEach(color => {
        mana[color] -= cost[color];
    });
}

function getOptions(card, place, roomId, mana) {
    const potentialFunctions = ['onPlay', 'onTurnEnd', 'onTurnStart'];
    const options = [];
    const uuid = card.uuid;
    options.push({ label: 'Default', actionId: 'defaultAction' , data: { card, uuid }});
    if (place === 'hand') {
        if (enoughCost(card.cost, mana)) {
            options.push({
                label: 'Play',
                actionId: 'playCardAction',
                data: { roomId, card }
            });
        }
    }
    // potentialFunctions.forEach(func => {
    //     if (checkFunctions(card, func)) {
    //         options.push({label: func, action: () => func()});
    //     }
    // });
    return options;
}
