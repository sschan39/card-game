import { expect } from 'vitest';
import { castWithPayment, choose, fixtureCard, passPriorityPair, permanent, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default (['land', 'relic', 'decline'] as const).map(selection => ({
  name: `reveals five, can deploy a land or relic for free, and orders the remainder (${selection})`,
  covers: ['play', 'ability:hornblower-entry'],
  prepare(room) {
    room.players.player1.deck = [
      fixtureCard('deep', 'player1', 'library', { cardTypes: ['Land'] }),
      fixtureCard('land', 'player1', 'library', { cardTypes: ['Land'] }),
      fixtureCard('relic', 'player1', 'library', { cardTypes: ['Artifact'] }),
      fixtureCard('equipment', 'player1', 'library', { cardTypes: ['Artifact'], subTypes: ['Equipment'] }),
      fixtureCard('spell', 'player1', 'library', { cardTypes: ['Spell'] }),
      fixtureCard('creature', 'player1', 'library'),
    ];
  },
  run(engine, source) {
    castWithPayment(engine, source, { green: 2 });
    resolveByPassing(engine);
    const mana = { ...engine.roomState.players.player1.mana };
    passPriorityPair(engine);
    const choice = engine.roomState.pendingChoice;
    if (choice?.kind !== 'search') throw new Error('Expected a land or relic deployment choice');
    expect(choice.options.map(option => option.id).sort()).toEqual(['land', 'relic']);
    choose(engine, selection === 'decline' ? [] : [selection]);
    if (selection !== 'decline') expect(permanent(engine, selection).state.summonKind).toBe('effect');
    expect(engine.roomState.players.player1.mana).toEqual(mana);
    expect(engine.roomState.turnHistory?.landPlays.player1 ?? 0).toBe(0);
    const rest = ['land', 'relic', 'equipment', 'spell', 'creature'].filter(id => id !== selection);
    choose(engine, rest);
    expect(engine.roomState.players.player1.deck.map(card => card.uuid)).toEqual([...rest.toReversed(), 'deep']);
  },
}) satisfies CardCase);
