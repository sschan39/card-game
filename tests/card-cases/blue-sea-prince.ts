import { expect } from 'vitest';
import { choose, declareAttack, passPriorityPair, resolveByPassing } from '../helpers/card-test-cases';
import { giantRitual, regularGiantCast } from '../helpers/blue-ritual-card-case';

const rituals = [true, false].map(draw => {
  const ritual = giantRitual(3, (engine, source) => {
    passPriorityPair(engine);
    choose(engine, [draw ? 'yes' : 'no']);
    expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(draw ? ['first', 'second'] : []);
    declareAttack(engine, source.uuid);
    resolveByPassing(engine);
    expect(engine.roomState.players.player2.graveyard.map(card => card.uuid)).toEqual(['enemy-10', 'enemy-9', 'enemy-8', 'enemy-7']);
  });
  return {
    ...ritual,
    name: ritual.name + `, offers two cards (draw: ${draw}), and mills four on attack`,
    covers: ['ability:ritual', 'ability:special-summon-draw', 'ability:attack-mill'],
  };
});

export default [regularGiantCast(2), ...rituals];
