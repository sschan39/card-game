import { expect } from 'vitest';
import { castWithPayment, choose, fixtureCard, passPriorityPair, permanent, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default (['deploy and reveal', 'decline deployment', 'cast and skip'] as const).map(action => ({
  name: `answers a friendly marked creature leaving, then can claim an Ice Dragon creature and cold relic (${action})`,
  covers: ['ability:answer-aurora-departure', 'ability:guide-entry-reveal', ...(action === 'cast and skip' ? ['play'] : [])],
  prepare(room) {
    const marked = fixtureCard('marked', 'player1', 'battlefield');
    const opposing = fixtureCard('opposing', 'player2', 'battlefield');
    marked.state.counters.aurora = 1;
    opposing.state.counters.aurora = 1;
    room.battlefield = [marked, opposing, fixtureCard('unmarked', 'player1', 'battlefield')];
    room.players.player1.deck = [
      fixtureCard('deep', 'player1', 'library', { subTypes: ['冰龍'] }),
      fixtureCard('cold-relic', 'player1', 'library', { cardTypes: ['Artifact'], colors: ['white'] }),
      fixtureCard('equipment', 'player1', 'library', { cardTypes: ['Artifact'], subTypes: ['Equipment', '冰龍'], colors: ['white'] }),
      fixtureCard('dragon', 'player1', 'library', { subTypes: ['冰龍'] }),
    ];
  },
  run(engine, source) {
    const player = () => engine.roomState.players.player1;
    const initialDeck = player().deck.map(card => card.uuid);
    const exile = (cardUuid: string, playerId = 'player1') => engine.applyMutations([
      { type: 'MOVE_CARD', cardUuid, playerId, from: 'battlefield', to: 'exile' },
    ]);
    if (action === 'cast and skip') {
      castWithPayment(engine, source, { white: 3 });
      resolveByPassing(engine);
      expect(permanent(engine, source.uuid).state.summonKind).toBe('cast');
    } else {
      exile('unmarked');
      exile('opposing', 'player2');
      expect(engine.roomState.stack).toEqual([]);
      exile('marked');
      passPriorityPair(engine);
      choose(engine, [action === 'decline deployment' ? 'no' : 'yes']);
    }
    if (action === 'deploy and reveal') expect(permanent(engine, source.uuid).state.summonKind).toBe('effect');
    if (action !== 'decline deployment') {
      passPriorityPair(engine);
      choose(engine, [action === 'cast and skip' ? 'skip' : 'reveal']);
    }
    if (action === 'deploy and reveal') {
      for (const id of ['dragon', 'cold-relic']) {
        const choice = engine.roomState.pendingChoice;
        if (choice?.kind !== 'search') throw new Error('Expected the category choice');
        expect(choice.options.map(option => option.id)).toEqual([id]);
        choose(engine, [id]);
      }
      choose(engine, ['equipment']);
    }
    expect(player().hand.map(card => card.uuid)).toEqual(action === 'deploy and reveal' ? ['dragon', 'cold-relic'] : action === 'decline deployment' ? [source.uuid] : []);
    expect(player().deck.map(card => card.uuid)).toEqual(action === 'deploy and reveal' ? ['equipment', 'deep'] : initialDeck);
    expect(engine.roomState.stack).toEqual([]);
  },
}) satisfies CardCase);
