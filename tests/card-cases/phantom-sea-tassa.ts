import { expect } from 'vitest';
import { castWithPayment, choose, fixtureCard, passPriorityPair, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default (['take', 'no giant', 'decline'] as const).map(result => ({
  name: `may reveal exactly six, keeping one differently named Giant and discarding the rest (${result})`,
  covers: ['play', 'ability:reveal-giant'],
  prepare(room) {
    const giant = { subTypes: ['蒼巨人'] };
    room.players.player1.deck = [
      fixtureCard('outside', 'player1', 'library', giant),
      fixtureCard('candidate', 'player1', 'library', result === 'no giant' ? {} : giant),
      fixtureCard('other-tassa', 'player1', 'library', { ...giant, name: '幻海人 塔薩' }),
      ...['rest-1', 'rest-2', 'rest-3', 'rest-4'].map(id => fixtureCard(id, 'player1', 'library')),
    ];
  },
  run(engine, source) {
    castWithPayment(engine, source, { blue: 1, red: 1 });
    resolveByPassing(engine);
    passPriorityPair(engine);
    choose(engine, [result === 'decline' ? 'no' : 'yes']);
    if (result === 'take') {
      const choice = engine.roomState.pendingChoice;
      if (choice?.kind !== 'search') throw new Error('Expected a Giant reveal choice');
      expect(choice.options.map(option => option.id)).toEqual(['candidate']);
      choose(engine, ['candidate']);
    }
    expect(engine.roomState.pendingChoice).toBeFalsy();
    const player = engine.roomState.players.player1;
    const rest = ['rest-4', 'rest-3', 'rest-2', 'rest-1', 'other-tassa'];
    expect(player.hand.map(card => card.uuid)).toEqual(result === 'take' ? ['candidate'] : []);
    expect(player.graveyard.map(card => card.uuid)).toEqual(result === 'decline' ? [] : result === 'take' ? rest : [...rest, 'candidate']);
    expect(player.deck.map(card => card.uuid)).toEqual(result === 'decline' ? ['outside', 'candidate', ...rest.toReversed()] : ['outside']);
  },
}) satisfies CardCase);
