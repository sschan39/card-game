import { expect } from 'vitest';
import { castWithPayment, choose, fixtureCard, passPriorityPair, permanent, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [3, 4].map(handSize => ({
  name: `deploys a free land and offers up to one Creature per printed Wind Spirit name with ${handSize} cards left in hand`,
  covers: ['play', 'ability:blade-wolf-entry'],
  prepare(room) {
    room.players.player1.hand.push(fixtureCard('land', 'player1', 'hand', { cardTypes: ['Land'] }),
      ...Array.from({ length: handSize }, (_, i) => fixtureCard(`hand-${i}`, 'player1', 'hand')));
    room.players.player1.deck = [
      fixtureCard('deep', 'player1', 'library', { name: '風靈 Deep' }),
      fixtureCard('duplicate-1', 'player1', 'library', { name: '風靈 One' }),
      fixtureCard('duplicate-2', 'player1', 'library', { name: '風靈 One' }),
      fixtureCard('distinct', 'player1', 'library', { name: '風靈 Two' }),
      fixtureCard('spell', 'player1', 'library', { name: '風靈 Spell', cardTypes: ['Spell'] }),
      fixtureCard('other', 'player1', 'library'),
    ];
  },
  run(engine, source) {
    castWithPayment(engine, source, { green: 2 });
    resolveByPassing(engine);
    const player = () => engine.roomState.players.player1;
    const initialDeck = player().deck.map(card => card.uuid);
    const mana = { ...player().mana };
    passPriorityPair(engine);
    choose(engine, ['land']);
    expect(permanent(engine, 'land').state.summonKind).toBe('effect');
    expect(player().mana).toEqual(mana);
    expect(engine.roomState.turnHistory?.landPlays.player1 ?? 0).toBe(0);
    if (handSize === 3) {
      choose(engine, ['reveal']);
      const choice = engine.roomState.pendingChoice;
      if (choice?.kind !== 'search') throw new Error('Expected the distinct name search');
      expect(choice.max).toBe(2);
      expect(choice.options.map(option => option.id).sort()).toEqual(['distinct', 'duplicate-1', 'duplicate-2']);
      expect(engine.executePlayerAction('player1', 'choose', { choiceId: choice.id, choices: ['duplicate-1', 'duplicate-2'] }).success).toBe(false);
      choose(engine, ['duplicate-2', 'distinct']);
      choose(engine, ['spell', 'duplicate-1', 'other']);
      expect(player().hand.slice(-2).map(card => card.uuid)).toEqual(['duplicate-2', 'distinct']);
      expect(player().deck.map(card => card.uuid)).toEqual(['other', 'duplicate-1', 'spell', 'deep']);
    } else {
      expect(player().hand).toHaveLength(4);
      expect(player().deck.map(card => card.uuid)).toEqual(initialDeck);
    }
    expect(engine.roomState.pendingChoice).toBeFalsy();
    expect(engine.roomState.stack).toEqual([]);
  },
}) satisfies CardCase);
