import { expect } from 'vitest';
import { castWithPayment, chooseTarget, declareAttack, fixtureCard, permanent, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [true, false].map(flameBeast => ({
  name: `destroys one tied lowest-health enemy on entry and places three Scorch on a qualifying attack (${flameBeast})`,
  covers: ['play', 'ability:entry-lowest-health-destroy', 'ability:flamebeast-attack-scorch-three'],
  prepare(room) {
    const first = fixtureCard('first', 'player2', 'battlefield', { toughness: 8 });
    const second = fixtureCard('second', 'player2', 'battlefield', { toughness: 6 });
    first.state.damageTaken = 5;
    second.state.damageTaken = 3;
    room.battlefield = [
      first, second, fixtureCard('third', 'player2', 'battlefield', { toughness: 5 }),
      fixtureCard('attacker', 'player1', 'battlefield', { toughness: 1, subTypes: flameBeast ? ['炎獸'] : [] }),
      fixtureCard('relic', 'player2', 'battlefield', { cardTypes: ['Artifact'] }),
      fixtureCard('equipment', 'player2', 'battlefield', { cardTypes: ['Artifact'], subTypes: ['Equipment'] }),
    ];
  },
  run(engine, source) {
    castWithPayment(engine, source, { red: 3 });
    resolveByPassing(engine);
    chooseTarget(engine, 'second', ['first', 'second']);
    resolveByPassing(engine);
    expect(engine.roomState.players.player2.graveyard.map(card => card.uuid)).toEqual(['second']);
    declareAttack(engine, 'attacker');
    if (flameBeast) {
      chooseTarget(engine, 'third', ['first', 'third', 'relic']);
      resolveByPassing(engine);
    }
    expect(engine.roomState.stack).toEqual([]);
    expect(engine.roomState.pendingChoice).toBeFalsy();
    expect(permanent(engine, 'third').state.counters.scorch ?? 0).toBe(flameBeast ? 3 : 0);
  },
}) satisfies CardCase);
