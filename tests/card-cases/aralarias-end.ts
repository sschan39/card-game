import { expect } from 'vitest';
import { act, choose, fixtureCard, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'exiles only a charged friendly Emperor, destroys eligible opposing permanents and spends its once-per-game use',
  covers: ['play', 'additional cost', 'cast effects'],
  prepare(room) {
    const emperor = (id: string, owner: string, charge: number) => {
      const card = fixtureCard(id, owner, 'battlefield', { name: '天使皇 亞拉里亞', cardTypes: ['Land'] });
      card.state.counters.charge = charge;
      return card;
    };
    room.battlefield = [emperor('charged', 'player1', 5), emperor('low', 'player1', 4), emperor('opposing', 'player2', 8),
      fixtureCard('wrong-name', 'player1', 'battlefield', { cardTypes: ['Land'] }),
      fixtureCard('ally', 'player1', 'battlefield'), fixtureCard('enemy', 'player2', 'battlefield'),
      fixtureCard('relic', 'player2', 'battlefield', { cardTypes: ['Artifact'] }),
      fixtureCard('gear', 'player2', 'battlefield', { cardTypes: ['Artifact'], subTypes: ['Equipment'] })];
  },
  run(engine, source) {
    act(engine, 'cast_spell', { cardUuid: source.uuid });
    const materials = engine.roomState.pendingChoice;
    if (materials?.kind !== 'selection') throw new Error('Expected an exile material choice');
    expect(materials.options.map(option => option.id)).toEqual(['charged']);
    expect(engine.roomState.players.player1.mana.yellow).toBe(5);
    choose(engine, ['charged']);
    expect(engine.roomState.players.player1.exile?.map(card => card.uuid)).toEqual(['charged']);
    expect(engine.roomState.players.player1.mana.yellow).toBe(1);
    resolveByPassing(engine);
    expect(engine.roomState.players.player2.graveyard.map(card => card.uuid).sort()).toEqual(['enemy', 'relic']);
    expect(engine.roomState.battlefield.map(card => card.uuid).sort()).toEqual(['ally', 'gear', 'low', 'opposing', 'wrong-name']);
    engine.applyMutations([
      { type: 'ADD_COUNTER', cardUuid: 'low', counterType: 'charge', amount: 1 },
      { type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'graveyard', to: 'hand' },
    ]);
    engine.roomState.players.player1.mana.yellow = 5;
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: source.uuid }).success).toBe(false);
    expect(engine.roomState.players.player1.mana.yellow).toBe(5);
  },
}] satisfies CardCase[];
