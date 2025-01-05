const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const { cards } = require('./library');
const { decks } = require('./decks');
const e = require('express');

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
            player1Grave: [], player2Grace: [], player1Banished: [], player2Banished: [],
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
        const room = rooms[data.roomId];
        if (room && room.players.length < 2) {
            socket.join(data.roomId);
            socket.roomId = data.roomId;
            console.log(`User ${socket.id} joined room: ${data.roomId}`);
            socket.emit('roomJoined', { roomId: data.roomId });
            room.players.push(socket.id);
            room.player2 = socket.id;
            io.to(data.roomId).emit('playerJoined', { playerId: socket.id });
    
            if (room.players.length === 2) {
                console.log(`Starting game in room: ${data.roomId}`);
                io.to(data.roomId).emit('startGame', { roomId: data.roomId });
                io.to(room.player1).emit('yourTurn');
                io.to(room.player2).emit('opponentTurn');
                room.gameState = 'RPS';
                console.log(room.gameState);
                //console.log(room.gameState, data.roomId);
                dealRPSCards(data.roomId);
                updateHand(data, 'player1');
                updateHand(data, 'player2');
            }
        } else {
            socket.emit('roomFull');
        }
    });

    socket.on('endTurn', (data) => {
        const room = rooms[data.roomId];
        if (socket.id === room.player1) {
            room.player1Turn = false;
            io.to(room.player1).emit('opponentTurn');
            io.to(room.player2).emit('yourTurn');
        } else {
            room.player1Turn = true;
            io.to(room.player2).emit('opponentTurn');
            io.to(room.player1).emit('yourTurn');
        }
    });

    socket.on('cardAddedtoHand', (data) => {
        const room = rooms[data.roomId];
        if (room === undefined) {
            console.log('Room not found:', data.roomId);
            return;
        }
        if (socket.id === room.player1) {
            room.player1Hand.push({[data.cardId]: data.state});
            room.player1Hand = sortHand(room.player1Hand);
            updateHand(data, 'player1');
        } else {
            room.player2Hand.push({[data.cardId]: data.state});
            room.player2Hand = sortHand(room.player2Hand);
            updateHand(data, 'player2');
        };
        console.log(`${socket.id} added a card to their hand:`, data.cardId, data.state);
        relayMessage(socket, 'cardAddtoOpponentHand', data);
    });

    socket.on('drawCard', (data) => {
        const room = rooms[data.roomId];
        //let cardId = generateCard();
        if (socket.id === room.player1) {
            if (room.player1Deck.length === 0) {
                io.to(socket.id).emit('GameEnded', 'You Lose, Deck Out');
                io.to(room.player2).emit('GameEnded', 'You Win, Deck Out');
                return;
            } else {
                cardId = room.player1Deck.pop().cardId;
            };
        } else {
            if (room.player2Deck.length === 0) {
                io.to(socket.id).emit('GameEnded', 'You Lose, Deck Out');
                io.to(room.player1).emit('GameEnded', 'You Win, Deck Out');
                return;
            } else {
                cardId = room.player2Deck.pop().cardId;
            };
        };
        data.cardId = cardId;
        console.log(`${socket.id} drew a card:`, data.cardId, data.state);
        if (cards[cardId] === undefined) {
            console.log('Card-draw not found:', cardId);
            return;
        }
        if (socket.id === room.player1) {
            room.player1Hand.push({[data.cardId]: data.state});
            room.player1Hand = sortHand(room.player1Hand);
            updateHand(data, 'player1');
            io.to(room.player2).emit('cardAddtoOpponentHand', data);
        } else {
            room.player2Hand.push({[data.cardId]: data.state});
            room.player2Hand = sortHand(room.player2Hand);
            updateHand(data, 'player2');
            io.to(room.player1).emit('cardAddtoOpponentHand', data);
        }
    });

    socket.on('playCard', (data) => {
        if (cards[data.cardId] === undefined) {
            console.log('Card-play not found:', data.cardId);
            //return;
        }
        if (cards[data.cardId]?.isHidden === true) {
            data.state = 'hidden';
        }
        const room = rooms[data.roomId];
        if (checkTurn(socket, data)) {
            console.log(`${socket.id} played a card:`, data.cardId);
            const player1Hand = room.player1Hand.map(card => Object.keys(card)[0]);
            const player2Hand = room.player2Hand.map(card => Object.keys(card)[0]);
            if (!player1Hand.includes(data.cardId) && !player2Hand.includes(data.cardId)) {
                console.log('Invalid card played:', data.cardId, socket.id);
                console.log('Player 1 Hand:', room.player1Hand);
                console.log('Player 2 Hand:', room.player2Hand);
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
                        dealRPSCards(data.roomId);
                        updateHand(data, 'player1');
                        updateHand(data, 'player2');
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
            } else {console.log(room.gameState);}
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
        if (player === 'player1') {
            data.hand = room.player1Hand;
            io.to(room.player1).emit('updateHand', data);
        } else {
            data.hand = room.player2Hand;
            io.to(room.player2).emit('updateHand', data);
        }
    };

    function sortHand(hand) {
        const groupedHands = hand.reduce((acc, hand) => {
            const key = Object.keys(hand)[0];
            if (!acc[key]) {
                acc[key] = [];
            }
            acc[key].push(hand);
            return acc;
        }, {});
        const sortedKeys = Object.keys(groupedHands).sort();
        const sortedhands = sortedKeys.flatMap(key => groupedHands[key]);
        return sortedhands;
    };

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
    };

    drawCardFromDeck = (socket, count, state, roomId) => {
        cardId = rooms[roomId][socket.id + 'Deck'].pop();
        io.to(socket.id).emit('addCardToHand', { roomId: roomId, cardId: cardId });
    }
    function dealRPSCards(roomId) {
        const room = rooms[roomId];
        const playerIds = room.players;
        //console.log(playerIds);
        room.player1Hand = [{'rock': 'hidden'}, {'paper': 'hidden'}, {'scissors': 'hidden'}];
        room.player2Hand = [{'rock': 'hidden'}, {'paper': 'hidden'}, {'scissors': 'hidden'}];
    };

    function generateCard() {
        const suits = ['♥', '♦', '♣', '♠'];
        const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
        const suit = suits[Math.floor(Math.random() * suits.length)];
        const value = values[Math.floor(Math.random() * values.length)];
        return `${value}${suit}`;
    };
        
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});