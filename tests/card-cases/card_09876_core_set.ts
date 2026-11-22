import { expect } from 'vitest';
import { CardCharacteristicService as stats } from '@engine/card-characteristic-service';
import { act, castWithPayment, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'casts a 5/5 with flying and each paid firebreathing grants +1 only through cleanup',
  covers: ['play', 'ability:firebreathing'],
  run(engine, source) {
    castWithPayment(engine, source, { red: 2, green: 4 });
    resolveByPassing(engine);
    const live = () => engine.roomState.battlefield.find(card => card.uuid === source.uuid)!;
    expect(live().blueprint).toMatchObject({ power: 5, toughness: 5, keywords: ['Flying'] });
    for (let activation = 0; activation < 2; activation++) {
      act(engine, 'activate_ability', { cardUuid: source.uuid, abilityId: 'firebreathing' });
      expect(stats.resolvePower(engine.roomState, live())).toBe(5 + activation);
      resolveByPassing(engine);
      expect(stats.resolvePower(engine.roomState, live())).toBe(6 + activation);
    }
    expect(engine.roomState.players.player1.mana.red).toBe(1);
    expect(stats.resolveToughness(engine.roomState, live())).toBe(5);
    engine.applyMutations([{ type: 'CLEAR_END_OF_TURN_EFFECTS' }]);
    expect(stats.resolvePower(engine.roomState, live())).toBe(5);
  },
}] satisfies CardCase[];
