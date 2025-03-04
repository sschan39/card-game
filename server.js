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
        //console.log(room);
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

    socket.on('playCard', (data) => {
        if (cards[data.cardId] === undefined) {
            console.log('Card-play not found:', data.cardId);
            return;
        }
        if (cards[data.cardId]?.isHidden === true) {
            data.state = 'hidden';
        }
        if (data.uuid === undefined) {
            console.log('uuid not found:', data.uuid);
            return;
        }
        const room = rooms[data.roomId];
        cards[data.cardId]?.type === 'minion' ?  data.cardType = 'minion' : data.cardType = 'spell';
        if (checkTurn(socket, data)) {
            console.log(`${socket.id} played a card:`, data.cardId);
            if (!room.player1Hand.some(card => card.uuid === data.uuid) && !room.player2Hand.some(card => card.uuid === data.uuid)) {
                console.log('Invalid card played:', data.cardId, socket.id, data.uuid);
                console.log('Player 1 Hand:', room.player1Hand);
                console.log('Player 2 Hand:', room.player2Hand);
                return;
            };
            if (socket.id === room.player1) {
                const cardIndex = room.player1Hand.findIndex(card => card.uuid === data.uuid);
                if (cardIndex !== -1) {
                    room.player1Hand.splice(cardIndex, 1);
                } else {
                    console.log('Card not found in hand:', data.uuid, room.player1Hand);
                    return;
                }
                room.player1Played.push(data.card);
                cards[data.cardId]?.type === 'minion' ? room.player1Minion.push(data.card) : room.player1Spell.push(data.card);
                updateHand(data, 'player1');
            } else {
                const cardIndex = room.player2Hand.findIndex(card => card.uuid === data.uuid);
                if (cardIndex !== -1) {
                    room.player2Hand.splice(cardIndex, 1);
                } else {
                    console.log('Card not found in hand:', data.uuid, room.player2Hand);
                    return;
                }
                room.player2Played.push(data.card);
                cards[data.cardId]?.type === 'minion' ? room.player2Minion.push(data.card) : room.player2Spell.push(data.card);
                updateHand(data, 'player2');
            }
            socket.emit('removeCardFromHand', data);
            socket.emit('playCardToBoard', data);
            updateBoard(data);
            room.playedCards[socket.id] = data.cardId;

            if (checkFunctions(cards[data.cardId], 'onPlay')) {
                cards[data.cardId].onPlay(io, socket, room);
            };

            if (room.gameState === 'RPS') {

                processRPSResults(room, data, dealRPSCards, updateHand);
            } else {console.log(room.gameState);}
        }
    });

    socket.on('getOptions', (card, roomId) => {
        //ARRRRRRRRRRR WIP
        const potentialFunctions = ['onPlay', 'onTurnEnd', 'onTurnStart'];
        const options = [];
        potentialFunctions.forEach(func => {
            if (checkFunctions(card, func)) {
                options.push(func);
            }
        });
        io.to(socket.id).emit('options', { options, card, roomId });
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
        data = {};
        data.playerMinion = room.player1Minion;
        data.playerSpell = room.player1Spell;
        data.opponentMinion = room.player2Minion;
        data.opponentSpell = room.player2Spell;
        io.to(room.player1).emit('updateBoard', data);
        io.to(room.player1).emit('updateOpponentBoard', data);
        data = {};
        data.playerMinion = room.player2Minion;
        data.playerSpell = room.player2Spell;
        data.opponentMinion = room.player1Minion;
        data.opponentSpell = room.player1Spell;
        io.to(room.player2).emit('updateBoard', data);
        io.to(room.player2).emit('updateOpponentBoard', data);
    }

    function sortBySring(hand) {
        hand.sort((a, b) => a.name.localeCompare(b.name));
        return hand;
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

function processRPSResults(room, data, dealRPSCards, updateHand) {
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
        } else if ((card1 === 'rock' && card2 === 'scissors') ||
            (card1 === 'scissors' && card2 === 'paper') ||
            (card1 === 'paper' && card2 === 'rock')) {
            result = `Player ${player1} wins!`;
            io.to(data.roomId).emit('gameResult', { result });
            room.playedCards = {};
            room.gameState = 'stateTurnStart';
            room.RPS = 0;
            player1Turn = true;
        } else {
            result = `Player ${player2} wins!`;
            io.to(data.roomId).emit('gameResult', { result });
            room.playedCards = {};
            room.gameState = 'stateTurnStart';
            room.RPS = 0;
            player1Turn = false;
        }
    } else if (room.gameState === 'RPS') {
        console.log('Updating RPS state:', room.RPS);
    } else {
        console.log('Invalid game state:', room.gameState);
    }
}
