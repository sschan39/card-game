import { expect } from 'vitest';
import { castWithPayment, fixtureCard, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

const discardCases = (['hand', 'library'] as const).map(zone => ({
  name: `makes one blue when discarded from the ${zone}`,
  covers: [`ability:discard-from-${zone}`],
  prepare(room) {
    if (zone === 'library') {
      const [source] = room.players.player1.hand.splice(0, 1);
      source.state.zone = zone;
      room.players.player1.deck.push(source);
    }
  },
  run(engine, source) {
    const before = engine.roomState.players.player1.mana.blue;
    engine.applyMutations([{ type: 'MOVE_CARD', playerId: 'player1', cardUuid: source.uuid, from: zone, to: 'graveyard', reason: 'discard' }]);
    resolveByPassing(engine);
    expect(engine.roomState.players.player1.mana.blue).toBe(before + 1);
    expect(engine.roomState.players.player1.graveyard.map(card => card.uuid)).toEqual([source.uuid]);
  },
}) satisfies CardCase);

export default [...discardCases, {
  name: 'mills the opponent’s top three on entry without producing any mana',
  covers: ['play', 'ability:entry-mill'],
  prepare(room) {
    room.players.player2.deck = ['bottom', 'third', 'second', 'first'].map(id => fixtureCard(id, 'player2', 'library'));
  },
  run(engine, source) {
    const before = engine.roomState.players.player1.mana.blue;
    castWithPayment(engine, source, { blue: 1, red: 1 });
    resolveByPassing(engine);
    resolveByPassing(engine);
    const { player1, player2 } = engine.roomState.players;
    expect(player2.deck.map(card => card.uuid)).toEqual(['bottom']);
    expect(player2.graveyard.map(card => card.uuid)).toEqual(['first', 'second', 'third']);
    expect(player1.mana.blue).toBe(before - 1);
  },
}] satisfies CardCase[];
