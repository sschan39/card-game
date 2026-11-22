import { expect } from 'vitest';
import { buildPlayerView } from '@server/projection/view-builder';
import { act, castWithPayment, fixtureCard, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'mills two, then pays two blue to reveal a hand card and lock its printed name until cleanup',
  covers: ['play', 'ability:entry-mill', 'ability:reveal-and-lock-name'],
  prepare(room) {
    room.players.player2.deck = ['bottom', 'second', 'first'].map(id => fixtureCard(id, 'player2', 'library'));
    room.players.player2.hand = ['shown', 'twin'].map(id => fixtureCard(id, 'player2', 'hand', { name: 'Locked Spell', cardTypes: ['Spell'] }));
  },
  run(engine, source) {
    castWithPayment(engine, source, { blue: 3 });
    resolveByPassing(engine);
    resolveByPassing(engine);
    expect(engine.roomState.players.player2.graveyard.map(card => card.uuid)).toEqual(['first', 'second']);
    expect(engine.roomState.players.player1.mana.blue).toBe(2);
    act(engine, 'activate_ability', { cardUuid: source.uuid, abilityId: 'reveal-and-lock-name', payment: { blue: 2 } });
    expect(engine.roomState.players.player1.mana.blue).toBe(0);
    resolveByPassing(engine);
    const view = () => buildPlayerView(engine.roomState, 'player1');
    expect(view().publicNameLocks).toEqual([{ name: 'Locked Spell', playerId: 'player2' }]);
    expect(view().observations?.active.flatMap(entry => entry.cards?.map(card => card.name) ?? [])).toEqual(['Locked Spell']);
    engine.roomState.activeTurnPlayerId = 'player2';
    engine.roomState.priorityPlayerId = 'player2';
    for (const cardUuid of ['shown', 'twin']) {
      expect(engine.executePlayerAction('player2', 'cast_spell', { cardUuid }).success).toBe(false);
    }
    engine.applyMutations([{ type: 'CLEAR_END_OF_TURN_EFFECTS' }]);
    expect(view().publicNameLocks).toBeUndefined();
    expect(view().observations?.active).toEqual([]);
    act(engine, 'cast_spell', { cardUuid: 'twin' }, 'player2');
    resolveByPassing(engine);
    expect(engine.roomState.players.player2.graveyard.map(card => card.uuid)).toEqual(['first', 'second', 'twin']);
  },
}] satisfies CardCase[];
