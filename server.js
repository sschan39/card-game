const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const { cards } = require('./library');
const { decks } = require('./decks');

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
        rooms[roomId] = { 
            players: [], player1: 0, player2: 0, gameState: 'waiting', player1Turn: true,
            player1Heath: 20, player2Health: 20, 
            player1Mana: {red:0, black:0, green:0, grey: 0, yellow:0, blue:0},
            player2Mana: {red:0, black:0, green:0, grey: 0, yellow:0, blue:0},
            playedCards: {}, player1Played: [], player2Played: [], player1Hand: [], player2Hand: [],
            player1Board: [], player2Board: [],
            player1Deck: decks['redDeck'], 
            player2Deck: decks['redDeck'],
            RPS: 0};
        console.log(`Room created with ID: ${roomId}`);
        socket.emit('roomCreated', { roomId });
        rooms[roomId].players.push(socket.id);
        rooms[roomId].player1 = socket.id;
        console.log(rooms[roomId].player1)
    });

    socket.on('joinRoom', (data) => {
        const room = io.sockets.adapter.rooms.get(data.roomId);
        if (room && room.size < 2) {
            socket.join(data.roomId);
            socket.roomId = data.roomId;
            console.log(`User ${socket.id} joined room: ${data.roomId}`);
            socket.emit('roomJoined', { roomId: data.roomId });
            rooms[data.roomId].players.push(socket.id);
            rooms[data.roomId].player2 = socket.id;
            io.to(data.roomId).emit('playerJoined', { playerId: socket.id });
    
            if (room.size === 2) {
                console.log(`Starting game in room: ${data.roomId}`);
                io.to(data.roomId).emit('startGame', { roomId: data.roomId });
                rooms[data.roomId].gameState = 'RPS';
                //console.log(rooms[data.roomId].gameState, data.roomId);
                dealInitialCards(data.roomId);
            }
        } else {
            socket.emit('roomFull');
        }
    });

    socket.on('endTurn', (data) => {
        const room = rooms[data.roomId];
        if (socket.id === room.player1) {
            room.player1Turn = false;
        } else {
            room.player1Turn = true;
        }
        relayMessage(socket, 'yourTurn', data);
    });

    socket.on('cardAddedtoHand', (data) => {
        console.log(`${socket.id} added a card to their hand:`, data.cardId);
        if (rooms[data.roomId] === undefined) {
            console.log('Room not found:', data.roomId);
            return;
        }
        if (socket.id === rooms[data.roomId].player1) {
            rooms[data.roomId].player1Hand.push(data.cardId);
        } else {
            rooms[data.roomId].player2Hand.push(data.cardId);
        };
        relayMessage(socket, 'cardAddtoOpponentHand', data);
    });

    socket.on('drawCard', (data) => {
        console.log(`${socket.id} drew a card`);
        socket.broadcast.to(data.roomId).emit('cardDrawn', data);
    });

    socket.on('playCard', (data) => {
        const room = rooms[data.roomId];
        if (checkTurn(socket, data)) {
            console.log(`${socket.id} played a card:`, data.cardId);
            if (!room.player1Hand.includes(data.cardId) && !room.player2Hand.includes(data.cardId)) {
                console.log('Invalid card played:', data.cardId, socket.id);
                return;
            };
            if (socket.id === room.player1) {
                room.player1Hand = room.player1Hand.filter(card => card !== data.cardId);
                room.player1Played.push(data.cardId);
            } else {
                room.player2Hand = room.player2Hand.filter(card => card !== data.cardId);
                room.player2Played.push(data.cardId);
            }
            relayMessage(socket, 'cardPlayed', data);
            socket.emit('removeCardFromHand', data);
            socket.emit('playCardToBoard', data);
            room.playedCards[socket.id] = data.cardId;
            if (room.gameState === 'RPS') {

                io.to(socket.id).emit('removeHand');
                if (socket.id === room.player1) {
                    room.player1Hand = [];
                } else {
                    room.player2Hand = [];
                }

                console.log(room.RPS);
                room.RPS++;
                if (room.RPS === 2) {
                    const player1 = room.player1;
                    const player2 = room.player2;
                    const card1 = room.playedCards[player1];
                    const card2 = room.playedCards[player2];
            
                    let result;
                    if (card1 === card2) {
                        result = 'It\'s a tie!';
                        io.to(data.roomId).emit('gameResult', { result });
                        room.playedCards = {};
                        room.gameState = 'RPS';
                        room.RPS = 0;
                        dealInitialCards(data.roomId);
                    } else if (
                        (card1 === 'rock' && card2 === 'scissors') ||
                        (card1 === 'scissors' && card2 === 'paper') ||
                        (card1 === 'paper' && card2 === 'rock')
                    ) {
                        result = `Player ${player1} wins!`;
                        io.to(data.roomId).emit('gameResult', { result });
                        room.playedCards = {};
                        room.gameState = 'stateTurnStart';
                        room.RPS = 0;
                    } else {
                        result = `Player ${player2} wins!`;
                        io.to(data.roomId).emit('gameResult', { result });
                        room.playedCards = {};
                        room.gameState = 'stateTurnStart';
                        room.RPS = 0;
                        player1Turn = false;
                    }
                } else {
                    console.log('Invalid game state:', room.gameState);
                }
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

    function relayMessage(socket, event, data) {
        const room = rooms[data.roomId];
        if (socket.id === room.player1) {
            io.to(room.player2).emit(event, data);
        } else {
            io.to(room.player1).emit(event, data);
        }
    }

    function checkTurn(socket, data) {
        //add check effect speed
        const room = rooms[data.roomId];
        if (socket.id === room.player1 && room.player1Turn === false) {
            console.log('Not your turn:', socket.id);
            return false;
        } else if (socket.id === room.player2 && room.player1Turn === true) {
            console.log('Not your turn:', socket.id);
            return false;
        } else {
            return true;
        }
    }

    drawCardFromDeck = (socket, count, state, roomId) => {
        cardId = rooms[roomId][socket.id + 'Deck'].pop();
        io.to(socket.id).emit('addCardToHand', { roomId: roomId, cardId: cardId });
    }
    function dealInitialCards(roomId) {
        const room = rooms[roomId];
        const playerIds = room.players;
        //console.log(playerIds);
        playerIds.forEach(playerId => {
            io.to(playerId).emit('addCardToHand', { cardId: 'rock', roomId: roomId });
            io.to(playerId).emit('addCardToHand', { cardId: 'paper', roomId: roomId });
            io.to(playerId).emit('addCardToHand', { cardId: 'scissors', roomId: roomId });
        });
    }
        
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});