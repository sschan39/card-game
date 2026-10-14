// Simple Zustand store for the card game
// This replaces scattered state management with a centralized store

// For now, we'll create a simple version without imports since you're using vanilla JS
// In a real setup, you'd: import { create } from 'zustand'

// Simplified Zustand-like implementation for demonstration
function createStore(storeFunction) {
    let state = {};
    let listeners = [];
    
    const setState = (partial) => {
        const newState = typeof partial === 'function' ? partial(state) : partial;
        state = { ...state, ...newState };
        listeners.forEach(listener => listener(state));
    };
    
    const getState = () => state;
    
    const subscribe = (listener) => {
        listeners.push(listener);
        return () => {
            listeners = listeners.filter(l => l !== listener);
        };
    };
    
    // Initialize store
    const store = storeFunction(setState, getState);
    state = { ...store };
    
    return {
        getState,
        setState,
        subscribe,
        ...store
    };
}

// Your game store - this replaces all scattered state
const gameStore = createStore((set, get) => ({
    // Game state
    roomId: sessionStorage.getItem('roomId'),
    gamePhase: 'waiting',
    currentPlayer: null,
    turnIndicator: 'Waiting for game to start',
    
    // Player zones
    playerHand: [],
    playerBattlefield: [],
    playerDeck: [],
    playerGraveyard: [],
    playerExile: [],
    
    // Opponent zones  
    opponentHand: [],
    opponentBattlefield: [],
    opponentDeck: [],
    opponentGraveyard: [],
    opponentExile: [],
    
    // UI state
    contextMenuVisible: false,
    contextMenuOptions: [],
    contextMenuPosition: { x: 0, y: 0 },
    
    // Actions - these replace your scattered functions
    setRoomId: (id) => {
        sessionStorage.setItem('roomId', id);
        set({ roomId: id });
    },
    
    setGamePhase: (phase) => set({ gamePhase: phase }),
    
    setTurnIndicator: (text) => set({ turnIndicator: text }),
    
    // Card management actions
    addCardToPlayerHand: (card) => set((state) => ({
        playerHand: [...state.playerHand, card]
    })),
    
    removeCardFromPlayerHand: (cardUuid) => set((state) => ({
        playerHand: state.playerHand.filter(card => card.uuid !== cardUuid)
    })),
    
    addCardToPlayerBattlefield: (card) => set((state) => ({
        playerBattlefield: [...state.playerBattlefield, card]
    })),
    
    playCardFromHandToBattlefield: (cardUuid) => {
        const state = get();
        const card = state.playerHand.find(c => c.uuid === cardUuid);
        if (!card) {
            console.error('Card not found in hand:', cardUuid);
            return;
        }
        
        set({
            playerHand: state.playerHand.filter(c => c.uuid !== cardUuid),
            playerBattlefield: [...state.playerBattlefield, card]
        });
    },
    
    updateCardInBattlefield: (cardUuid, updates) => set((state) => ({
        playerBattlefield: state.playerBattlefield.map(card =>
            card.uuid === cardUuid ? { ...card, ...updates } : card
        )
    })),
    
    // Opponent actions
    setOpponentHand: (cards) => set({ opponentHand: cards }),
    
    addCardToOpponentBattlefield: (card) => set((state) => ({
        opponentBattlefield: [...state.opponentBattlefield, card]
    })),
    
    // Context menu actions
    showContextMenu: (options, position) => set({
        contextMenuVisible: true,
        contextMenuOptions: options,
        contextMenuPosition: position
    }),
    
    hideContextMenu: () => set({
        contextMenuVisible: false,
        contextMenuOptions: [],
        contextMenuPosition: { x: 0, y: 0 }
    }),
    
    // Helper functions
    findCardByUuid: (uuid) => {
        const state = get();
        const allPlayerCards = [
            ...state.playerHand,
            ...state.playerBattlefield,
            ...state.playerDeck,
            ...state.playerGraveyard,
            ...state.playerExile
        ];
        return allPlayerCards.find(card => card.uuid === uuid);
    },
    
    getPlayerCardCount: () => {
        const state = get();
        return {
            hand: state.playerHand.length,
            battlefield: state.playerBattlefield.length,
            deck: state.playerDeck.length,
            graveyard: state.playerGraveyard.length,
            exile: state.playerExile.length
        };
    },
    
    // Reset everything
    resetGameState: () => set({
        gamePhase: 'waiting',
        currentPlayer: null,
        turnIndicator: 'Game reset',
        playerHand: [],
        playerBattlefield: [],
        playerDeck: [],
        playerGraveyard: [],
        playerExile: [],
        opponentHand: [],
        opponentBattlefield: [],
        opponentDeck: [],
        opponentGraveyard: [],
        opponentExile: [],
        contextMenuVisible: false,
        contextMenuOptions: [],
        contextMenuPosition: { x: 0, y: 0 }
    }),
    
    // Debug helper
    debugState: () => {
        console.log('=== GAME STATE DEBUG ===');
        const state = get();
        console.log('Room ID:', state.roomId);
        console.log('Game Phase:', state.gamePhase);
        console.log('Player Hand:', state.playerHand.length, 'cards');
        console.log('Player Battlefield:', state.playerBattlefield.length, 'cards');
        console.log('Opponent Hand:', state.opponentHand.length, 'cards');
        console.log('Opponent Battlefield:', state.opponentBattlefield.length, 'cards');
        console.log('Full State:', state);
        console.log('========================');
    }
}));

// Export for use in other files
window.gameStore = gameStore;

// Example of how to use this store:

/* 
// Instead of scattered variables and DOM state, you'd do:

// Get current state
const currentHand = gameStore.getState().playerHand;
const roomId = gameStore.getState().roomId;

// Update state
gameStore.setRoomId('room-123');
gameStore.addCardToPlayerHand({ uuid: 'card-1', name: 'Lightning Bolt', type: 'spell' });

// Play a card (moves from hand to battlefield)
gameStore.playCardFromHandToBattlefield('card-1');

// Listen to state changes (for UI updates)
gameStore.subscribe((newState) => {
    console.log('State changed!', newState);
    // Update UI here
    renderPlayerHand(newState.playerHand);
    renderPlayerBattlefield(newState.playerBattlefield);
});

// Debug anytime
gameStore.debugState();
*/
