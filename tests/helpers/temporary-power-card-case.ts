import { expect } from 'vitest';
import { CardCharacteristicService as stats } from '@engine/card-characteristic-service';
import type { ManaPayment } from '@shared/card.types';
import { act, castWithPayment, fixtureCard, resolveByPassing, type CardCase } from './card-test-cases';

export function temporaryPower(
  tribe: string, payment: ManaPayment, bonus: number, scope: 'one' | 'all' | 'ability',
): CardCase {
  return {
    name: 'increases only eligible friendly power and wears off at cleanup',
    covers: ['play', scope === 'ability' ? 'ability:empower-beasts' : 'cast effects'],
    prepare(room) {
      room.battlefield = [
        fixtureCard('ally-one', 'player1', 'battlefield', { subTypes: [tribe] }),
        fixtureCard('ally-two', 'player1', 'battlefield', { subTypes: [tribe] }),
        fixtureCard('enemy', 'player2', 'battlefield', { subTypes: [tribe] }),
        fixtureCard('wrong-tribe', 'player1', 'battlefield'),
      ];
    },
    run(engine, source) {
      const targets = (id: string) => ({ targets: [{ targetType: 'permanent', cardUuid: id }] });
      if (scope === 'one') {
        for (const id of ['enemy', 'wrong-tribe']) {
          expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: source.uuid, ...targets(id) }).success).toBe(false);
        }
      }
      castWithPayment(engine, source, payment, scope === 'one' ? targets('ally-one') : {});
      resolveByPassing(engine);
      const times = scope === 'ability' ? 2 : 1;
      if (scope === 'ability') {
        const before = { ...engine.roomState.players.player1.mana };
        for (let use = 0; use < times; use++) {
          act(engine, 'activate_ability', { cardUuid: source.uuid, abilityId: 'empower-beasts' });
          resolveByPassing(engine);
        }
        expect(engine.roomState.players.player1.mana).toEqual(before);
        expect(engine.roomState.battlefield.find(card => card.uuid === source.uuid)?.state.isTapped).toBe(false);
      }
      const powers = () => engine.roomState.battlefield
        .filter(card => card.uuid !== source.uuid)
        .map(card => stats.resolvePower(engine.roomState, card));
      expect(powers()).toEqual([2 + bonus * times, scope === 'one' ? 2 : 2 + bonus * times, 2, 2]);
      engine.applyMutations([{ type: 'CLEAR_END_OF_TURN_EFFECTS' }]);
      expect(powers()).toEqual([2, 2, 2, 2]);
    },
  };
}
