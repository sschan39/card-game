import { expect } from 'vitest';
import { castWithPayment, resolveByPassing, type CardCase } from '../helpers/card-test-cases';
import { creature } from '../helpers/combat-fixture';

export default [{
  name: 'enters as a 2/2 after paying blue and mills exactly the opponent’s top two',
  covers: ['play', 'ability:entry-library-discard'],
  prepare(room) {
    for (const id of ['player1', 'player2']) {
      room.players[id].deck = ['bottom', 'middle', 'top'].map(label => {
        const card = creature(id + '-' + label, id);
        card.state.zone = 'library';
        return card;
      });
    }
  },
  run(engine, source) {
    castWithPayment(engine, source, { blue: 1 });
    resolveByPassing(engine);
    expect(engine.roomState.battlefield.find(card => card.uuid === source.uuid)?.blueprint).toMatchObject({ power: 2, toughness: 2 });
    resolveByPassing(engine);
    expect(engine.roomState.players.player2.deck.map(card => card.uuid)).toEqual(['player2-bottom']);
    expect(engine.roomState.players.player2.graveyard.map(card => card.uuid)).toEqual(['player2-top', 'player2-middle']);
    expect(engine.roomState.players.player1.deck).toHaveLength(3);
  },
}] satisfies CardCase[];
