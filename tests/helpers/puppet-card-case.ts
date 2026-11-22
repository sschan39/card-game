import { expect } from 'vitest';
import { CardCharacteristicService as stats } from '@engine/card-characteristic-service';
import { castWithPayment, choose, declareAttack, fixtureCard, passPriorityPair, permanent, resolveByPassing, type CardCase } from './card-test-cases';

export function puppetGraveyardCost(threshold: number, base: number): CardCase {
  return {
    name: `has graveyard mana value ${base}, becoming free in friendly combat with ${threshold} black creatures`,
    covers: ['ability:graveyard-cost'],
    prepare(room) {
      const [source] = room.players.player1.hand.splice(0, 1);
      source.state.zone = 'graveyard';
      room.players.player1.graveyard = [source];
      room.battlefield = [
        ...Array.from({ length: threshold - 1 }, (_, i) => fixtureCard(`ally-${i}`, 'player1', 'battlefield', { colors: ['black'] })),
        fixtureCard('wrong-color', 'player1', 'battlefield', { colors: ['red'] }),
        fixtureCard('enemy', 'player2', 'battlefield', { colors: ['black'] }),
        fixtureCard('artifact', 'player1', 'battlefield', { colors: ['black'], cardTypes: ['Artifact'] }),
      ];
    },
    run(engine, source) {
      const room = engine.roomState;
      const cost = () => stats.resolveManaValue(room, room.players.player1.graveyard.find(card => card.uuid === source.uuid)!);
      expect(cost()).toBe(base);
      room.phase = 'beginCombatStep';
      expect(cost()).toBe(base);
      room.battlefield.push(fixtureCard('last-ally', 'player1', 'battlefield', { colors: ['black'] }));
      expect(cost()).toBe(0);
      room.activeTurnPlayerId = 'player2';
      expect(cost()).toBe(base);
    },
  };
}

export function puppetAttackCases(black: number, generic: number, ability: string, { mill = false, boost = false } = {}): CardCase[] {
  return [true, false].map(deploy => ({
    name: `attacks, ${mill ? 'mills three, then ' : ''}offers only a friendly Puppet (${deploy ? 'deploy' : 'decline'})`,
    covers: ['play', `ability:${ability}`],
    prepare(room) {
      const puppet = { subTypes: ['幻影木偶'] };
      room.players.player2.graveyard = [fixtureCard('enemy-puppet', 'player2', 'graveyard', puppet)];
      room.players.player1.graveyard = [fixtureCard('other-creature', 'player1', 'graveyard')];
      if (mill) {
        room.players.player1.deck = [
          fixtureCard('too-deep', 'player1', 'library', puppet),
          fixtureCard('third', 'player1', 'library'),
          fixtureCard('puppet', 'player1', 'library', puppet),
          fixtureCard('first', 'player1', 'library'),
        ];
      } else {
        room.players.player1.graveyard.push(fixtureCard('puppet', 'player1', 'graveyard', puppet));
      }
    },
    run(engine, source) {
      castWithPayment(engine, source, { black, red: generic });
      resolveByPassing(engine);
      declareAttack(engine, source.uuid);
      passPriorityPair(engine);
      const player = engine.roomState.players.player1;
      if (mill) {
        expect(player.deck.map(card => card.uuid)).toEqual(['too-deep']);
        expect(player.graveyard.map(card => card.uuid)).toEqual(['other-creature', 'first', 'puppet', 'third']);
      }
      const choice = engine.roomState.pendingChoice;
      if (choice?.kind !== 'search') throw new Error('Expected a Puppet graveyard choice');
      expect([choice.min, choice.max]).toEqual([0, 1]);
      expect(choice.options.map(option => option.id)).toEqual(['puppet']);
      choose(engine, deploy ? ['puppet'] : []);
      expect(engine.roomState.battlefield.find(card => card.uuid === 'puppet')?.state.summonKind).toBe(deploy ? 'effect' : undefined);
      expect(engine.roomState.players.player1.graveyard.some(card => card.uuid === 'puppet')).toBe(!deploy);
      if (boost) {
        const power = () => stats.resolvePower(engine.roomState, permanent(engine, source.uuid));
        expect(power()).toBe(deploy ? 7 : 3);
        engine.applyMutations([{ type: 'CLEAR_COMBAT' }]);
        expect(power()).toBe(3);
      }
    },
  }));
}
