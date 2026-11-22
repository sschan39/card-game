import { expect } from 'vitest';
import { castWithPayment, chooseTarget, declareAttack, fixtureCard, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'places two Scorch independently on entry, attack and destruction',
  covers: ['play', 'ability:entry-scorch-two', 'ability:attack-scorch-two', 'ability:destroy-scorch-two'],
  prepare(room) {
    room.battlefield = [
      fixtureCard('enemy', 'player2', 'battlefield', { toughness: 8 }),
      fixtureCard('ally', 'player1', 'battlefield'),
      fixtureCard('gear', 'player2', 'battlefield', { cardTypes: ['Artifact'], subTypes: ['Equipment'] }),
    ];
  },
  run(engine, source) {
    const applyScorch = (expected: number) => {
      chooseTarget(engine, 'enemy', ['enemy']);
      resolveByPassing(engine);
      expect(engine.roomState.battlefield.find(card => card.uuid === 'enemy')?.state.counters.scorch).toBe(expected);
    };
    castWithPayment(engine, source, { red: 2, white: 1 });
    resolveByPassing(engine);
    applyScorch(2);
    declareAttack(engine, source.uuid);
    applyScorch(4);
    const live = engine.roomState.battlefield.find(card => card.uuid === source.uuid);
    if (!live) throw new Error('Expected Chiron on the battlefield');
    engine.applyMutations([{ type: 'DESTROY_CARD', cardUuid: source.uuid, zoneRevision: live.state.zoneRevision ?? 0 }]);
    expect(engine.roomState.players.player1.graveyard.some(card => card.uuid === source.uuid)).toBe(true);
    applyScorch(6);
  },
}] satisfies CardCase[];
