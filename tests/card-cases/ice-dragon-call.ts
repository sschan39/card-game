import { expect } from 'vitest';
import { castWithPayment, choose, fixtureCard, passPriorityPair, type CardCase } from '../helpers/card-test-cases';

export default (['none', 'opposing', 'two-friendly'] as const).map(situation => ({
  name: `reveals a fresh second window at most once and only with a friendly Ice Dragon (${situation})`,
  covers: ['play', 'cast effects'],
  prepare(room) {
    const dragon = { subTypes: ['冰龍'] };
    const controllers = situation === 'two-friendly' ? ['player1', 'player1'] : situation === 'opposing' ? ['player2'] : [];
    room.battlefield = controllers.map((owner, index) => fixtureCard('dragon-' + index, owner, 'battlefield', dragon));
    room.players.player1.deck = ['deep', 'second', 'spare', 'first-bottom', 'first', 'first-top'].map(id =>
      fixtureCard(id, 'player1', 'library', id === 'first' || id === 'second' ? dragon : {}));
  },
  run(engine, source) {
    castWithPayment(engine, source, { white: 2 });
    passPriorityPair(engine);
    const select = (id: string) => {
      const choice = engine.roomState.pendingChoice;
      if (choice?.kind !== 'search') throw new Error('Expected an Ice Dragon selection');
      expect(choice.options.map(option => option.id)).toEqual([id]);
      choose(engine, [id]);
    };
    select('first');
    choose(engine, ['first-top', 'first-bottom']);
    const repeat = situation === 'two-friendly';
    if (repeat) {
      select('second');
      choose(engine, ['spare', 'deep']);
    }
    expect(engine.roomState.pendingChoice).toBeFalsy();
    expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(repeat ? ['first', 'second'] : ['first']);
    const revealed = engine.drainEventBatches().flatMap(batch => batch.events)
      .filter(event => event.eventId === 'CARD_REVEALED').map(event => event.payload.card.uuid);
    expect(revealed).toEqual(repeat ? ['first-top', 'first', 'first-bottom', 'spare', 'second', 'deep'] : ['first-top', 'first', 'first-bottom']);
  },
}) satisfies CardCase);
