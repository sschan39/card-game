import { expect } from 'vitest';
import { StateMachine } from '@engine/state-machine';
import { castWithPayment, choose, fixtureCard, passPriorityPair, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [true, false].map(buy => ({
  name: `offers a separate draw for two life after the ordinary draw (${buy ? 'paid' : 'declined'})`,
  covers: ['play', 'ability:buy-draw'],
  prepare(room) {
    room.players.player1.deck = ['extra', 'ordinary'].map(id => fixtureCard(id, 'player1', 'library'));
  },
  run(engine, source) {
    castWithPayment(engine, source, { black: 2 });
    resolveByPassing(engine);
    engine.roomState.phase = 'upkeepStep';
    engine.roomState.turnNumber = 2;
    engine.applyMutations(new StateMachine(engine.roomState).transition(engine.roomState, 'stateDrawPhase'));
    expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(['ordinary']);
    expect(engine.roomState.stack.at(-1)?.source.uuid).toBe(source.uuid);
    passPriorityPair(engine);
    choose(engine, [buy ? 'yes' : 'no']);
    expect(engine.roomState.players.player1.life).toBe(buy ? 18 : 20);
    expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(buy ? ['ordinary', 'extra'] : ['ordinary']);
  },
}) satisfies CardCase);
