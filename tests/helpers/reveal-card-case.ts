import { expect } from 'vitest';
import type { CardBlueprint, ManaPayment } from '@shared/card.types';
import { castWithPayment, choose, fixtureCard, passPriorityPair, resolveByPassing, type CardCase } from './card-test-cases';

export function entryReveal(eligible: Partial<CardBlueprint>, payment: ManaPayment, options: {
  excluded?: Partial<CardBlueprint>; top?: Partial<CardBlueprint>; optional?: boolean; name?: string;
} = {}): CardCase {
  return {
    name: options.name ?? 'reveals only the top three, takes an eligible card and orders the rest at the bottom',
    covers: ['play', 'entry effects'],
    prepare(room) {
      room.players.player1.deck = [
        fixtureCard('too-deep', 'player1', 'library', eligible),
        fixtureCard('eligible', 'player1', 'library', eligible),
        fixtureCard('excluded', 'player1', 'library', options.excluded),
        fixtureCard('top', 'player1', 'library', options.top),
      ];
    },
    run(engine, source) {
      castWithPayment(engine, source, payment);
      resolveByPassing(engine);
      passPriorityPair(engine);
      if (options.optional) {
        expect(engine.roomState.pendingChoice?.kind).toBe('optional');
        choose(engine, ['yes']);
      }
      const choice = engine.roomState.pendingChoice;
      if (choice?.kind !== 'search') throw new Error('Expected a reveal selection');
      expect(choice.options.map(option => option.id)).toEqual(['eligible']);
      choose(engine, ['eligible']);
      choose(engine, ['excluded', 'top']);
      expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(['eligible']);
      expect(engine.roomState.players.player1.deck.map(card => card.uuid)).toEqual(['top', 'excluded', 'too-deep']);
      const events = engine.drainEventBatches().flatMap(batch => batch.events).filter(event => event.eventId === 'CARD_REVEALED');
      expect(events.map(event => event.payload.card.uuid)).toEqual(['top', 'excluded', 'eligible']);
    },
  };
}
