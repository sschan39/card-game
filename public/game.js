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
const hand = document.getElementById('player-hand');
const playedCreatures = document.getElementById('creatures');
const drawCardButton = document.getElementById('draw-card');
const endTurnButton = document.getElementById('end-turn');
const opponentHandButton = document.getElementById('opponent-hand-button');
const opponentHand = document.getElementById('opponent-hand');
const opponentPlayedCreatures = document.getElementById('opponent-creatures');

// Handle opponent hand visibility
opponentHandButton.addEventListener('click', () => {
    if (opponentHand.style.display === 'none') {
        opponentHand.style.display = 'flex';
    } else {
        opponentHand.style.display = 'none';
    }
});

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
        const cardId = e.target.cardId;
        console.log(e.target.cardId);
        if (roomId) {
            socket.emit('playCard', { roomId, cardId });
        } else {
            console.error('Room ID is not defined. Cannot play card.');
        }

        // Update and show context menu
        updateContextMenu(cardId);
        contextMenu.style.display = 'block';
        contextMenu.style.left = `${e.pageX}px`;
        contextMenu.style.top = `${e.pageY}px`;
    }
});

// Hide context menu when clicking outside
document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target) && !e.target.classList.contains('card')) {
        contextMenu.style.display = 'none';
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
    document.getElementById('player-hand').innerHTML = '';
    for (let card of data.hand) {
        data.name = card.name;
        data.cardId = card.cardId;
        data.state = card.isHidden === undefined || card.isHidden ? 'hidden' : 'visible';
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
    document.getElementById('player-hand').innerHTML = '';
});

// Helper functions

function addCardToHand(data) {
    console.log('Adding card to hand:', data.cardId, data.state);
    const cardElement = document.createElement('div');
    cardElement.classList.add('card');
    cardElement.cardId = data.cardId;
    cardElement.textContent = data.name;
    hand.appendChild(cardElement);
}

function playCard(cardId) {
    addCardToBoard(cardId);
}

function addCardToBoard(cardId) {
    const cardElement = document.createElement('div');
    cardElement.classList.add('card');
    cardElement.cardId = cardId;
    cardElement.textContent = cardId;
    playedCreatures.appendChild(cardElement);
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
    opponentPlayedCreatures.appendChild(cardElement);
}

function resetGameState() {
    document.getElementById('player-hand').innerHTML = '';
    document.getElementById('creatures').innerHTML = '';
    document.getElementById('opponent-creatures').innerHTML = '';
    document.getElementById('lands').innerHTML = '';
    document.getElementById('opponent-lands').innerHTML = '';
    document.getElementById('opponent-hand').innerHTML = '';
}

function getValueForKey(array, key) {
    const foundObject = array.find(item => item.hasOwnProperty(key));
    return foundObject ? foundObject[key] : undefined;
}



const contextMenu = document.createElement('div');
contextMenu.id = 'contextMenu';
contextMenu.style.display = 'none';
contextMenu.style.position = 'absolute';
contextMenu.style.backgroundColor = 'white';
contextMenu.style.border = '1px solid #ccc';
contextMenu.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.2)';
contextMenu.style.zIndex = '1000';
document.body.appendChild(contextMenu);

// Function to update context menu options
function updateContextMenu(cardId) {
    contextMenu.innerHTML = ''; // Clear existing options

    // Define options based on cardId
    const options = getOptionsForCard(cardId);

    // Add options to context menu
    options.forEach(option => {
        const button = document.createElement('button');
        button.textContent = option.label;
        button.style.display = 'block';
        button.style.width = '100%';
        button.style.padding = '8px';
        button.style.border = 'none';
        button.style.background = 'none';
        button.style.textAlign = 'left';
        button.onmouseover = () => button.style.backgroundColor = '#f0f0f0';
        button.onmouseout = () => button.style.backgroundColor = 'white';
        button.onclick = option.action;
        contextMenu.appendChild(button);
    });
}

// Function to get options based on cardId
function getOptionsForCard(cardId) {
    // Example: Return different options based on cardId
    if (cardId === '1') {
        return [
            { label: 'Option 1A', action: () => console.log('Option 1A selected') },
            { label: 'Option 1B', action: () => console.log('Option 1B selected') }
        ];
    } else if (cardId === '2') {
        return [
            { label: 'Option 2A', action: () => console.log('Option 2A selected') },
            { label: 'Option 2B', action: () => console.log('Option 2B selected') }
        ];
    } else {
        return [
            { label: 'Default Option', action: () => console.log('Default Option selected') }
        ];
    }
}