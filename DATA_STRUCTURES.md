# Card Game Data Structures Reference

This document outlines all the different data formats used throughout the application to help track what data is passed where.

## Card Object Formats

### 1. Basic Card Object (from server)
```javascript
{
    cardId: "string",     // Unique identifier for card type
    uuid: "string",       // Unique instance identifier
    name: "string",       // Display name
    type: "minion|spell", // Card type (server uses this)
    // ... other card properties
}
```

### 2. Card with State (on battlefield)
```javascript
{
    cardId: "string",
    uuid: "string", 
    name: "string",
    type: "minion|spell",
    tapped: boolean,      // Currently unused in UI
    sick: boolean,        // Currently unused in UI
    // ... other properties
}
```

### 3. Card with Visibility State
```javascript
{
    cardId: "string",
    uuid: "string",
    name: "string", 
    state: "visible|hidden",  // For display logic
    isHidden: boolean,        // Alternative visibility flag
    // ... other properties
}
```

## Socket Event Data Formats

### Client → Server Events

#### `GetOptionsForCard` (Hand Cards)
```javascript
{
    card: CardObject,        // Full card object
    roomId: "string",
    place: "hand"
}
```

#### `GetOptionsForCard` (Battlefield Cards)  
```javascript
{
    uuid: "string",          // Just the UUID
    place: "battlefield", 
    roomId: "string"
}
```

#### `playCard`
```javascript
{
    roomId: "string",
    card: CardObject         // Full card object
}
```

#### `executeCardAction`
```javascript
{
    actionId: "string",      // Action identifier
    data: {                  // Action-specific data
        card: CardObject,
        roomId: "string",
        // ... other action data
    }
}
```

### Server → Client Events

#### `cardAddedToBoard`
```javascript
{
    card: CardObject,        // Full card with state
    cardType: "minion|spell", // Type from server (preferred)
    player: "self|opponent",
    showHidden: boolean
}
```

#### `OptionsForCard`
```javascript
{
    place: "hand|battlefield",
    options: [
        {
            label: "string",     // Display text
            actionId: "string",  // Handler identifier
            data: {              // Action payload
                card: CardObject,
                roomId: "string",
                // ... other data
            }
        }
        // ... more options
    ]
}
```

#### `cardStateUpdate`
```javascript
{
    cardUuid: "string",      // Target card UUID
    cardData: {              // Updated properties
        tapped: boolean,
        sick: boolean,
        // ... other state changes
    }
}
```

#### Board Update Events
```javascript
// updateBoard, updateOpponentBoard
{
    playerMinion: [CardObject, ...],
    playerSpell: [CardObject, ...],
    opponentMinion: [CardObject, ...], 
    opponentSpell: [CardObject, ...]
}
```

## DOM Element Properties

### Card Elements (created by addCardToBoard, addCardToHand, etc.)
```javascript
cardElement.card = CardObject;       // Full card data
cardElement.cardId = "string";       // Card type ID
cardElement.uuid = "string";         // Instance UUID
cardElement.classList;               // CSS classes for visual state
```

## Function Parameter Patterns

### `addCardToBoard(state, card, cardType)`
- `state`: "visible|hidden" - Display state
- `card`: Full CardObject - All card data
- `cardType`: "minion|spell" - Type override from server

### `addCardToOpponentBoard(state, card, cardType)`
- Same as addCardToBoard

### `updateCardVisualState(cardUuid, cardData)`
- `cardUuid`: "string" - Target card UUID
- `cardData`: Object - Updated properties only

### Context Menu Handlers
```javascript
actionHandlers.playCardAction(data) {
    // data.card = Full CardObject
    // data.roomId = "string"
}
```

## Common Data Inconsistencies to Watch For

1. **Card Type Property**: 
   - Server sends `cardType` in events
   - Card objects have `type` property
   - Use `cardType || card.type` pattern

2. **Visibility States**:
   - `state: "visible|hidden"` (display logic)
   - `isHidden: boolean` (server flag) 
   - `showHidden: boolean` (event flag)

3. **Card Identification**:
   - `cardId` = card type identifier
   - `uuid` = unique instance identifier
   - Use `uuid` for targeting specific cards

4. **Player Perspective**:
   - `player: "self|opponent"` in events
   - Your cards always visible
   - Opponent cards check visibility flags

## Tips for Managing Complexity

1. **Always log data shapes**: Add console.log with full objects when debugging
2. **Use TypeScript**: Consider adding JSDoc comments for type hints
3. **Consistent naming**: Stick to established patterns (uuid vs cardId)
4. **Validate data**: Check for required properties before using
5. **Document functions**: Add comments explaining expected parameter formats
