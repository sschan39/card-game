const stateMachine = request('./state-machine');

class Room {
    constructor(roomId, player1Deck, player2Deck) {
        this.roomId = roomId;
        this.players = [];
        this.player1 = null;
        this.player2 = null;
        this.gameState = 'waiting';
        this.player1Turn = true;
        this.player1Health = 20;
        this.player2Health = 20;
        this.player1Mana = { red: 0, black: 0, green: 0, grey: 0, yellow: 0, blue: 0 };
        this.player2Mana = { red: 0, black: 0, green: 0, grey: 0, yellow: 0, blue: 0 };
        this.player1Minion = [];
        this.player2Minion = [];
        this.player1Spell = [];
        this.player2Spell = [];
        this.playedCards = {};
        this.player1Played = [];
        this.player2Played = [];
        this.player1Hand = [];
        this.player2Hand = [];
        this.player1Grave = [];
        this.player2Grave = [];
        this.player1Banished = [];
        this.player2Banished = [];
        this.player1Board = [];
        this.player2Board = [];
        this.player1Deck = player1Deck;
        this.player2Deck = player2Deck;
        this.RPS = 0;
    }

    addPlayer(player) {
        if (this.players.length < 2) {
            this.players.push(player);
            if (!this.player1) this.player1 = player;
            else this.player2 = player;
        } else {
            throw new Error('Room is full');
        }
    }

    updateGameState(newState) {
        this.gameState = newState;
    }

    // Add more methods as needed...
}

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