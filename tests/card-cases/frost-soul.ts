import { expect } from 'vitest';
import { castWithPayment, choose, passPriorityPair, resolveByPassing, type CardCase } from '../helpers/card-test-cases';
import { creature } from '../helpers/combat-fixture';

export default (['opposing', 'accept', 'decline'] as const).map(situation => ({
  name: `entry draw with Aurora on ${situation === 'opposing' ? 'an opposing Dragon' : 'a friendly Dragon, ' + situation}`,
  covers: ['play', 'ability:aurora-entry-draw'],
  prepare(room) {
    const dragon = creature('marked-dragon', situation === 'opposing' ? 'player2' : 'player1');
    dragon.blueprint = { ...dragon.blueprint, subTypes: ['冰龍'] };
    dragon.state.counters.aurora = 1;
    room.battlefield = [dragon];
    const card = creature('draw-me', 'player1');
    card.state.zone = 'library';
    room.players.player1.deck.push(card);
  },
  run(engine, source) {
    castWithPayment(engine, source, { white: 1 });
    resolveByPassing(engine);
    expect(engine.roomState.battlefield.find(card => card.uuid === source.uuid)?.blueprint).toMatchObject({ power: 1, toughness: 1 });
    if (situation === 'opposing') {
      expect(engine.roomState.stack).toHaveLength(0);
    } else {
      passPriorityPair(engine);
      expect(engine.roomState.pendingChoice?.kind).toBe('optional');
      choose(engine, [situation === 'accept' ? 'yes' : 'no']);
    }
    expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(situation === 'accept' ? ['draw-me'] : []);
    expect(engine.roomState.players.player1.deck).toHaveLength(situation === 'accept' ? 0 : 1);
  },
}) satisfies CardCase);
