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

    socket.on('HandGetOptionsForCard', (data, callback) => {
        const card = data.card;
        const uuid = card.uuid;
        const roomId = data.roomId;
        const room = rooms[roomId];
        const player = socket.id === room.player1 ? 'player1' : 'player2';
        const mana = player === 'player1' ? room.player1Mana : room.player2Mana;

        if (card === undefined) {
            console.log('Card not found:', uuid, room[player + 'Hand']);
            return;
        }

        const options = gameLogic.getOptions(card, 'hand', roomId, mana);
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
        cards[cardId]?.type === 'minion' ? data.cardType = 'minion' : data.cardType = 'spell';
        
        if (gameLogic.checkTurn(socket, room)) {
            console.log(`${socket.id} played a card:`, cardId);
            
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
                cards[cardId]?.type === 'minion' ? room.player1Minion.push(data.card) : room.player1Spell.push(data.card);
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
                cards[cardId]?.type === 'minion' ? room.player2Minion.push(data.card) : room.player2Spell.push(data.card);
                socketHandlers.updateHand(data, 'player2');
            }
            
            // Send incremental board update
            const cardData = {
                card: data.card,
                cardType: data.cardType,
                isHidden: cards[cardId]?.isHidden || false
            };
            
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

            // Process card effects
            if (gameLogic.checkFunctions(cards[cardId], 'onPlay')) {
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
