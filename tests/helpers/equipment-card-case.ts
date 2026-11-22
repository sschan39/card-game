import { expect } from 'vitest';
import { CardCharacteristicService as stats } from '@engine/card-characteristic-service';
import type { ManaColor } from '@shared/card.types';
import type { GameEngine } from '@engine/game-engine';
import { act, resolveByPassing, type CardCase } from './card-test-cases';
import { creature } from './combat-fixture';

export function equipmentAttack(
  tribe: string, color: ManaColor, boost: number, verifyAttack: (engine: GameEngine) => void,
): CardCase {
  return {
    name: 'pays two energy, equips only its friendly tribe, boosts attack and triggers on attack',
    covers: ['play', 'ability:attach', 'ability:equipped-creature'],
    prepare(room) {
      const ally = creature('equipment-host', 'player1', 2, 5);
      const enemy = creature('equipment-enemy', 'player2', 2, 5);
      ally.blueprint = { ...ally.blueprint, subTypes: [tribe] };
      enemy.blueprint = { ...enemy.blueprint, subTypes: [tribe] };
      room.battlefield = [ally, enemy, creature('wrong-tribe', 'player1')];
      const draw = creature('equipment-draw', 'player1');
      draw.state.zone = 'library';
      room.players.player1.deck.push(draw);
    },
    run(engine, source) {
      const before = { ...engine.roomState.players.player1.mana };
      act(engine, 'cast_spell', { cardUuid: source.uuid });
      expect(engine.roomState.players.player1.mana).toEqual({ ...before, [color]: before[color] - 2 });
      resolveByPassing(engine);

      const equip = (cardUuid: string) => ({ cardUuid: source.uuid, abilityId: 'attach',
        targets: [{ targetType: 'permanent', cardUuid }] });
      for (const target of ['equipment-enemy', 'wrong-tribe']) {
        expect(engine.executePlayerAction('player1', 'activate_ability', equip(target)).success).toBe(false);
      }
      act(engine, 'activate_ability', equip('equipment-host'));
      resolveByPassing(engine);
      const host = engine.roomState.battlefield.find(card => card.uuid === 'equipment-host');
      if (!host) throw new Error('Equipment host left the battlefield');
      expect(stats.resolvePower(engine.roomState, host)).toBe(2 + boost);
      engine.roomState.phase = 'declareAttackersStep';
      engine.roomState.priorityPlayerId = null;
      act(engine, 'declare_attackers', { attackers: [{ cardUuid: host.uuid }] });
      verifyAttack(engine);
    },
  };
}
