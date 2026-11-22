import { expect } from 'vitest';
import { castWithPayment, choose, fixtureCard, passPriorityPair, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'finds an eligible Swift Spirit at the bottom, then shuffles the library',
  covers: ['play', 'cast effects'],
  prepare(room) {
    room.players.player1.deck = [
      fixtureCard('eligible', 'player1', 'library', { subTypes: ['迅靈'] }),
      fixtureCard('ordinary', 'player1', 'library'),
      fixtureCard('only-the-subtype', 'player1', 'library', { cardTypes: ['Artifact'], subTypes: ['迅靈'] }),
      fixtureCard('top', 'player1', 'library'),
      fixtureCard('next', 'player1', 'library'),
    ];
  },
  run(engine, source) {
    castWithPayment(engine, source, { green: 2 });
    passPriorityPair(engine);
    const choice = engine.roomState.pendingChoice;
    if (choice?.kind !== 'search') throw new Error('Expected a library search');
    expect(choice.options.map(option => option.id)).toEqual(['eligible']);
    choose(engine, ['eligible']);
    expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(['eligible']);
    expect(engine.roomState.players.player1.deck.map(card => card.uuid).sort()).toEqual(['next', 'only-the-subtype', 'ordinary', 'top']);
    const events = engine.drainEventBatches().flatMap(batch => batch.events);
    expect(events.some(event => event.eventId === 'LIBRARY_SHUFFLED')).toBe(true);
    expect(events.filter(event => event.eventId === 'STACK_ITEM_RESOLVED').map(event => event.payload.effectId))
      .toEqual(['MOVE_ZONE', 'SHUFFLE']);
  },
}] satisfies CardCase[];
