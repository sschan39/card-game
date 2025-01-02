socket.on('startGame', (data) => {
    console.log('startGame event received:', data);
    if (data && data.roomId) {
        console.log('The game has started!');
        roomId = data.roomId;
        sessionStorage.setItem('roomId', roomId);
    } else {
        console.error('startGame event received without roomId:', data);
    }
});

// DOM elements
const hand = document.getElementById('hand');
const playedCards = document.getElementById('played-cards');
const drawCardButton = document.getElementById('draw-card');
const endTurnButton = document.getElementById('end-turn');
const opponentHand = document.getElementById('opponent-hand-cards');
const opponentPlayedCards = document.getElementById('opponent-played-cards');

// Handle card drawing
drawCardButton.addEventListener('click', () => {
    if (roomId) {
        const card = {};
        card.cardId = generateCard();
        addCardToHand({ roomId, cardId: card.cardId });
        console.log(roomId);
    } else {
        console.error('Room ID is not defined. Cannot draw card.');
    }
});

// Handle ending turn
endTurnButton.addEventListener('click', () => {
    if (roomId) {
        socket.emit('endTurn', { roomId });
    } else {
        console.error('Room ID is not defined. Cannot end turn.');
    }
    document.getElementById('turn-indicator').textContent = 'Opponent turn';
});

socket.on('yourTurn', () => {
    console.log('It\'s your turn!');
    document.getElementById('turn-indicator').textContent = 'Your turn';
});

// Handle playing a card
hand.addEventListener('click', (e) => {
    if (e.target.classList.contains('card')) {
        const cardId = e.target.textContent;
        if (roomId) {
            socket.emit('playCard', { roomId, cardId });
        } else {
            console.error('Room ID is not defined. Cannot play card.');
        }
    }
});

// Listen for card actions from other players
socket.on('cardAddtoOpponentHand', (data) => {
    console.log('Another player added a card to their hand:', data.cardId);
    addBlankCardToOpponentHand();
});

socket.on('cardDrawn', (data) => {
    console.log('Another player drew a card:', data.card);
    addBlankCardToOpponentHand();
});

socket.on('playCardToBoard', (data) => {
    console.log('Playing card:', data.cardId);
    playCard(data.cardId);
});

socket.on('cardPlayed', (data) => {
    console.log('Another player played a card:', data.cardId);
    addCardToOpponentBoard(data.cardId);
});

socket.on('gameResult', (data) => {
    console.log('Game result:', data.result);
    if (data.result.includes('Player')) {
        const winner = data.result.includes(socket.id) ? 'You' : 'Opponent';
        console.log(`${winner} go first!`);
    } else {
        alert('It\'s a tie! No one goes first.');
    }
    resetGameState();
});

socket.on('addCardToHand', (data) => {
    addCardToHand(data);
});

socket.on('removeCardFromHand', (data) => {
    console.log('Removing card from hand:', data.cardId);
    const cardElements = hand.getElementsByClassName('card');
    for (let cardElement of cardElements) {
        if (cardElement.textContent === data.cardId) {
            cardElement.remove();
            break;
        }
    }
});

socket.on('removeHand', () => {
    console.log('Removing hand');
    document.getElementById('hand').innerHTML = '';
});

// Helper functions

function generateCard() {
    const suits = ['♥', '♦', '♣', '♠'];
    const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    const suit = suits[Math.floor(Math.random() * suits.length)];
    const value = values[Math.floor(Math.random() * values.length)];
    return `${value}${suit}`;
}

function addCardToHand(data) {
    console.log('Adding card to hand:', data.cardId);
    socket.emit('cardAddedtoHand', data);
    const cardElement = document.createElement('div');
    cardElement.classList.add('card');
    cardElement.textContent = data.cardId;
    hand.appendChild(cardElement);
}

function playCard(cardId) {
    addCardToBoard(cardId);
}

function addCardToBoard(cardId) {
    const cardElement = document.createElement('div');
    cardElement.classList.add('card');
    cardElement.textContent = cardId;
    playedCards.appendChild(cardElement);
}

function addBlankCardToOpponentHand() {
    const cardElement = document.createElement('div');
    cardElement.classList.add('card');
    cardElement.textContent = '🂠'; // Unicode character for a blank card
    opponentHand.appendChild(cardElement);
}

function addCardToOpponentBoard(card) {
    const cardElement = document.createElement('div');
    cardElement.classList.add('card');
    cardElement.textContent = card;
    opponentPlayedCards.appendChild(cardElement);
}

function resetGameState() {
    document.getElementById('hand').innerHTML = '';
    document.getElementById('played-cards').innerHTML = '';
    document.getElementById('opponent-hand-cards').innerHTML = '';
    document.getElementById('opponent-played-cards').innerHTML = '';
}