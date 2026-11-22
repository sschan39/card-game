import { expect } from 'vitest';
import { castWithPayment, choose, chooseTarget, fixtureCard, passPriorityPair, resolveByPassing, type CardCase } from './card-test-cases';

export function optionalEntryScorch(ability: string, amount: number, freshOnly: boolean): CardCase[] {
  const decisions = freshOnly ? ['accept', 'decline', 'stale'] as const : ['accept', 'decline'] as const;
  return decisions.map(decision => ({
    name: `offers ${amount} Scorch for eligible opposing permanents (${decision})`,
    covers: ['play', 'ability:' + ability],
    prepare(room) {
      const enemy = fixtureCard('enemy', 'player2', 'battlefield', { toughness: 8 });
      const marked = fixtureCard('marked', 'player2', 'battlefield', { toughness: 8 });
      marked.state.counters.scorch = 1;
      room.battlefield = [enemy, marked, fixtureCard('ally', 'player1', 'battlefield'),
        fixtureCard('relic', 'player2', 'battlefield', { cardTypes: ['Artifact'] }),
        fixtureCard('gear', 'player2', 'battlefield', { cardTypes: ['Artifact'], subTypes: ['Equipment'] })];
    },
    run(engine, source) {
      castWithPayment(engine, source, { red: 1 });
      resolveByPassing(engine);
      chooseTarget(engine, 'enemy', freshOnly ? ['enemy', 'relic'] : ['enemy', 'marked', 'relic']);
      if (decision === 'stale') {
        engine.applyMutations([{ type: 'ADD_COUNTER', cardUuid: 'enemy', counterType: 'scorch', amount: 1 }]);
        resolveByPassing(engine);
        expect(engine.roomState.pendingChoice).toBeFalsy();
      } else {
        passPriorityPair(engine);
        expect(engine.roomState.pendingChoice?.kind).toBe('optional');
        choose(engine, [decision === 'accept' ? 'yes' : 'no']);
      }
      expect(engine.roomState.battlefield.find(card => card.uuid === 'enemy')?.state.counters.scorch ?? 0)
        .toBe(decision === 'accept' ? amount : decision === 'stale' ? 1 : 0);
    },
  }));
}
