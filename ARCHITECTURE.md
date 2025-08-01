# Card Game Architecture Documentation

## Overview
This is a multiplayer card game built with Node.js, Express, and Socket.IO. The architecture follows a modular design with separation of concerns to improve maintainability and testability.

## File Structure

```
card-game/
├── server.js              # Main server file (entry point)
├── gameLogic.js           # Pure game logic and utilities
├── socketHandlers.js      # Socket communication helpers
├── stateMachine.js        # Game state management
├── library.js             # Card definitions and effects
├── decks.js              # Deck configurations
├── package.json          # Dependencies and scripts
├── public/               # Frontend files
│   ├── game.html         # Game interface
│   ├── game.js           # Frontend game logic
│   ├── index.html        # Landing page
│   ├── room.js           # Room management frontend
│   ├── socket.js         # Frontend socket handling
│   └── style.css         # Styling
└── tem/                  # Template/test files
```

---

## File Responsibilities

### 1. `server.js` (Main Entry Point)
**Purpose**: Orchestrates the entire application, handles socket connections and events.

**Contains**:
- Express server setup
- Socket.IO connection handling
- Event listeners for client actions
- Room management coordination
- Game flow orchestration

**Key Responsibilities**:
- Server initialization and configuration
- Socket event routing
- Player connection/disconnection handling
- Room creation and joining logic
- Game state transitions coordination

**Dependencies**:
- Uses `GameLogic` for game rules and mechanics
- Uses `SocketHandlers` for communication utilities
- Uses `stateMachine` for game state management
- Imports card definitions from `library.js`

---

### 2. `gameLogic.js` (Pure Game Logic)
**Purpose**: Contains all game rules, mechanics, and pure functions with no side effects.

**Contains**:
```javascript
class GameLogic {
    // Card utilities
    sortByString(hand)           // Sort cards alphabetically
    generateCard()               // Generate random cards
    checkFunctions(card, func)   // Validate card functions
    
    // Mana and cost management
    enoughCost(cost, mana)       // Check if player can afford card
    payCost(cost, mana)          // Deduct mana costs
    
    // Game setup
    initializeRoom(roomId, playerId)  // Create new room structure
    dealRPSCards(room)               // Deal Rock/Paper/Scissors cards
    dealStartingHands(room)          // Deal 4 cards to each player
    
    // Game state validation
    checkTurn(socket, room)          // Validate if it's player's turn
    
    // Special game phases
    processRPSResults(room, ...)     // Handle Rock/Paper/Scissors logic
    
    // Card interaction
    getOptions(card, place, ...)     // Get available actions for cards
}
```

**Key Principles**:
- Pure functions (no direct I/O or state mutation)
- Reusable across different interfaces
- Easily testable
- Game rules centralized here

---

### 3. `socketHandlers.js` (Communication Layer)
**Purpose**: Handles all socket communication and UI updates.

**Contains**:
```javascript
class SocketHandlers {
    // Hand management
    updateHand(data, player)         // Send hand updates to players
    
    // Board management  
    updateBoard(data)                // Send incremental board updates
    sendFullBoardState(roomId)       // Send complete board state
    
    // Communication utilities
    relayMessage(socket, event, data) // Relay messages between players
}
```

**Key Responsibilities**:
- Player-to-player communication
- UI state synchronization
- Hand and board updates
- Message broadcasting

---

### 4. `stateMachine.js` (Game State Management)
**Purpose**: Manages game phases, turns, and state transitions.

**Typical Structure**:
```javascript
class StateMachine {
    constructor(io, roomId, player1, player2)
    
    // State management
    state                    // Current game phase (RPS, stateTurnStart, etc.)
    currentPlayer           // Who's turn it is
    
    // State transitions
    transition(newState)    // Change game phase
    switchTurn()           // Switch active player
    
    // Validation
    isPlayerTurn(playerId) // Check if it's specific player's turn
}
```

**Game States**:
- `RPS` - Rock Paper Scissors phase
- `stateTurnStart` - Beginning of turn
- `stateEndPhase` - End of turn
- `cleanupStep` - Cleanup between turns

---

### 5. `library.js` (Card Definitions)
**Purpose**: Defines all cards, their properties, and effects.

**Structure**:
```javascript
const cards = {
    'rock': {
        cardId: 'rock',
        name: 'Rock',
        type: 'spell',
        cost: { /* mana costs */ },
        description: 'Beats Scissors',
        isHidden: true,  // For RPS cards
        onPlay: function(io, socket, room) {
            // Card effect logic with wrapper system
            return {
                effects: [/* safe effects */],
                emits: [/* socket emissions */]
            };
        }
    },
    // ... more cards
};

// Effect wrapper system for safe card interactions
function createEffectWrapper() {
    // Returns safe wrapper functions
}
```

