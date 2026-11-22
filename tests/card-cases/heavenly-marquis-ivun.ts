import { expect } from 'vitest';
import { castWithPayment, fixtureCard, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'claims the spells among the top eight, exiles the rest and cannot repeat after reentry',
  covers: ['play', 'ability:ivun-reveal'],
  prepare(room) {
    room.players.player1.deck = [
      fixtureCard('outside', 'player1', 'library', { cardTypes: ['Spell'] }),
      ...Array.from({ length: 8 }, (_, index) =>
        fixtureCard(`reveal-${index}`, 'player1', 'library', { cardTypes: [index % 2 ? 'Spell' : 'Creature'] })),
    ];
  },
  run(engine, source) {
    castWithPayment(engine, source, { yellow: 2, red: 1 });
    resolveByPassing(engine);
    resolveByPassing(engine);
    const player = () => engine.roomState.players.player1;
    expect(player().hand.map(card => card.uuid).sort()).toEqual(['reveal-1', 'reveal-3', 'reveal-5', 'reveal-7']);
    expect(player().exile?.map(card => card.uuid).sort()).toEqual(['reveal-0', 'reveal-2', 'reveal-4', 'reveal-6']);
    expect(player().deck.map(card => card.uuid)).toEqual(['outside']);
    engine.applyMutations([
      { type: 'MOVE_CARD', playerId: 'player1', cardUuid: source.uuid, from: 'battlefield', to: 'hand' },
      { type: 'MOVE_CARD', playerId: 'player1', cardUuid: source.uuid, from: 'hand', to: 'battlefield' },
    ]);
    expect(engine.roomState.stack).toEqual([]);
    expect(player().deck.map(card => card.uuid)).toEqual(['outside']);
  },
}] satisfies CardCase[];
