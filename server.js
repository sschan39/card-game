const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const { cards } = require('./library');
const stateMachine = require('./stateMachine');
const GameLogic = require('./gameLogic');
const SocketHandlers = require('./socketHandlers');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};
const gameLogic = new GameLogic(io);
const socketHandlers = new SocketHandlers(io, rooms, gameLogic);

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('createRoom', () => {
        const roomId = uuidv4();
        socket.join(roomId);
        socket.roomId = roomId;

        const State = new stateMachine(io, roomId, socket.id, null);
        rooms[roomId] = gameLogic.initializeRoom(roomId, socket.id);
        rooms[roomId].gameState = State;

        console.log(`Room created with ID: ${roomId}`);
        socket.emit('roomCreated', { roomId });
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
                gameLogic.dealRPSCards(room);
                socketHandlers.updateHand(data, 'player1');
                socketHandlers.updateHand(data, 'player2');
                
                // No specific turn player during RPS - both can play
                io.to(data.roomId).emit('rpsPhase', { message: 'Choose Rock, Paper, or Scissors!' });
            }
        } else {
            socket.emit('roomFull');
        }
    });

    socket.on('nextState', (data) => {
        const room = rooms[data.roomId];
        if (room) {
            const gameState = room.gameState;
            gameState.nextState();
            console.log(`Transitioned to state: ${gameState.state}`);
        } else {
            console.error('Room not found:', data.roomId);
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

        if (socket.id === room.player1) {
            if (room.player1Deck.length === 0) {
                io.to(socket.id).emit('GameEnded', 'You Lose, Deck Out');
                io.to(room.player2).emit('GameEnded', 'You Win, Deck Out');
                return;
            } else {
                card = room.player1Deck.pop();
            }
        } else {
            if (room.player2Deck.length === 0) {
                io.to(socket.id).emit('GameEnded', 'You Lose, Deck Out');
                io.to(room.player1).emit('GameEnded', 'You Win, Deck Out');
                return;
            } else {
                card = room.player2Deck.pop();
            }
        }

        if (card === undefined || card.cardId === undefined) {
            console.log('Card-draw not found:', card);
            return;
        }

        data.cardId = card.cardId;
        console.log(`${socket.id} drew a card:`, data.cardId, data.state);
        
        if (socket.id === room.player1) {
            card.isHidden = data.state == 'hidden' ? true : false;
            room.player1Hand.push(card);
            socketHandlers.updateHand(data, 'player1');
        } else {
            card.isHidden = data.state == 'hidden' ? true : false;
            room.player2Hand.push(card);
            socketHandlers.updateHand(data, 'player2');
        }
    });

    // Unified option handler for both hand and battlefield cards
    socket.on('GetOptionsForCard', (data, callback) => {
        const { uuid: topLevelUuid, place, card: handCard, roomId: providedRoomId } = data;
        const roomId = providedRoomId || socket.roomId;
        const room = rooms[roomId];
        
        // Get UUID from top level (battlefield) or from card object (hand)
        const uuid = topLevelUuid || (handCard ? handCard.uuid : undefined);
        
        // console.log('GetOptionsForCard:', { uuid, place, playerId: socket.id });
        
        if (!room) {
            console.log('Room not found:', roomId);
            const emptyResult = [];
            if (callback) callback(emptyResult);
            socket.emit('OptionsForCard', { place, options: emptyResult });
            return;
        }

        let card, options;
        const player = socket.id === room.player1 ? 'player1' : 'player2';
        
        if (place === 'hand') {
            // Handle hand cards
            card = handCard;
            if (!card) {
                console.log('Hand card not provided');
                const emptyResult = [];
                if (callback) callback(emptyResult);
                socket.emit('OptionsForCard', { place, options: emptyResult });
                return;
            }
            
            const mana = player === 'player1' ? room.player1Mana : room.player2Mana;
            options = gameLogic.getOptions(card, place, roomId, mana, room, socket.id);
            
        } else if (place === 'battlefield') {
            // Handle battlefield cards
            if (!uuid) {
                console.log('UUID not provided for battlefield card');
                const emptyResult = [];
                if (callback) callback(emptyResult);
                socket.emit('OptionsForCard', { place, options: emptyResult });
                return;
            }
            
            card = gameLogic.findCardOnBattlefield(room, socket.id, uuid);
            
            if (!card) {
                console.log('Card not found on battlefield:', uuid);
                const emptyResult = [];
                if (callback) callback(emptyResult);
                socket.emit('OptionsForCard', { place, options: emptyResult });
                return;
            }
            
            options = gameLogic.getOptions(card, place, roomId, null, room, socket.id);
        } else {
            console.log('Unknown place:', place);
            const emptyResult = [];
            if (callback) callback(emptyResult);
            socket.emit('OptionsForCard', { place, options: emptyResult });
            return;
        }

        // console.log('Options generated:', options);
        if (callback) callback(options);
        socket.emit('OptionsForCard', { place, options });
    });

    // Legacy handlers for backward compatibility - COMMENTED OUT
    // socket.on('HandGetOptionsForCard', (data, callback) => {
    //     const card = data.card;
    //     const uuid = card.uuid;
    //     const roomId = data.roomId;
    //     const room = rooms[roomId];
    //     const player = socket.id === room.player1 ? 'player1' : 'player2';
    //     const mana = player === 'player1' ? room.player1Mana : room.player2Mana;

    //     if (card === undefined) {
    //         console.log('Card not found:', uuid, room[player + 'Hand']);
    //         return;
    //     }

    //     const options = gameLogic.getOptions(card, 'hand', roomId, mana);
    //     callback(options);
    // });

    // socket.on('BoardGetOptionsForCard', (data, callback) => {
    //     const uuid = data.uuid;
    //     const place = data.place;
    //     const roomId = socket.roomId;
    //     const room = rooms[roomId];
        
    //     console.log('BoardGetOptionsForCard called:', { uuid, place, playerId: socket.id });
        
    //     if (!room) {
    //         console.log('Room not found:', roomId);
    //         if (callback) callback([]);
    //         socket.emit('BoardOptionsForCard', []);
    //         return;
    //     }

    //     // Find the card on the battlefield
    //     const cardInstance = gameLogic.findCardOnBattlefield(room, socket.id, uuid);
    //     if (!cardInstance) {
    //         console.log('Card not found on battlefield:', uuid);
    //         console.log('Player1 Spell zone:', room.player1Spell?.map(c => ({ cardId: c.cardId, uuid: c.uuid })));
    //         console.log('Player2 Spell zone:', room.player2Spell?.map(c => ({ cardId: c.cardId, uuid: c.uuid })));
    //         console.log('Player1 Minion zone:', room.player1Minion?.map(c => ({ cardId: c.cardId, uuid: c.uuid })));
    //         console.log('Player2 Minion zone:', room.player2Minion?.map(c => ({ cardId: c.cardId, uuid: c.uuid })));
    //         if (callback) callback([]);
    //         socket.emit('BoardOptionsForCard', []);
    //         return;
    //     }

    //     console.log('Found card on battlefield:', { cardId: cardInstance.cardId, uuid: cardInstance.uuid });
    //     const options = gameLogic.getOptions(cardInstance, place, roomId, null, room, socket.id);
    //     console.log('Options generated:', options);
    //     if (callback) callback(options);
    //     socket.emit('BoardOptionsForCard', options);
    // });

    socket.on('executeCardAction', (data) => {
        console.log('executeCardAction called with data:', data);
        
        // data = { actionId, data: { card, uuid, ... } }
        const { actionId, data: actionData } = data;
        const roomId = socket.roomId;
        const room = rooms[roomId];
        
        if (!room) {
            socket.emit('error', { message: 'Room not found' });
            return;
        }

        console.log('Action ID:', actionId, 'Action data:', actionData);

        // Handle different action types
        switch (actionId) {
            case 'playCardAction':
                // This is the existing play card logic - delegate to existing handler
                
                socket.emit('playCard', { card: actionData.card, roomId });
                break;
                
            case 'tapForManaAction':
                // Handle tapping for mana
                console.log('Handling tap for mana action:', actionData);
                handleTapForMana(socket, room, actionData.card, actionData);
                break;
                
            case 'defaultAction':
                // Do nothing for default action
                break;
                
            default:
                socket.emit('error', { message: 'Unknown action type: ' + actionId });
        }
    });

    // Helper function for tapping for mana
    function handleTapForMana(socket, room, card, actionData) {
        console.log('handleTapForMana called with:', { card, actionData });
        
        if (!card || !card.uuid) {
            console.log('Invalid card data for tap:', card);
            socket.emit('error', { message: 'Invalid card data' });
            return;
        }
        
        // Find the card on the battlefield  
        const cardInstance = gameLogic.findCardOnBattlefield(room, socket.id, card.uuid);
        if (!cardInstance) {
            console.log('Card not found on battlefield for tap:', card.uuid);
            socket.emit('error', { message: 'Card not found on battlefield' });
            return;
        }

        // Get the card definition
        const cardDef = cards[cardInstance.cardId];
        if (!cardDef || !cardDef.onTap) {
            socket.emit('error', { message: 'Card cannot be tapped for mana' });
            return;
        }

        // Check conditions
        const canActivate = gameLogic.canActivateAbility(room, socket.id, cardInstance, 'tapForMana');
        if (!canActivate.valid) {
            socket.emit('error', { message: canActivate.reason });
            return;
        }

        // Execute the ability
        const result = cardDef.onTap(io, socket, room, cardInstance, actionData?.chosenMana);
        
        // Process effects
        gameLogic.processEffects(room, result.effects);
        
        // Send updates to clients
        socketHandlers.sendManaUpdate(room, socket.id);
        socketHandlers.sendCardStateUpdate(room, cardInstance, 'tapped');
        
        // Process any emits
        if (result.emits) {
            result.emits.forEach(emit => {
                io.to(emit.target).emit(emit.event, emit.data);
            });
        }
        
        console.log(`${socket.id} tapped ${cardInstance.cardId} for mana`);
    }

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
        
        // Determine card type for proper zone placement
        if (cards[cardId]?.type === 'minion') {
            data.cardType = 'minion';
        } else if (cards[cardId]?.type === 'land') {
            data.cardType = 'spell'; // Land and spell go in same zone for now
        } else {
            data.cardType = 'spell';
        }
        
        if (gameLogic.checkTurn(socket, room)) {
            console.log(`${socket.id} played a card:`, cardId);
            
            // Check mana costs for non-RPS cards
            if (room.gameState.state !== 'RPS') {
                const player = socket.id === room.player1 ? 'player1' : 'player2';
                const playerMana = player === 'player1' ? room.player1Mana : room.player2Mana;
                const card = cards[cardId];
                
                if (!gameLogic.enoughCost(card.cost || {}, playerMana)) {
                    socket.emit('error', { message: 'Not enough mana to play this card!' });
                    console.log('Insufficient mana:', card.cost, 'Available:', playerMana);
                    return;
                }
                
                // Pay the mana cost
                gameLogic.payCost(card.cost || {}, playerMana);
                
                // Update player's mana display
                socket.emit('updateMana', { mana: playerMana });
            }
            
            if (!room.player1Hand.some(card => card.uuid === uuid) && 
                !room.player2Hand.some(card => card.uuid === uuid)) {
                console.log('Invalid card played:', cardId, socket.id, uuid);
                return;
            }
            
            // Remove card from hand and add to board
            if (socket.id === room.player1) {
                const cardIndex = room.player1Hand.findIndex(card => card.uuid === uuid);
                if (cardIndex !== -1) {
                    room.player1Hand.splice(cardIndex, 1);
                } else {
                    console.log('Card not found in hand:', uuid, room.player1Hand);
                    return;
                }
                room.player1Played.push(data.card);
                
                // Place card in appropriate zone (lands and spells go to same zone for now)
                if (cards[cardId]?.type === 'minion') {
                    room.player1Minion.push(data.card);
                } else {
                    // Both lands and spells go to spell zone
                    room.player1Spell.push(data.card);
                }
                
                socketHandlers.updateHand(data, 'player1');
            } else {
                const cardIndex = room.player2Hand.findIndex(card => card.uuid === uuid);
                if (cardIndex !== -1) {
                    room.player2Hand.splice(cardIndex, 1);
                } else {
                    console.log('Card not found in hand:', data.uuid, room.player2Hand);
                    return;
                }
                room.player2Played.push(data.card);
                
                // Place card in appropriate zone (lands and spells go to same zone for now)
                if (cards[cardId]?.type === 'minion') {
                    room.player2Minion.push(data.card);
                } else {
                    // Both lands and spells go to spell zone
                    room.player2Spell.push(data.card);
                }
                
                socketHandlers.updateHand(data, 'player2');
            }
            
            // Send incremental board update
            const cardData = {
                card: data.card,
                cardType: data.cardType,
                isHidden: cards[cardId]?.isHidden || false
            };

            // if (cards[cardId]?.type === 'minion') {
            //     gameLogic.applySummoningSickness(cardData.card);
            // }
            
            // Tell the player who played the card (always visible to them)
            socket.emit('cardAddedToBoard', { 
                ...cardData, 
                player: 'self',
                showHidden: false
            });
            
            // Tell the opponent (respect isHidden property)
            const opponentId = socket.id === room.player1 ? room.player2 : room.player1;
            io.to(opponentId).emit('cardAddedToBoard', { 
                ...cardData, 
                player: 'opponent',
                showHidden: cardData.isHidden
            });
            
            room.playedCards[socket.id] = cardId;


            if (room.gameState.state === 'RPS') {
                gameLogic.processRPSResults(
                    room, 
                    data, 
                    (data, player) => socketHandlers.updateHand(data, player),
                    (roomId) => socketHandlers.sendFullBoardState(roomId)
                );
            } else {
                console.log(room.gameState.state);
            }
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
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
