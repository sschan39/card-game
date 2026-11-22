import { expect } from 'vitest';
import { captureSourceInformation } from '@engine/source-information';
import { act, castWithPayment, fixtureCard, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'friendly creatures resolve immediately, and two Wolves share one draw per friendly Scorch event',
  covers: ['play', 'ability:scorch-placement-draw'],
  prepare(room) {
    const duplicate = { ...structuredClone(room.players.player1.hand[0]), uuid: 'duplicate' };
    room.players.player1.hand.push(duplicate);
    room.players.player1.deck = ['second', 'first'].map(id => fixtureCard(id, 'player1', 'library'));
    room.battlefield = [fixtureCard('enemy', 'player2', 'battlefield', { power: 5, toughness: 6 })];
  },
  run(engine, source) {
    castWithPayment(engine, source, { red: 2 });
    resolveByPassing(engine);
    act(engine, 'cast_spell', { cardUuid: 'duplicate' });
    expect(engine.roomState.stack).toHaveLength(0);
    expect(engine.roomState.battlefield.some(card => card.uuid === 'duplicate')).toBe(true);
    const add = (cardUuid: string, from: string, amount: number, counterType: string) => {
      const actor = engine.roomState.battlefield.find(card => card.uuid === from)!;
      engine.applyMutations([{ type: 'ADD_COUNTER', cardUuid, counterType, amount,
        sourceControllerId: actor.state.controllerId, sourceInfo: captureSourceInformation(engine.roomState, actor) }]);
    };
    add('enemy', source.uuid, 3, 'scorch');
    expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(['first']);
    add(source.uuid, 'enemy', 1, 'scorch');
    add('enemy', source.uuid, 1, 'other');
    expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(['first']);
    add('enemy', 'duplicate', 1, 'scorch');
    expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(['first', 'second']);
    expect(engine.roomState.stack).toHaveLength(0);
  },
}] satisfies CardCase[];
