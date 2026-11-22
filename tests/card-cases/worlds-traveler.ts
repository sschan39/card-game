import { expect } from 'vitest';
import { act, castWithPayment, resolveByPassing, type CardCase } from '../helpers/card-test-cases';
import { creature } from '../helpers/combat-fixture';

export default [{
  name: 'tap-to-draw enters the stack and draws only after both players pass',
  covers: ['play', 'ability:tap-draw'],
  prepare(room) {
    const card = creature('draw-me', 'player1');
    card.state.zone = 'library';
    room.players.player1.deck.push(card);
  },
  run(engine, source) {
    castWithPayment(engine, source, { red: 2 });
    resolveByPassing(engine);
    const activate = { cardUuid: source.uuid, abilityId: 'tap-draw' };
    expect(engine.executePlayerAction('player1', 'activate_ability', activate).success).toBe(false);
    engine.applyMutations([{ type: 'SET_SUMMONING_SICKNESS', cardUuid: source.uuid, value: false }]);
    act(engine, 'activate_ability', activate);
    expect(engine.roomState.players.player1.hand).toHaveLength(0);
    expect(engine.roomState.stack).toHaveLength(1);
    resolveByPassing(engine);
    expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(['draw-me']);
    expect(engine.roomState.battlefield.find(card => card.uuid === source.uuid)?.state.isTapped).toBe(true);
    expect(engine.executePlayerAction('player1', 'activate_ability', activate).success).toBe(false);
  },
}] satisfies CardCase[];
