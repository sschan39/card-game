// const { cards } = require('./library');
// const { decks } = require('./decks');

// const rooms = {}

// rooms = { 
//     players: [], player1: 0, player2: 0, gameState: 'waiting', player1Turn: true,
//     player1Heath: 20, player2Health: 20, 
//     player1Mana: {red:0, black:0, green:0, grey: 0, yellow:0, blue:0},
//     player2Mana: {red:0, black:0, green:0, grey: 0, yellow:0, blue:0},
//     player1Minion: [], player2Minion: [], player1Spell: [], player2Spell: [],
//     playedCards: {}, player1Played: [], player2Played: [], player1Hand: [], player2Hand: [],
//     player1Grave: [], player2Grave: [], player1Banished: [], player2Banished: [],
//     player1Board: [], player2Board: [],
//     player1Deck: decks['redDeck'], 
//     player2Deck: decks['redDeck'],
//     RPS: 0
// };

document.getElementById('game-container').style.display = 'none';


document.getElementById('create-room').addEventListener('click', () => {
    let roomId = sessionStorage.getItem('roomId');
    if (roomId) {
        alert('You are already in a room. Please leave the current room before creating a new one.');
    } else {
        socket.emit('createRoom');
    }
});

document.getElementById('join-room').addEventListener('click', () => {
    let roomId = document.getElementById('room-id-input').value;
    if (roomId) {
        socket.emit('joinRoom', { roomId });
    } else {
        alert('Please enter a room ID.');
    }
});

document.getElementById('rejoin-room').addEventListener('click', () => {
    let roomId = sessionStorage.getItem('roomId');
    if (roomId) {
        showGameScreen(roomId);
    } else {
        alert('No room ID found. Please enter a room ID.');
    }
});

document.getElementById('leave-room').addEventListener('click', () => {
    let roomId = sessionStorage.getItem('roomId');
    if (roomId) {
        console.log('Leaving room:', roomId);
        socket.emit('player-leave', { roomId });
        sessionStorage.removeItem('roomId');
        showStartScreen();
    } else {
        alert('No room ID found. You are not in any room.');
    }
});

socket.on('roomCreated', (data) => {
    let roomId = sessionStorage.getItem('roomId');
    if (roomId) {
        alert('You are already in a room. Please leave the current room before creating a new one.');
        return;
    }
    document.getElementById('room-id').textContent = data.roomId;
    sessionStorage.setItem('roomId', data.roomId);
    resetGameState();
    showGameScreen(data.roomId);
});

socket.on('roomJoined', (data) => {
    document.getElementById('room-id').textContent = data.roomId;
    sessionStorage.setItem('roomId', data.roomId);
    showGameScreen(data.roomId);
});

socket.on('playerJoined', (data) => {
    console.log('Another player joined the room:', data.playerId);
});

socket.on('roomFull', () => {
    alert('The room does not exit or is full. Please try another room.');
});

socket.on('GameEnded', (data) => {
    console.log('The game has ended:', data);
    alert('A player has left the game. The game has ended');
});

document.getElementById('back').addEventListener('click', () => {
    showStartScreen();
});

function showStartScreen() {
    document.getElementById('start-container').style.display = 'block';
    document.getElementById('game-container').style.display = 'none';
}

function showGameScreen(roomId) {
    document.getElementById('start-container').style.display = 'none';
    document.getElementById('game-container').style.display = 'flex';
    document.getElementById('room-id').textContent = roomId;
}

function resetGameState() {
    document.getElementById('playerHand').innerHTML = '';
    //document.getElementById('played-cards').innerHTML = '';

    //document.getElementById('opponent-hand-cards').innerHTML = '';
    //document.getElementById('opponent-played-cards').innerHTML = '';
}