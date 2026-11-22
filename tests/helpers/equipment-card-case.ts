import { expect } from 'vitest';
import { CardCharacteristicService as stats } from '@engine/card-characteristic-service';
import type { ManaColor, ManaPayment } from '@shared/card.types';
import type { GameEngine } from '@engine/game-engine';
import { act, castWithPayment, declareAttack, resolveByPassing, type CardCase } from './card-test-cases';
import { creature } from './combat-fixture';

export function equipmentAttack(
  tribe: string | undefined, cost: ManaColor | ManaPayment, boost: number, verifyAttack: (engine: GameEngine) => void,
): CardCase {
  return {
    name: 'pays two energy, equips only its friendly tribe, boosts attack and triggers on attack',
    covers: ['play', 'ability:attach', 'ability:equipped-creature'],
    prepare(room) {
      const ally = creature('equipment-host', 'player1', 2, 5);
      const enemy = creature('equipment-enemy', 'player2', 2, 5);
      ally.blueprint = { ...ally.blueprint, subTypes: tribe ? [tribe] : [] };
      enemy.blueprint = { ...enemy.blueprint, subTypes: tribe ? [tribe] : [] };
      room.battlefield = [ally, enemy, creature('wrong-tribe', 'player1')];
      const draw = creature('equipment-draw', 'player1');
      draw.state.zone = 'library';
      room.players.player1.deck.push(draw);
    },
    run(engine, source) {
      castWithPayment(engine, source, typeof cost === 'string' ? { [cost]: 2 } : cost);
      resolveByPassing(engine);
      expect(engine.roomState.battlefield.find(card => card.uuid === source.uuid)?.state.attachedTo).toBeFalsy();

      const equip = (cardUuid: string) => ({ cardUuid: source.uuid, abilityId: 'attach',
        targets: [{ targetType: 'permanent', cardUuid }] });
      for (const target of tribe ? ['equipment-enemy', 'wrong-tribe'] : ['equipment-enemy']) {
        expect(engine.executePlayerAction('player1', 'activate_ability', equip(target)).success).toBe(false);
      }
      act(engine, 'activate_ability', equip('equipment-host'));
      resolveByPassing(engine);
      const host = engine.roomState.battlefield.find(card => card.uuid === 'equipment-host');
      if (!host) throw new Error('Equipment host left the battlefield');
      expect(stats.resolvePower(engine.roomState, host)).toBe(2 + boost);
      declareAttack(engine, host.uuid);
      verifyAttack(engine);
    },
  };
}
