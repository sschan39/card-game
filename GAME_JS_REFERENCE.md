# Game.js Socket Events and Functions Reference

This document provides a simple explanation of all socket events and functions in game.js.

## Socket Events (Client Listening)

### Game State Events
- **`startGame`** - Fired when the game begins, stores roomId in session
- **`stateChanged`** - Updates game phase display, disables/enables turn button during RPS
- **`rpsPhase`** - Rock Paper Scissors phase started, disables turn controls
- **`yourTurn`** - Your turn starts, enables turn button
- **`opponentTurn`** - Opponent's turn starts, disables turn button
- **`gameResult`** - Shows who won RPS and goes first, resets game state

### Card Events
- **`cardAddedToBoard`** - A card was played to the battlefield, adds it to appropriate zone
- **`OptionsForCard`** - Server responds with available actions for a clicked card, builds context menu
- **`cardStateUpdate`** - Updates visual state of a card (tapped/sick status)
- **`playCardToBoard`** - Legacy event for card plays (mostly just logs)

### Hand/Board Updates
- **`updateHand`** - Rebuilds your entire hand from server data
- **`updateOpponentHand`** - Rebuilds opponent's hand from server data
- **`updateBoard`** - Legacy full rebuild of your board (creatures and lands)
- **`updateOpponentBoard`** - Legacy full rebuild of opponent's board
- **`fullBoardUpdate`** - Complete board reset, rebuilds everything from scratch
- **`removeHand`** - Clears your hand completely

## Socket Events (Client Sending)

### Card Actions
- **`GetOptionsForCard`** - Request available actions for a card (hand or battlefield)
- **`playCard`** - Play a card from hand (sent by action handlers)
- **`executeCardAction`** - Execute an action on a battlefield card (tap for mana, etc.)

### Game Actions  
- **`drawCard`** - Draw a card from deck
- **`endTurn`** - End your turn

## Functions

### DOM Setup Functions
- **`addCardToHand(card)`** - Creates and adds a card element to player hand
- **`addCardToBoard(state, card, cardType)`** - Creates and adds a card to player battlefield with click handler
- **`addCardToOpponentBoard(state, card, cardType)`** - Creates and adds a card to opponent battlefield
- **`addCardToOpponentHand(data)`** - Creates and adds a card to opponent hand (may be hidden)

### UI Helper Functions
- **`updateContextMenu(card, roomId)`** - Requests options for a hand card and prepares context menu
- **`updateCardVisualState(cardUuid, cardData)`** - Updates stored card data on DOM element (visual states removed)
- **`resetGameState()`** - Clears all game zones (hands, creatures, lands)

### Utility Functions
- **`getValueForKey(array, key)`** - Finds first object in array with specified property
- **`io()`** - Throws error (unused placeholder function)

## Event Listeners

### Button Clicks
- **Draw Card Button** - Sends `drawCard` event
- **End Turn Button** - Sends `endTurn` event
- **Zone Toggle Buttons** - Show/hide different card zones (hand, deck, graveyard, etc.)

### Card Interactions
- **Player Hand Click** - Sets up context menu position and requests card options
- **Board Card Click** - Sets up context menu position and requests battlefield card options
- **Document Click** - Hides context menu when clicking outside cards

## Key Data Flow Patterns

### Playing a Card from Hand
1. Click card → Store position → Send `GetOptionsForCard` (hand)
2. Server responds with `OptionsForCard` → Build context menu
3. Click option → Send `playCard` or action through handler
4. Server sends `cardAddedToBoard` → Add to battlefield

### Interacting with Battlefield Card
1. Click board card → Store position → Send `GetOptionsForCard` (battlefield) 
2. Server responds with `OptionsForCard` → Build context menu
3. Click option → Send `executeCardAction`
4. Server may send `cardStateUpdate` → Update visual state

### Turn Management
1. `yourTurn` event → Enable turn button
2. Click end turn → Send `endTurn`
3. `opponentTurn` event → Disable turn button
4. Repeat cycle

## Important Global Variables

- **`roomId`** - Current game room identifier, stored in sessionStorage
- **`contextMenu`** - DOM element for card action menu
- **`actionHandlers`** - Object mapping action IDs to handler functions
- **`window.lastClickX/Y`** - Mouse position for context menu placement
- **`window.clickedCardElement`** - Reference to last clicked card

## Common Parameters

- **`state`** - "visible" or "hidden" for card display
- **`card`** - Full card object with all properties
- **`cardType`** - "minion" or "spell" for zone placement
- **`uuid`** - Unique identifier for specific card instances
- **`cardId`** - Identifier for card type/template
- **`roomId`** - Game room identifier
- **`place`** - "hand" or "battlefield" for context
