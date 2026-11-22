import { expect } from 'vitest';
import type { CardBlueprint } from '@shared/card.types';
import { castWithPayment, chooseTarget, fixtureCard, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [true, false].map(friendly => ({
  name: `adds one Frost Gear counter only to eligible friendly equipment (present: ${friendly})`,
  covers: ['play', 'ability:summon-frost-gear'],
  prepare(room) {
    const equipment: Partial<CardBlueprint> = { cardTypes: ['Artifact'], subTypes: ['Equipment'] };
    room.battlefield = [
      fixtureCard('enemy', 'player2', 'battlefield', equipment),
      fixtureCard('ordinary', 'player1', 'battlefield', { cardTypes: ['Artifact'] }),
      ...(friendly ? [fixtureCard('friendly', 'player1', 'battlefield', equipment)] : []),
    ];
  },
  run(engine, source) {
    castWithPayment(engine, source, { white: 1, red: 1 });
    resolveByPassing(engine);
    if (friendly) {
      chooseTarget(engine, 'friendly', ['friendly']);
      resolveByPassing(engine);
    }
    expect(engine.roomState.pendingChoice).toBeFalsy();
    expect(engine.roomState.stack).toEqual([]);
    const marked = engine.roomState.battlefield.filter(card => card.state.counters['frost-gear']);
    expect(marked.map(card => [card.uuid, card.state.counters['frost-gear']])).toEqual(friendly ? [['friendly', 1]] : []);
  },
}) satisfies CardCase);
