import { expect } from 'vitest';
import { castWithPayment, chooseTarget, fixtureCard, permanent, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'each friendly Ice Dragon yields a separate entry shot, then Arthur deals half the actual creature damage to the opponent',
  covers: ['play', 'ability:arthur-summon-volley', 'ability:arthur-creature-damage'],
  prepare(room) {
    room.battlefield = [
      fixtureCard('ally', 'player1', 'battlefield', { subTypes: ['冰龍'] }),
      fixtureCard('ordinary', 'player1', 'battlefield'),
      fixtureCard('enemy-dragon', 'player2', 'battlefield', { subTypes: ['冰龍'] }),
      fixtureCard('first', 'player2', 'battlefield', { toughness: 10 }),
      fixtureCard('second', 'player2', 'battlefield', { toughness: 10 }),
    ];
    room.replacementEffects = [{
      id: 'reduce', label: 'Reduce the second hit by two',
      match: { kinds: ['damage'], card: { cardUuid: 'second', zoneRevision: 0 } },
      operation: { type: 'reduce_damage', amount: 2 },
    }];
  },
  run(engine, source) {
    castWithPayment(engine, source, { white: 3, red: 2 });
    resolveByPassing(engine);
    for (const id of ['first', 'second']) chooseTarget(engine, id, ['first', 'second', 'enemy-dragon']);
    expect(engine.roomState.pendingChoice).toBeFalsy();
    expect(engine.roomState.stack.map(item => item.targetGroups?.[0].targets[0].cardUuid)).toEqual(['first', 'second']);
    resolveByPassing(engine);
    expect(permanent(engine, 'second').state.damageTaken).toBe(3);
    resolveByPassing(engine);
    expect(engine.roomState.players.player2.life).toBe(19);
    resolveByPassing(engine);
    expect(permanent(engine, 'first').state.damageTaken).toBe(5);
    resolveByPassing(engine);
    expect(engine.roomState.players.player2.life).toBe(17);
    expect(engine.roomState.stack).toEqual([]);
  },
}] satisfies CardCase[];
