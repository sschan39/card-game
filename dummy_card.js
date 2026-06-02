// Dummy test card with a structured effect field

const testCard = {
  cardId: 'test-effect-card',
  name: 'Test Effect Card',
  type: 'spell',
  cost: { red: 1, blue: 1 },
  text: 'Draw 2 cards, then deal 1 damage to any target.',
  effects: [
    {
      id: 'draw_cards',
      description: 'Draw 2 cards.',
      target: 'self',
      params: { amount: 2 }
    },
    {
      id: 'deal_damage',
      description: 'Deal 1 damage to any target.',
      target: 'any',
      params: { amount: 1 }
    }
  ],
  // Optionally, you can add a resolve function to process effects
  resolve(gameState, playerId, targets = []) {
    // Example pseudo-logic for resolving effects
    // ...
  }
};

module.exports = testCard;
