let roomId = sessionStorage.getItem('roomId');

// Create context menu element
const contextMenu = document.createElement('div');
contextMenu.id = 'contextMenu';
contextMenu.style.display = 'none';
contextMenu.style.position = 'absolute';
contextMenu.style.backgroundColor = 'white';
contextMenu.style.border = '1px solid #ccc';
contextMenu.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.2)';
contextMenu.style.zIndex = '1000';
document.body.appendChild(contextMenu);

// Action handlers for context menu
const actionHandlers = {
    defaultAction: (data) => {console.log('Default action selected')},
    playCardAction: (data) => {
        console.log('Options: ', data);
        console.log('Playing card:', data.card.cardId);
        socket.emit('playCard', { roomId: data.roomId, card: data.card });
    },
    tapForManaAction: (data) => {
        console.log('Tapping card for mana:', data.card.cardId);
        socket.emit('executeCardAction', {
            actionId: 'tapForManaAction',
            data: data
        });
    }
};

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
            //socket.emit('playCard', { roomId, cardId, uuid, card });
        } else {
            console.error('Room ID is not defined. Cannot play card.');
        }

        // Store card element position for context menu
        const rect = e.target.getBoundingClientRect();
        window.lastClickX = rect.right + 5; // Just to the right of the card
        window.lastClickY = rect.top; // Aligned with top of card
        window.clickedCardElement = e.target; // Store reference to the card

        // Update and show context menu
        updateContextMenu(card, roomId);
        contextMenu.style.display = 'block';
        contextMenu.style.left = `${window.lastClickX}px`;
        contextMenu.style.top = `${window.lastClickY}px`;
    }
});

// Hide context menu when clicking outside
document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target) && !e.target.classList.contains('card')) {
        contextMenu.style.display = 'none';
        window.clickedCardElement = null;
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
socket.on('stateChanged', (data) => {
    console.log('State changed to: ', data.state);
    document.getElementById('turnState').textContent = `Current State: ${data.state}`;
    
    // Disable end turn button during RPS
    const endTurnButton = document.getElementById('end-turn');
    if (data.state === 'RPS') {
        endTurnButton.disabled = true;
        endTurnButton.textContent = 'RPS Phase';
    } else {
        endTurnButton.disabled = false;
        endTurnButton.textContent = 'End Turn';
    }
});

socket.on('rpsPhase', (data) => {
    console.log('RPS Phase started:', data.message);
    document.getElementById('turn-indicator').textContent = 'Rock Paper Scissors - Choose your card!';
    
    // Make sure end turn button is disabled
    const endTurnButton = document.getElementById('end-turn');
    endTurnButton.disabled = true;
    endTurnButton.textContent = 'RPS Phase';
});

socket.on('opponentTurn', () => {
    console.log('It\'s opponent\'s turn!');
    document.getElementById('turn-indicator').textContent = 'Opponent turn';
    
    // Re-enable end turn button but disable it since it's opponent's turn
    const endTurnButton = document.getElementById('end-turn');
    endTurnButton.disabled = true;
    endTurnButton.textContent = 'End Turn';
});

socket.on('yourTurn', () => {
    console.log('It\'s your turn!');
    document.getElementById('turn-indicator').textContent = 'Your turn';
    
    // Enable end turn button since it's your turn
    const endTurnButton = document.getElementById('end-turn');
    endTurnButton.disabled = false;
    endTurnButton.textContent = 'End Turn';
});

socket.on('playCardToBoard', (data) => {
    console.log('Playing card:', data.cardId);
});

// New incremental update handler
socket.on('cardAddedToBoard', (data) => {
    console.log('Card added to board:', data.card.cardId, 'Player:', data.player, 'Hidden:', data.showHidden);
    console.log('Full data object:', data); // Debug: see full data object
    
    if (data.player === 'self') {
        // Add to your board (always visible) - pass the cardType from server
        addCardToBoard('visible', data.card, data.cardType);
    } else {
        // Add to opponent board (check if should be hidden)
        const state = data.showHidden ? 'hidden' : 'visible';
        addCardToOpponentBoard(state, data.card, data.cardType);
    }
});

// Unified handler for card options response
socket.on('OptionsForCard', (data) => {
    const { place, options } = data;
    console.log('Received options for', place, ':', options);
    
    // Clear existing context menu
    contextMenu.innerHTML = '';
    
    if (options && options.length > 0) {
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

            // Handle actions
            button.onclick = () => {
                console.log('Executing action:', option.actionId, option.data);
                
                if (place === 'hand') {
                    // Use existing action handlers for hand cards
                    const handler = actionHandlers[option.actionId];
                    if (handler) {
                        handler(option.data);
                    } else {
                        console.error('Unknown actionId:', option.actionId);
                    }
                } else if (place === 'battlefield') {
                    // Use executeCardAction for battlefield cards
                    socket.emit('executeCardAction', {
                        actionId: option.actionId,
                        data: option.data
                    });
                }
                
                // Hide context menu
                contextMenu.style.display = 'none';
            };

            contextMenu.appendChild(button);
        });
        
        // Show context menu near the card
        contextMenu.style.display = 'block';
        
        // Force a layout calculation to get accurate menu dimensions
        contextMenu.offsetHeight;
        
        let left = window.lastClickX || 200;
        let top = window.lastClickY || 200;
        
        // Simple bounds checking - if menu goes off right edge, show it to the left of the card
        const menuRect = contextMenu.getBoundingClientRect();
        if (left + menuRect.width > window.innerWidth) {
            // Position to the left of the card instead
            const cardRect = window.clickedCardElement?.getBoundingClientRect();
            if (cardRect) {
                left = cardRect.left - menuRect.width - 5;
            }
        }
        
        // If menu goes off bottom, position it higher
        if (top + menuRect.height > window.innerHeight) {
            top = window.innerHeight - menuRect.height - 10;
        }
        
        contextMenu.style.left = left + 'px';
        contextMenu.style.top = top + 'px';
    } else {
        console.log('No options available for this card');
    }
});