**Key Features**:
- Card properties (name, cost, type)
- Effect functions with wrapper system
- Safe state modification through collected effects
- Visibility controls (hidden cards)

---

### 6. `decks.js` (Deck Configurations)
**Purpose**: Defines pre-built deck configurations.

**Structure**:
```javascript
const decks = {
    'redDeck': [
        { cardId: 'fireSpell', quantity: 2 },
        { cardId: 'redMinion', quantity: 3 },
        // ... more cards
    ],
    'blueDeck': [
        // ... blue deck cards
    ]
};
```

---

## Data Flow

### 1. Player Connection Flow
```
Client connects → server.js → SocketHandlers → GameLogic.initializeRoom()
```

### 2. Game Start Flow
```
Two players join → server.js → GameLogic.dealRPSCards() → SocketHandlers.updateHand()
```

### 3. Card Play Flow
```
Client plays card → server.js validates → GameLogic.checkTurn() → 
Apply effects → SocketHandlers.updateBoard() → Update all players
```

### 4. RPS Resolution Flow
```
Both players play RPS → GameLogic.processRPSResults() → 
Determine winner → GameLogic.dealStartingHands() → Start real game
```

---

## Key Design Patterns

### 1. **Separation of Concerns**
- **server.js**: Orchestration and event handling
- **gameLogic.js**: Pure game rules
- **socketHandlers.js**: Communication only

### 2. **Effect Wrapper System**
Cards don't directly modify game state. Instead:
```javascript
// Card effect returns collected changes
return {
    effects: [
        { type: 'addMana', playerId: player1, color: 'red', amount: 1 },
        { type: 'clearHand', playerId: player2 }
    ],
    emits: [
        { target: playerId, event: 'notification', data: { message: 'Effect applied!' } }
    ]
};
```

### 3. **Incremental Updates**
- Use `cardAddedToBoard` for single card plays
- Use `fullBoardUpdate` for major state changes (RPS resolution, game reset)

### 4. **Visibility System**
- Cards can have `isHidden: true` property
- Players always see their own cards
- Opponents see hidden cards as face-down

---

## Adding New Features

### Adding a New Card:
1. **Define in `library.js`**:
   ```javascript
   'newCard': {
       cardId: 'newCard',
       name: 'New Card',
       type: 'minion',
       cost: { red: 2 },
       onPlay: function(io, socket, room) {
           // Effect logic
       }
   }
   ```

2. **Add to deck in `decks.js`**:
   ```javascript
   'redDeck': [
       // existing cards...
       { cardId: 'newCard', quantity: 2 }
   ]
   ```

### Adding a New Game Phase:
1. **Update `stateMachine.js`** with new state
2. **Add logic in `gameLogic.js`** for phase handling
3. **Update `server.js`** event handlers if needed

### Adding New Socket Events:
1. **Add handler in `server.js`**
2. **Add utility functions in `socketHandlers.js`** if needed
3. **Update frontend (`game.js`)** to handle new events

---

## Testing Strategy

### Unit Testing:
- **`gameLogic.js`**: Test all pure functions independently
- **`library.js`**: Test card effects with mock data
- **`socketHandlers.js`**: Test with mock socket objects

### Integration Testing:
- Test complete game flows (RPS → game start → card play)
- Test state transitions
- Test multiplayer scenarios

### Example Test Structure:
```javascript
// Test gameLogic.js
const gameLogic = new GameLogic();
const mockRoom = { /* mock room data */ };

test('checkTurn allows both players during RPS', () => {
    mockRoom.gameState.state = 'RPS';
    expect(gameLogic.checkTurn(mockSocket, mockRoom)).toBe(true);
});
```

---

## Common Debugging Points

1. **Card not playing**: Check `gameLogic.checkTurn()` and mana costs
2. **UI not updating**: Check `socketHandlers` update functions
3. **State transitions**: Check `stateMachine.js` state flow
4. **RPS not resolving**: Check `gameLogic.processRPSResults()`
5. **Effects not applying**: Check card effect wrapper system

---

## Performance Considerations

1. **Incremental Updates**: Use specific events instead of full state rebuilds
2. **Memory Management**: Clean up rooms when players disconnect
3. **State Validation**: Validate on server, trust on client for UI only
4. **Effect Processing**: Batch effects when possible

---

This architecture provides a solid foundation that's maintainable, testable, and extensible for future card game features.
