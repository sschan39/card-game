import { expect } from 'vitest';
import { act, castWithPayment, chooseTarget, fixtureCard, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [
  {
    name: 'can be cast for two red as a 2/2 creature',
    covers: ['play'],
    run(engine, source) {
      castWithPayment(engine, source, { red: 2 });
      resolveByPassing(engine);
      expect(engine.roomState.battlefield.find(card => card.uuid === source.uuid)?.blueprint).toMatchObject({ power: 2, toughness: 2 });
    },
  },
  ...[true, false].map(indestructible => ({
    name: indestructible ? 'draws after a legal target survives destruction' : 'from hand, only targets and destroys an opposing effect-summoned creature',
    covers: ['ability:discard-destroy'],
    prepare(room) {
      const target = fixtureCard('target', 'player2', 'battlefield', { keywords: indestructible ? ['Indestructible'] : [] });
      const other = fixtureCard('ordinary', 'player2', 'battlefield');
      const ally = fixtureCard('ally', 'player1', 'battlefield');
      target.state.summonKind = 'effect';
      other.state.summonKind = 'cast';
      ally.state.summonKind = 'effect';
      room.battlefield = [target, other, ally];
      room.activeTurnPlayerId = 'player2';
      room.players.player1.deck = [fixtureCard('draw', 'player1', 'library')];
    },
    run(engine, source) {
      act(engine, 'activate_ability', { cardUuid: source.uuid, abilityId: 'discard-destroy' });
      chooseTarget(engine, 'target', ['target']);
      expect(engine.roomState.players.player1.graveyard.map(card => card.uuid)).toEqual([source.uuid]);
      resolveByPassing(engine);
      expect(engine.roomState.battlefield.some(card => card.uuid === 'target')).toBe(indestructible);
      expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(['draw']);
    },
  }) satisfies CardCase),
] satisfies CardCase[];
