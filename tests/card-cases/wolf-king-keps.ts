import { expect } from 'vitest';
import { castWithPayment, chooseTarget, fixtureCard, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [true, false].map(protectedTarget => ({
  name: `entry draws only if the selected creature was destroyed (${protectedTarget ? 'indestructible' : 'ordinary'})`,
  covers: ['play', 'ability:entry-destroy-draw'],
  prepare(room) {
    room.battlefield = [
      fixtureCard('target', 'player2', 'battlefield', { keywords: protectedTarget ? ['Indestructible'] : [] }),
      fixtureCard('relic', 'player2', 'battlefield', { cardTypes: ['Artifact'] }),
      fixtureCard('land', 'player2', 'battlefield', { cardTypes: ['Land'] }),
      fixtureCard('ally', 'player1', 'battlefield'),
    ];
    room.players.player1.deck = [fixtureCard('draw', 'player1', 'library')];
  },
  run(engine, source) {
    castWithPayment(engine, source, { red: 2 });
    resolveByPassing(engine);
    chooseTarget(engine, 'target', ['target', 'relic']);
    resolveByPassing(engine);
    expect(engine.roomState.battlefield.some(card => card.uuid === 'target')).toBe(protectedTarget);
    expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(protectedTarget ? [] : ['draw']);
  },
}) satisfies CardCase);
