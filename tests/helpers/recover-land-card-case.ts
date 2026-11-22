import { expect } from 'vitest';
import type { ManaPayment } from '@shared/card.types';
import { act, castWithPayment, choose, fixtureCard, passPriorityPair, resolveByPassing, type CardCase } from './card-test-cases';

export function recoverLand(payment: ManaPayment, entryAbility?: string): CardCase {
  return {
    name: 'recovers only a land from the caster’s graveyard and preserves the normal land play',
    covers: ['play', entryAbility ? 'ability:' + entryAbility : 'cast effects'],
    prepare(room) {
      room.players.player1.graveyard = [
        fixtureCard('recover-me', 'player1', 'graveyard', { cardTypes: ['Land'] }),
        fixtureCard('not-a-land', 'player1', 'graveyard'),
      ];
      room.players.player2.graveyard = [fixtureCard('opposing-land', 'player2', 'graveyard', { cardTypes: ['Land'] })];
      room.players.player1.hand.push(fixtureCard('normal-land', 'player1', 'hand', { cardTypes: ['Land'] }));
    },
    run(engine, source) {
      castWithPayment(engine, source, payment);
      if (entryAbility) resolveByPassing(engine);
      passPriorityPair(engine);
      const choice = engine.roomState.pendingChoice;
      if (choice?.kind !== 'search') throw new Error('Expected a graveyard search');
      expect(choice.options.map(option => option.id)).toEqual(['recover-me']);
      choose(engine, ['recover-me']);
      expect(engine.roomState.battlefield.find(card => card.uuid === 'recover-me')?.state.zoneRevision).toBe(1);
      expect(engine.roomState.players.player2.graveyard[0].uuid).toBe('opposing-land');
      act(engine, 'play_land', { cardUuid: 'normal-land', zoneRevision: 0 });
      expect(engine.roomState.turnHistory?.landPlays.player1).toBe(1);
    },
  };
}
