import { describe, expect, it } from 'vitest';
import { evaluateNumericValue } from '../../src/engine/numeric-values';
import { createBoardNumericContext } from '../../src/engine/numeric-characteristics';
import { CardCharacteristicService } from '../../src/engine/card-characteristic-service';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';

describe('counter totals in the normal numeric context', () => {
  it('sums one counter across a filtered board at evaluation time', () => {
    const first = creature('first', 'player2'), second = creature('second', 'player2'), own = creature('own', 'player1');
    first.state.counters.scorch = 2; second.state.counters.scorch = 3; own.state.counters.scorch = 7;
    const room = createTestRoom({ battlefield: [first, second, own] });
    const context = createBoardNumericContext({ cards: room.battlefield, characteristics: card => CardCharacteristicService.resolve(room, card), controllerId: 'player1', defaultCountZones: ['battlefield'] });
    const amount = { numeric: { kind: 'multiply', left: 3, right: { numeric: { kind: 'query', id: 'counterTotal', args: { counterType: 'scorch', scope: { controller: 'opponent' } } } } } };
    expect(evaluateNumericValue(amount, context)).toEqual({ ok: true, value: 15 });
    second.state.counters.scorch = 1;
    expect(evaluateNumericValue(amount, context)).toEqual({ ok: true, value: 9 });
    expect(evaluateNumericValue(amount)).toEqual({ ok: false, reason: 'missing_context' });
  });
});