// Legacy handler for board card options response (for backward compatibility) - COMMENTED OUT
// socket.on('BoardOptionsForCard', (options) => {
//     socket.emit('OptionsForCard', { place: 'battlefield', options });
// });

// Full board rebuild (for major resets)
socket.on('fullBoardUpdate', (data) => {
    console.log('Full board update');
    // Clear everything
    playedCreatures.innerHTML = '';
    playedLands.innerHTML = '';
    opponentPlayedCreatures.innerHTML = '';
    opponentPlayedLands.innerHTML = '';
    
    // Rebuild your board (always visible)
    for (let card of data.playerMinion) {
        addCardToBoard('visible', card, 'minion');
    }
    for (let card of data.playerSpell) {
        addCardToBoard('visible', card, 'spell');
    }
    
    // Rebuild opponent board (check visibility)
    for (let card of data.opponentMinion) {
        const state = card.isHidden ? 'hidden' : 'visible';
        addCardToOpponentBoard(state, card, 'minion');
    }
    for (let card of data.opponentSpell) {
        const state = card.isHidden ? 'hidden' : 'visible';
        addCardToOpponentBoard(state, card, 'spell');
    }
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

// Legacy board update handlers (kept for compatibility)
socket.on('updateBoard', (data) => {
    console.log('Legacy updateBoard - consider using incremental updates');
    playedCreatures.innerHTML = '';
    playedLands.innerHTML = '';
    for (let card of data.playerMinion) {
        addCardToBoard('visible', card, 'minion');  // Your cards always visible
    }
    for (let card of data.playerSpell) {
        addCardToBoard('visible', card, 'spell');  // Your cards always visible
    }
});

socket.on('updateOpponentBoard', (data) => {
    console.log('Legacy updateOpponentBoard - consider using incremental updates');
    opponentPlayedCreatures.innerHTML = '';
    opponentPlayedLands.innerHTML = '';
    for (let card of data.opponentMinion) {
        const state = card.isHidden ? 'hidden' : 'visible';
        addCardToOpponentBoard(state, card, 'minion');
    }
    for (let card of data.opponentSpell) {
        const state = card.isHidden ? 'hidden' : 'visible';
        addCardToOpponentBoard(state, card, 'spell');
    }
});

// Handle card state updates (tapped, sick, etc.)
socket.on('cardStateUpdate', (data) => {
    console.log('Card state update received:', data);
    const { cardUuid, cardData } = data;
    updateCardVisualState(cardUuid, cardData);
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
    cardElement.uuid = card.uuid;  // Add UUID for future reference
    cardElement.textContent = card.name;
    playerHand.appendChild(cardElement);
}

function addCardToBoard(state, card, cardType) {
    console.log('addCardToBoard called with card:', card.cardId, 'cardType:', cardType); // Debug: check card object
    console.log('Card UUID in addCardToBoard:', card.uuid); // Debug: check UUID specifically
    
    const cardElement = document.createElement('div');
    // Use passed cardType or fallback to card.type
    const finalCardType = cardType || card.type;
    cardElement.classList.add('card');
    cardElement.card = card;
    if (state === 'hidden') {
        cardElement.textContent = '🂠';
    } else {
        cardElement.textContent = card.name;
    }
    cardElement.cardId = card.cardId;
    
    // Apply visual states for card conditions
    if (card.tapped) {
        cardElement.classList.add('tapped');
    }
    if (card.sick) {
        cardElement.classList.add('sick');
    }
    
    // Add click handler for board cards
    cardElement.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (state === 'visible' && card.uuid) {
            console.log('Requesting options for board card:', card.cardId, card.uuid);
            console.log('Full card object on click:', card); // Debug: full card object
            
            // Store card element position for context menu
            const rect = e.target.getBoundingClientRect();
            window.lastClickX = rect.right + 5; // Just to the right of the card
            window.lastClickY = rect.top; // Aligned with top of card
            window.clickedCardElement = e.target; // Store reference to the card
            
            const data = {
                uuid: card.uuid,
                place: 'battlefield',
                roomId: roomId
            };
            
            socket.emit('GetOptionsForCard', data);
        }
    });
    
    // Store uuid on the element for later updates
    cardElement.uuid = card.uuid;
    
    // Add card to appropriate zone using server's cardType
    finalCardType == 'minion' ? playedCreatures.appendChild(cardElement) : playedLands.appendChild(cardElement);
    
    return cardElement;
}

// Helper function to update card visual state
function updateCardVisualState(cardUuid, cardData) {
    // Find the card element by UUID
    const cardElements = document.querySelectorAll('.card');
    
    for (let cardElement of cardElements) {
        if (cardElement.uuid === cardUuid) {
            // Remove existing state classes
            cardElement.classList.remove('tapped', 'sick');
            
            // Add current state classes
            if (cardData.tapped) {
                cardElement.classList.add('tapped');
            }
            if (cardData.sick) {
                cardElement.classList.add('sick');
            }
            
            // Update the stored card data
            cardElement.card = { ...cardElement.card, ...cardData };
            break;
        }
    }
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

function addCardToOpponentBoard(state, card, cardType) {
    const cardElement = document.createElement('div');
    // Use passed cardType or fallback to card.type
    const finalCardType = cardType || card.type;
    cardElement.cardId = card.cardId
    cardElement.card = card;
    if (state === 'hidden') {
        cardElement.textContent = '🂠';
    } else {
        cardElement.textContent = card.name;
    }
    cardElement.classList.add('card');
    
    // Apply visual states for opponent cards too
    if (card.tapped) {
        cardElement.classList.add('tapped');
    }
    if (card.sick) {
        cardElement.classList.add('sick');
    }
    
    finalCardType == 'minion' ? opponentPlayedCreatures.appendChild(cardElement) : opponentPlayedLands.appendChild(cardElement);
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

// Function to update context menu options
function updateContextMenu(card, roomId) {
    contextMenu.innerHTML = ''; // Clear existing options

    // Use the unified option handler
    socket.emit('GetOptionsForCard', { 
        card: card, 
        roomId: roomId, 
        place: 'hand' 
    });
}

function io() {
    throw new Error("Function not implemented.");
}
