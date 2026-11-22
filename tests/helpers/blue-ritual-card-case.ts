import { expect } from 'vitest';
import type { GameEngine } from '@engine/game-engine';
import type { CardInstance } from '@shared/card.types';
import { castWithPayment, choose, fixtureCard, permanent, resolveByPassing, type CardCase } from './card-test-cases';

export function giantRitual(value: number, afterSummon: (engine: GameEngine, source: CardInstance) => void): CardCase {
  return {
    name: `rejects exactly ${value} in ritual materials and deploys after destroying Giants worth more`,
    covers: ['ability:ritual'],
    prepare(room) {
      const giant = (id: string, blue: number) => fixtureCard(id, 'player1', 'battlefield', {
        subTypes: ['蒼巨人'], castRequirements: { allowedZones: ['hand'], cost: { mana: { blue } } },
      });
      room.battlefield = [
        giant('one', 1), giant('high-1', value - 1), giant('high-2', value - 1),
        fixtureCard('non-giant', 'player1', 'battlefield'),
        fixtureCard('opposing-giant', 'player2', 'battlefield', { subTypes: ['蒼巨人'] }),
      ];
      room.players.player1.deck = ['bottom', 'second', 'first'].map(id => fixtureCard(id, 'player1', 'library'));
      room.players.player2.deck = Array.from({ length: 11 }, (_, i) => fixtureCard(`enemy-${i}`, 'player2', 'library'));
    },
    run(engine, source) {
      const activate = { cardUuid: source.uuid, abilityId: 'ritual' };
      expect(engine.executePlayerAction('player1', 'activate_ability', activate).success).toBe(true);
      const choice = engine.roomState.pendingChoice;
      if (!choice || choice.kind === 'number') throw new Error('Expected the ritual materials choice');
      expect(choice.options.map(option => option.id)).toEqual(['one', 'high-1', 'high-2']);
      expect(engine.executePlayerAction('player1', 'choose', { choiceId: choice.id, choices: ['one', 'high-1'] }).success).toBe(false);
      expect(engine.roomState.players.player1.graveyard).toEqual([]);
      const before = engine.roomState.players.player1.mana.blue;
      choose(engine, ['high-1', 'high-2']);
      expect(engine.roomState.players.player1.graveyard.map(card => card.uuid)).toEqual(['high-1', 'high-2']);
      expect(engine.roomState.players.player1.mana.blue).toBe(before);
      resolveByPassing(engine);
      expect(permanent(engine, source.uuid).state.summonKind).toBe('effect');
      afterSummon(engine, source);
    },
  };
}

export function regularGiantCast(blue: number): CardCase {
  return {
    name: 'can be cast normally without its special-summon trigger',
    covers: ['play'],
    prepare(room) { room.players.player1.mana.blue = blue; },
    run(engine, source) {
      castWithPayment(engine, source, { blue });
      resolveByPassing(engine);
      expect(permanent(engine, source.uuid).state.summonKind).toBe('cast');
      expect(engine.roomState.stack).toEqual([]);
      expect(engine.roomState.pendingChoice).toBeFalsy();
    },
  };
}
