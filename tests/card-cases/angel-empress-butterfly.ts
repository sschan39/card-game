import { expect } from 'vitest';
import { instantiateCard } from '@library/card-factory';
import { castWithPayment, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

const emergency: CardCase[] = [true, false].map(replaced => ({
  name: `heals five only after the triggered hand discard succeeds (${replaced ? 'prevented' : 'discarded'})`,
  covers: ['ability:butterfly-emergency-heal'],
  prepare(room) {
    if (replaced) room.replacementEffects = [{
      id: 'prevent', label: 'Prevent discard', match: { kinds: ['discard'], from: 'hand' }, operation: { type: 'cancel_event' },
    }];
  },
  run(engine, source) {
    engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player2', amount: 17 }]);
    expect(engine.roomState.stack).toEqual([]);
    engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player1', amount: 17 }]);
    resolveByPassing(engine);
    const player = engine.roomState.players.player1;
    expect(player.life).toBe(replaced ? 17 : 22);
    expect(player.graveyard.map(card => card.uuid)).toEqual(replaced ? [] : [source.uuid]);
    expect(player.hand.map(card => card.uuid)).toEqual(replaced ? [source.uuid] : []);
  },
}));

export default [...emergency, {
  name: 'adds two to friendly healing effects and leaves direct life setting at the specified value',
  covers: ['play', 'ability:butterfly-healing-anthem'],
  requires: ['holy-energy-haste'],
  prepare(room) {
    const haste = instantiateCard('holy-energy-haste');
    haste.state = { ...haste.state, ownerId: 'player1', controllerId: 'player1', zone: 'hand' };
    room.players.player1.hand.push(haste);
  },
  run(engine, source) {
    castWithPayment(engine, source, { yellow: 3, red: 1 });
    resolveByPassing(engine);
    castWithPayment(engine, engine.roomState.players.player1.hand[0], { red: 1 }, { modes: ['heal'] });
    resolveByPassing(engine);
    expect(engine.roomState.players.player1.life).toBe(23);
    engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player1', amount: 30 }]);
    expect(engine.roomState.players.player1.life).toBe(30);
  },
}] satisfies CardCase[];
