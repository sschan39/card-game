import { expect } from 'vitest';
import type { CardBlueprint } from '@shared/card.types';
import { castWithPayment, choose, declareAttack, fixtureCard, passPriorityPair, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default (['recover', 'ineligible', 'decline'] as const).map(decision => ({
  name: `may mill on entry and attack, offering only the eligible card each trigger actually mills (${decision})`,
  covers: ['play', 'ability:ghostfire-entry', 'ability:ghostfire-attack'],
  prepare(room) {
    const spell: Partial<CardBlueprint> = { colors: ['black'], cardTypes: ['Spell'] };
    room.players.player1.graveyard = [fixtureCard('older-spell', 'player1', 'graveyard', spell)];
    room.players.player1.deck = ['deeper', 'attack-top', 'entry-top'].map(id =>
      fixtureCard(id, 'player1', 'library', { ...spell, colors: [decision === 'ineligible' ? 'red' : 'black'] }));
  },
  run(engine, source) {
    const player = () => engine.roomState.players.player1;
    const checkMill = (uuid: string) => {
      passPriorityPair(engine);
      expect(engine.roomState.pendingChoice?.kind).toBe('optional');
      choose(engine, [decision === 'decline' ? 'no' : 'yes']);
      if (decision === 'recover') {
        const choice = engine.roomState.pendingChoice;
        if (choice?.kind !== 'search') throw new Error('Expected a recovery choice');
        expect(choice.options.map(option => option.id)).toEqual([uuid]);
        choose(engine, [uuid]);
      }
      expect(engine.roomState.pendingChoice).toBeFalsy();
    };
    castWithPayment(engine, source, { black: 2, red: 1 });
    resolveByPassing(engine);
    checkMill('entry-top');
    declareAttack(engine, source.uuid);
    checkMill('attack-top');
    expect(player().deck.map(card => card.uuid)).toEqual(decision === 'decline' ? ['deeper', 'attack-top', 'entry-top'] : ['deeper']);
    expect(player().hand.map(card => card.uuid)).toEqual(decision === 'recover' ? ['entry-top', 'attack-top'] : []);
    expect(player().graveyard.map(card => card.uuid)).toEqual(decision === 'ineligible' ? ['older-spell', 'entry-top', 'attack-top'] : ['older-spell']);
  },
}) satisfies CardCase);
