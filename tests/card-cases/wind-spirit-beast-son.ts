import { expect } from 'vitest';
import { CardCharacteristicService as stats } from '@engine/card-characteristic-service';
import { castWithPayment, choose, chooseTarget, fixtureCard, passPriorityPair, permanent, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [true, false].map(freeze => ({
  name: `counts its own Wind Beast name and may tap an enemy through one natural untap (freeze: ${freeze})`,
  covers: ['play', 'ability:tap-and-freeze', 'ability:beast-power'],
  prepare(room) {
    room.battlefield = [
      fixtureCard('enemy', 'player2', 'battlefield'),
      fixtureCard('ally', 'player1', 'battlefield'),
      fixtureCard('artifact', 'player2', 'battlefield', { cardTypes: ['Artifact'] }),
    ];
  },
  run(engine, source) {
    castWithPayment(engine, source, { green: 1, red: 1 });
    resolveByPassing(engine);
    chooseTarget(engine, 'enemy', ['enemy']);
    passPriorityPair(engine);
    choose(engine, [freeze ? 'yes' : 'no']);
    expect(stats.resolve(engine.roomState, permanent(engine, source.uuid))).toMatchObject({ power: 3, toughness: 4 });
    const tapped = () => permanent(engine, 'enemy').state.isTapped;
    expect(tapped()).toBe(freeze);
    if (freeze) {
      const naturalUntap = { type: 'UNTAP_CARD', cardUuid: 'enemy', natural: true } as const;
      engine.applyMutations([naturalUntap]);
      expect(tapped()).toBe(true);
      engine.applyMutations([naturalUntap]);
      expect(tapped()).toBe(false);
    }
  },
}) satisfies CardCase);
