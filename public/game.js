let roomId = sessionStorage.getItem('roomId');

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
        socket.emit('drawCard', { roomId, state: 'hidden' });
    } else {
        console.error('Room ID is not defined. Cannot draw card.');
    }
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

// Handle turn changes
endTurnButton.addEventListener('click', () => {
    if (roomId) {
        socket.emit('endTurn', { roomId });
    } else {
        console.error('Room ID is not defined. Cannot end turn.');
    }
});
socket.on('opponentTurn', () => {
    console.log('It\'s opponent\'s turn!');
    document.getElementById('turn-indicator').textContent = 'Opponent turn';
});
socket.on('yourTurn', () => {
    console.log('It\'s your turn!');
    document.getElementById('turn-indicator').textContent = 'Your turn';
});

// Listen for card actions from other players
socket.on('cardAddtoOpponentHand', (data) => {
    console.log('Another player added a card to their hand:', data.cardId);
    addCardToOpponentHand(data);
});

socket.on('cardDrawn', (data) => {
    console.log('Another player drew a card:', data.card);
    addCardToOpponentHand(data);
});

socket.on('playCardToBoard', (data) => {
    console.log('Playing card:', data.cardId);
    playCard(data.cardId);
});

socket.on('cardPlayed', (data) => {
    console.log('Another player played a card:', data.cardId);
    addCardToOpponentBoard(data.cardId, data.state);
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

socket.on('updateHand', (data) => {
    console.log('Updating hand:', data.hand);
    document.getElementById('hand').innerHTML = '';
    const cards = data.hand.map(card => Object.keys(card)[0]);
    for (let card of cards) {
        data.cardId = card;
        data.state = getValueForKey(data.hand, card);
        addCardToHand(data);
    }
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

function addCardToHand(data) {
    console.log('Adding card to hand:', data.cardId, data.state);
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

function addCardToOpponentHand(data) {
    const cardElement = document.createElement('div');
    cardElement.classList.add('card');
    if (data.state === 'hidden') {
        cardElement.textContent = '🂠';
    } else {
        cardElement.textContent = data.cardId;
    }
    opponentHand.appendChild(cardElement);
}

function addCardToOpponentBoard(card, state) {
    if (state === 'hidden') {
        card = '🂠';
    } else {
        card = card;
    }
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

function getValueForKey(array, key) {
    const foundObject = array.find(item => item.hasOwnProperty(key));
    return foundObject ? foundObject[key] : undefined;
}