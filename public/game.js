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
const playerHand = document.getElementById('playerHand');
const playedCreatures = document.getElementById('creatures');
const playedLands = document.getElementById('lands');
const drawCardButton = document.getElementById('draw-card');
const endTurnButton = document.getElementById('end-turn');
const opponentPlayedCreatures = document.getElementById('opponent-creatures');
const opponentPlayedLands = document.getElementById('opponent-lands');

// Handle opponent hand visibility
const opponentHand = document.getElementById('opponentHand');
const opponentDeck = document.getElementById('opponentDeck');
const opponentExile = document.getElementById('opponentExile');
const opponentGraveyard = document.getElementById('opponentGraveyard');

const OpponentSections = {
    opponentHand,
    opponentDeck,
    opponentExile,
    opponentGraveyard
};

Object.keys(OpponentSections).forEach(key => {
    document.getElementById(`${key}-button`).addEventListener('click', () => {
        const section = OpponentSections[key];
        if (section.style.display === 'flex') {
            section.style.display = 'none';
        } else {
            Object.values(OpponentSections).forEach(sec => sec.style.display = 'none');
            section.style.display = 'flex';
        }
    });
});

const playerDeck = document.getElementById('playerDeck');
const playerExile = document.getElementById('playerExile');
const playerGraveyard = document.getElementById('playerGraveyard');

const Playersections = {
    playerHand,
    playerDeck,
    playerExile,
    playerGraveyard
};

Object.keys(Playersections).forEach(key => {
    document.getElementById(`${key}-button`).addEventListener('click', () => {
        Object.values(Playersections).forEach(section => section.style.display = 'none');
        Playersections[key].style.display = 'flex';
    });
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
playerHand.addEventListener('click', (e) => {
    if (e.target.classList.contains('card')) {
        const cardId = e.target.card.cardId;
        const uuid = e.target.card.uuid;
        const card = e.target.card;
        if (roomId) {
            socket.emit('playCard', { roomId, cardId, uuid, card });
        } else {
            console.error('Room ID is not defined. Cannot play card.');
        }

        // Update and show context menu
        updateContextMenu(card, roomId);
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

socket.on('playCardToBoard', (data) => {
    console.log('Playing card:', data.cardId);
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
    playerHand.innerHTML = '';
    for (let card of data.hand) {
        card.state = card.isHidden === undefined || card.isHidden ? 'hidden' : 'visible';
        addCardToHand(card);
    }
});
socket.on('updateOpponentHand', (data) => {
    console.log('Updating opponent hand:', data.hand);
    opponentHand.innerHTML = '';
    for (let card of data.hand) {
        addCardToOpponentHand(card);
    }
});

socket.on('updateBoard', (data) => {
    //WIP
    state = 'temp';
    console.log('Updating board');
    playedCreatures.innerHTML = '';
    playedLands.innerHTML = '';
    for (let card of data.playerMinion) {
        console.log(card);
        addCardToBoard(state, card);
    }
    for (let card of data.playerSpell) {
        addCardToBoard(state, card);
    }
});
socket.on('updateOpponentBoard', (data) => {
    state = 'temp';
    opponentPlayedCreatures.innerHTML = '';
    opponentPlayedLands.innerHTML = '';
    for (let card of data.opponentMinion) {
        addCardToOpponentBoard(state, card);
    }
    for (let card of data.opponentSpell) {
        addCardToOpponentBoard(state, card);
    }
});

socket.on('removeCardFromHand', (data) => {
    console.log('Removing card from hand:', data.cardId);
    const cardElements = playerHand.getElementsByClassName('card');
    for (let cardElement of cardElements) {
        if (cardElement.uuid === data.uuid) {
            cardElement.remove();
            break;
        }
    }
});

socket.on('removeHand', () => {
    console.log('Removing hand');
    document.getElementById('playerHand').innerHTML = '';
});

// Helper functions

function addCardToHand(card) {
    console.log('Adding card to hand:', card.cardId, card.state);
    const cardElement = document.createElement('div');
    cardElement.card = card;
    cardElement.classList.add('card');
    cardElement.cardId = card.cardId;
    cardElement.textContent = card.name;
    playerHand.appendChild(cardElement);
}

function addCardToBoard(state, card) {
    const cardElement = document.createElement('div');
    const cardType = card.type;
    cardElement.classList.add('card');
    cardElement.card = card;
    if (state === 'hidden') {
        cardElement.textContent = '🂠';
    } else {
        cardElement.textContent = card.name;
    }
    cardElement.cardId = card.cardId;
    cardType == 'minion' ? playedCreatures.appendChild(cardElement) : playedLands.appendChild(cardElement);
}

function addCardToOpponentHand(data) {
    const cardElement = document.createElement('div');
    cardElement.classList.add('card');
    cardElement.cardId = data.cardId;
    cardElement.uuid = data.uuid;
    if (data.state === 'visible') {
        cardElement.textContent = data.name;
    } else {
        cardElement.textContent = '🂠';
    }
    opponentHand.appendChild(cardElement);
}

function addCardToOpponentBoard(state, card) {
    const cardElement = document.createElement('div');
    const cardType = card.type;
    cardElement.cardId = card.cardId
    cardElement.card = card;
    if (state === 'hidden') {
        cardElement.textContent = '🂠';
    } else {
        cardElement.textContent = card.name;
    }
    cardElement.classList.add('card');
    cardType == 'minion' ? opponentPlayedCreatures.appendChild(cardElement) : opponentPlayedLands.appendChild(cardElement);
}

function resetGameState() {
    document.getElementById('playerHand').innerHTML = '';
    document.getElementById('creatures').innerHTML = '';
    document.getElementById('opponent-creatures').innerHTML = '';
    document.getElementById('lands').innerHTML = '';
    document.getElementById('opponent-lands').innerHTML = '';
    document.getElementById('opponentHand').innerHTML = '';
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
function updateContextMenu(card, roomId) {
    contextMenu.innerHTML = ''; // Clear existing options

    // Define options based on cardId
    const options = getOptionsForCard(card, roomId);

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
function getOptionsForCard(card, roomId) {
    // Example: Return different options based on cardId
    if (card === '1') {
        return [
            { label: 'Option 1A', action: () => console.log('Option 1A selected') },
            { label: 'Option 1B', action: () => console.log('Option 1B selected') }
        ];
    } else if (card === '2') {
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

function io() {
    throw new Error("Function not implemented.");
}
