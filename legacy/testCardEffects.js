const StateMachine = require('./stateMachine');
const { cards } = require('./library');

// Dummy socket.io mock
const io = {
  to: () => ({ emit: () => {} })
};

// Create a state machine instance
const sm = new StateMachine(io, 'room1', 'player1', 'player2');

// Test using the new card structure
function testCardEffect(cardId) {
  console.log(`\n--- Testing ${cardId} card ---`);
  
  const card = cards[cardId];
  if (!card) {
    console.log(`Card ${cardId} not found`);
    return;
  }
  
  // Create action from card
  const action = {
    type: 'card_played',
    sourceCard: card.cardId,
    effects: card.effects,
    targets: card.needsTarget ? ['player2'] : [],
    playerId: 'player1'
  };
  
  // Add to stack
  sm.addToStack(action, 'player1');
  
  console.log('Current priority player:', sm.priorityPlayer);
  
  // Pass priority to resolve
  if (sm.priorityPlayer) {
    sm.passPriority(sm.priorityPlayer);
    if (sm.priorityPlayer) {
      sm.passPriority(sm.priorityPlayer);
    }
  }
}

// Test different card types
testCardEffect('lightning-bolt');
testCardEffect('empire-servant'); 
testCardEffect('land-red');
testCardEffect('rock');

console.log('\n--- Test completed ---');
