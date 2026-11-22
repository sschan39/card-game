import { expect } from 'vitest';
import { CardCharacteristicService as stats } from '@engine/card-characteristic-service';
import { castWithPayment, chooseTarget, declareAttack, fixtureCard, permanent, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [3, 6].map(toughness => ({
  name: `permanently reduces an opposing target by three and gains attack only on a kill (${toughness} life)`,
  covers: ['play', 'ability:ghostaxe-attack'],
  prepare(room) {
    room.battlefield = [
      fixtureCard('target', 'player2', 'battlefield', { toughness }),
      fixtureCard('ally', 'player1', 'battlefield', { toughness: 3 }),
      fixtureCard('artifact', 'player2', 'battlefield', { cardTypes: ['Artifact'] }),
    ];
  },
  run(engine, source) {
    castWithPayment(engine, source, { black: 2, red: 1 });
    resolveByPassing(engine);
    const power = () => stats.resolvePower(engine.roomState, permanent(engine, source.uuid));
    declareAttack(engine, source.uuid);
    chooseTarget(engine, 'target', ['target']);
    resolveByPassing(engine);
    expect(power()).toBe(toughness === 3 ? 4 : 2);
    expect(engine.roomState.players.player2.graveyard.map(card => card.uuid)).toEqual(toughness === 3 ? ['target'] : []);
    engine.applyMutations([{ type: 'CLEAR_END_OF_TURN_EFFECTS' }]);
    expect(power()).toBe(2);
    if (toughness === 6) expect(stats.resolveToughness(engine.roomState, permanent(engine, 'target'))).toBe(3);
    expect(stats.resolveToughness(engine.roomState, permanent(engine, 'ally'))).toBe(3);
  },
}) satisfies CardCase);
