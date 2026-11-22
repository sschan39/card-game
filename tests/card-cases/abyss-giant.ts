import { expect } from 'vitest';
import { resolveByPassing } from '../helpers/card-test-cases';
import { giantRitual, regularGiantCast } from '../helpers/blue-ritual-card-case';

const ritual = giantRitual(5, engine => {
  resolveByPassing(engine);
  const opponent = engine.roomState.players.player2;
  expect(opponent.deck.map(card => card.uuid)).toEqual(['enemy-0']);
  expect(opponent.graveyard.map(card => card.uuid)).toEqual(Array.from({ length: 10 }, (_, i) => `enemy-${10 - i}`));
});

export default [
  regularGiantCast(8),
  { ...ritual, name: ritual.name + ', then mills ten', covers: ['ability:ritual', 'ability:special-summon-mill'] },
];
