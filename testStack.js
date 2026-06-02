const StateMachine = require('./stateMachine');
// Dummy socket.io mock
const io = {
  to: () => ({ emit: () => {} })
};

// Create a state machine instance
const sm = new StateMachine(io, 'room1', 'player1', 'player2');

// Only allow the player with priority to add to stack
function tryAddToStack(action, playerId) {
  if (sm.priorityPlayer !== playerId) {
    console.log(`Player ${playerId} does NOT have priority. Cannot add to stack.`);
    console.log('Current Priority' , sm.priorityPlayer)
    return;
  }
  sm.addToStack(action, playerId);
}

// Example test action (mimics a card with effects)
const testAction = {
  type: 'card_played',
  sourceCard: 'test-effect-card',
  effects: [
    { type: 'draw_cards', amount: 2, target: 'player1' },
    { type: 'deal_damage', amount: 1, target: 'player2' }
  ],
  targets: ['player1', 'player2']
};

console.log('--- Adding first action to stack ---');
sm.addToStack(testAction, 'player1');

// Simulate priority system
console.log('Current priority player:', sm.priorityPlayer);

// Prepare second action (counterspell)
const testAction2 = {
  type: 'spell_cast',
  sourceCard: 'test-counter-card',
  effects: [
    { type: 'counter_spell', target: sm.stack.length > 0 ? sm.stack[sm.stack.length - 1].id : null }
  ],
  targets: []
};

console.log('--- Player2 tries to add counterspell to stack ---');
tryAddToStack(testAction2, 'player2');

// Simulate passing priority
console.log('--- Player2 passes priority ---');
console.log('Current priority player:', sm.priorityPlayer);

// Player1 tries to add a third action (add mana)
const testAction3 = {
  type: 'ability_activated',
  sourceCard: 'test-mana-card',
  effects: [
    { type: 'add_mana', color: 'red', amount: 3, target: 'player2' }
  ],
  targets: ['player2']
};

console.log('--- Player1 tries to add add_mana to stack ---');
tryAddToStack(testAction3, 'player1');

// Simulate passing priority again
console.log('--- Player1 passes priority ---');
console.log('Current priority player:', sm.priorityPlayer);

// Resolve stack
console.log('--- Resolving stack ---');
sm.resolveStack();

// === Should Test: Player tries to add to stack without priority ===
const shouldNotAddAction = {
  type: 'card_played',
  sourceCard: 'should-not-add-card',
  effects: [
    { type: 'draw_cards', amount: 1, target: 'player2' }
  ],
  targets: ['player2']
};

console.log('--- Should Test: Player1 tries to add to stack WITHOUT priority ---');
tryAddToStack(shouldNotAddAction, 'player1');

console.log('--- Should Test: Player2 tries to add to stack WITHOUT priority ---');
tryAddToStack(shouldNotAddAction, 'player2');
