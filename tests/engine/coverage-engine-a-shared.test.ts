import { describe, expect, it } from 'vitest';
import { choiceAnswerDetails } from '@rules/choice-diagnostics';
import { sameStateValue } from '@rules/state-value';
import {
  characteristicNumericValue,
  evaluateNumericValue,
  hasNumericExpression,
  registerNumericQuery,
  validateNumericValue,
} from '@rules/numeric-values';
import { describeActionCost } from '@rules/action-cost-description';
import {
  actionCostError,
  assertAuthoredCostShape,
  assertCostRoutesShape,
} from '@rules/action-cost-validation';
import { createBoardNumericContext, requireCharacteristicNumber } from '@engine/numeric-characteristics';
import { CardCharacteristicService } from '@engine/card-characteristic-service';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';
import type { ActionCost, AuthoredActionCost, CostRoutes } from '@shared/effect.types';
import type { CardInstance } from '@shared/card.types';
import type { NumericContext } from '@shared/numeric-value.types';
import type { ResolutionCardResults } from '@shared/resolution-result.types';
import type { EffectScope } from '@shared/continuous-effect.types';

describe('choice diagnostics metadata', () => {
  it('reports every recognized answer field and ignores an absent answer', () => {
    expect(choiceAnswerDetails()).toEqual({
      number: undefined,
      selected: undefined,
      attackers: undefined,
      assignments: undefined,
      allocationChoices: undefined,
      allocationTotal: undefined,
    });
    expect(choiceAnswerDetails({ choices: ['a', 'b'], number: 2 }).selected).toBe(2);
    expect(choiceAnswerDetails({ choices: 'not-an-array' }).selected).toBeUndefined();
    expect(choiceAnswerDetails({ attackers: ['x'], assignments: [{ id: 'y' }] })).toMatchObject({
      attackers: ['x'],
      assignments: [{ id: 'y' }],
    });
    expect(choiceAnswerDetails({ attackers: {} }).attackers).toBeUndefined();
    expect(choiceAnswerDetails({ assignments: 3 }).assignments).toBeUndefined();
  });

  it('summarizes positive numeric allocations and ignores zero or non-numeric entries', () => {
    const details = choiceAnswerDetails({ allocations: { first: 2, second: 0, third: 'not-a-number' } });
    expect(details.allocationChoices).toEqual([{ id: 'first', amount: 2 }]);
    expect(details.allocationTotal).toBe(2);
  });

  it('ignores an allocation value that is not an object', () => {
    expect(choiceAnswerDetails({ allocations: 'invalid' })).toMatchObject({
      allocationChoices: undefined,
      allocationTotal: undefined,
    });
  });
});

describe('immutable state value comparison', () => {
  it('treats identical references and equal scalars as unchanged', () => {
    const value = { nested: [1, 2] };
    expect(sameStateValue(value, value)).toBe(true);
    expect(sameStateValue(4, 4)).toBe(true);
    expect(sameStateValue('a', 'a')).toBe(true);
  });

  it('rejects null, primitive and shape mismatches', () => {
    expect(sameStateValue(null, {})).toBe(false);
    expect(sameStateValue({}, null)).toBe(false);
    expect(sameStateValue(1, '1')).toBe(false);
    expect(sameStateValue([], {})).toBe(false);
    expect(sameStateValue([1], [1, 2])).toBe(false);
    expect(sameStateValue({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameStateValue({ a: 1 }, { b: 1 })).toBe(false);
  });

  it('compares nested structures recursively', () => {
    expect(sameStateValue({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(sameStateValue({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe(false);
    expect(sameStateValue({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
  });
});

describe('shared numeric expression language', () => {
  it('evaluates literals, bindings, field queries and arithmetic', () => {
    expect(evaluateNumericValue(3)).toEqual({ ok: true, value: 3 });
    expect(evaluateNumericValue({ numeric: { kind: 'binding', name: 'x' } }, { bindings: { x: 7 } })).toEqual({
      ok: true,
      value: 7,
    });
    expect(evaluateNumericValue({ numeric: { kind: 'binding', name: 'x' } }, {})).toEqual({
      ok: false,
      reason: 'missing_binding',
    });
    expect(
      evaluateNumericValue({ numeric: { kind: 'query', id: 'field', args: { path: 'source.power' } } }, {
        readField: () => 4,
      }),
    ).toEqual({ ok: true, value: 4 });
    expect(
      evaluateNumericValue({ numeric: { kind: 'query', id: 'field', args: { path: 'source.power' } } }, {
        readField: () => undefined,
      }),
    ).toEqual({ ok: false, reason: 'missing_context' });
    expect(
      evaluateNumericValue({
        numeric: {
          kind: 'add',
          left: { numeric: { kind: 'multiply', left: 3, right: 4 } },
          right: 2,
        },
      }),
    ).toEqual({ ok: true, value: 14 });
  });

  it('treats exists as one only for a positive count', () => {
    const expression = { numeric: { kind: 'query' as const, id: 'exists', args: { scope: {} } } };
    expect(evaluateNumericValue(expression, { count: () => 0 })).toEqual({ ok: true, value: 0 });
    expect(evaluateNumericValue(expression, { count: () => 2 })).toEqual({ ok: true, value: 1 });
    expect(evaluateNumericValue(expression, { count: () => Number.NaN })).toEqual({ ok: false, reason: 'invalid_number' });
  });

  it('requires the capability each query names', () => {
    const count = { numeric: { kind: 'query' as const, id: 'count', args: { scope: {} } } };
    expect(evaluateNumericValue(count, {})).toEqual({ ok: false, reason: 'missing_context' });
    expect(evaluateNumericValue(count, { count: () => 5 })).toEqual({ ok: true, value: 5 });
    const counter = { numeric: { kind: 'query' as const, id: 'counterTotal', args: { scope: {}, counterType: 'charge' } } };
    expect(evaluateNumericValue(counter, {})).toEqual({ ok: false, reason: 'missing_context' });
    expect(evaluateNumericValue(counter, { counterTotal: () => 2 })).toEqual({ ok: true, value: 2 });
  });

  it('returns the validation failure before visiting an invalid value', () => {
    expect(evaluateNumericValue(null)).toEqual({ ok: false, reason: 'invalid_expression' });
  });

  it('stops arithmetic at the first invalid operand', () => {
    expect(
      evaluateNumericValue({ numeric: { kind: 'add', left: { numeric: { kind: 'binding', name: 'nope' } }, right: 1 } }),
    ).toEqual({ ok: false, reason: 'missing_binding' });
    expect(
      evaluateNumericValue({ numeric: { kind: 'multiply', left: 2, right: { numeric: { kind: 'binding', name: 'nope' } } } }),
    ).toEqual({ ok: false, reason: 'missing_binding' });
  });

  it('rejects malformed expressions without reading live state', () => {
    expect(validateNumericValue(null)).toEqual({ ok: false, reason: 'invalid_expression' });
    expect(validateNumericValue('three')).toEqual({ ok: false, reason: 'invalid_expression' });
    expect(validateNumericValue(Number.MAX_SAFE_INTEGER + 2)).toEqual({ ok: false, reason: 'invalid_number' });
    expect(validateNumericValue({ numeric: { kind: 'binding', name: '' } })).toMatchObject({ reason: 'invalid_expression' });
    expect(validateNumericValue({ numeric: { kind: 'binding', name: 4 } })).toMatchObject({ reason: 'invalid_expression' });
    expect(validateNumericValue({ numeric: { kind: 'binding', name: 'ok', extra: true } })).toMatchObject({
      reason: 'invalid_expression',
    });
    expect(validateNumericValue({ numeric: { kind: 'mystery' } })).toEqual({ ok: false, reason: 'invalid_expression' });
    expect(validateNumericValue({ numeric: { kind: 'query', id: 'missing', args: {} } })).toEqual({
      ok: false,
      reason: 'unsupported_query',
    });
    expect(
      validateNumericValue({ numeric: { kind: 'query', id: 'count', args: { scope: { bogus: true } } } }),
    ).toMatchObject({ reason: 'invalid_expression' });
    expect(validateNumericValue({ numeric: { kind: 'query', id: 'count', args: 'nope' } })).toEqual({
      ok: false,
      reason: 'invalid_expression',
    });
    expect(validateNumericValue({ numeric: { kind: 'add', left: 1 } })).toEqual({
      ok: false,
      reason: 'invalid_expression',
    });
    expect(validateNumericValue({ numeric: { kind: 'add', left: 1, right: {} } })).toEqual({
      ok: false,
      reason: 'invalid_expression',
    });
    expect(validateNumericValue({ numeric: { kind: 'binding', name: 'ok' }, extra: 1 })).toEqual({
      ok: false,
      reason: 'invalid_expression',
    });
  });

  it('rejects cyclic expressions rather than recursing forever', () => {
    const cyclic: { numeric: { kind: 'add'; left: unknown; right: number } } = {
      numeric: { kind: 'add', left: undefined, right: 1 },
    };
    cyclic.numeric.left = cyclic;
    expect(validateNumericValue(cyclic)).toEqual({ ok: false, reason: 'invalid_expression' });
  });

  it('guards the shared query registry', () => {
    expect(() => registerNumericQuery('field', { validate: () => true, evaluate: () => ({ ok: true, value: 0 }) })).toThrow(
      /duplicate numeric query/,
    );
    expect(() =>
      registerNumericQuery('__proto__', { validate: () => true, evaluate: () => ({ ok: true, value: 0 }) }),
    ).toThrow(/Invalid or duplicate numeric query/);
  });

  it('detects the numeric expression wrapper', () => {
    expect(hasNumericExpression({ numeric: { kind: 'binding', name: 'x' } })).toBe(true);
    expect(hasNumericExpression({ numeric: undefined })).toBe(true);
    expect(hasNumericExpression(4)).toBe(false);
    expect(hasNumericExpression(null)).toBe(false);
    expect(hasNumericExpression([])).toBe(false);
  });

  it('translates legacy characteristic counts into the common expression language', () => {
    expect(characteristicNumericValue(6)).toBe(6);
    const already = { numeric: { kind: 'binding' as const, name: 'x' } };
    expect(characteristicNumericValue(already)).toBe(already);
    const scope: EffectScope = { zones: ['graveyard'] };
    expect(evaluateNumericValue(characteristicNumericValue({ count: scope }), { count: () => 3 })).toEqual({
      ok: true,
      value: 3,
    });
    expect(
      evaluateNumericValue(characteristicNumericValue({ count: scope, multiply: 2, add: 1 }), { count: () => 3 }),
    ).toEqual({ ok: true, value: 7 });
  });
});

describe('board numeric context', () => {
  const room = createTestRoom();
  const boardCard = creature('board-card', 'player1', 2, 3);
  const otherCard = creature('other-card', 'player1', 5, 5);
  const cards: CardInstance[] = [boardCard, otherCard];
  const characteristics = (card: CardInstance) => CardCharacteristicService.resolve(room, card);

  it('synthesizes source and target views and reads explicit fields', () => {
    const context = createBoardNumericContext({
      cards,
      characteristics,
      source: boardCard,
      target: otherCard,
      controllerId: 'player1',
      fields: { marker: { value: 9 } },
      defaultCountZones: ['battlefield'],
    });
    expect(context.readField!('source.power')).toBe(2);
    expect(context.readField!('target.power')).toBe(5);
    expect(context.readField!('marker.value')).toBe(9);
    expect(context.readField!('source.manaValue')).toBe(0);
  });

  it('returns undefined source and target views when the caller supplies none', () => {
    const context = createBoardNumericContext({ cards, characteristics, controllerId: 'player1' });
    expect(context.readField!('source.power')).toBeUndefined();
    expect(context.readField!('target.toughness')).toBeUndefined();
    expect(context.readField!('unknown.path')).toBeUndefined();
  });

  it('counts cards through scopes, resolving result sources and recorded characteristics', () => {
    const context = createBoardNumericContext({
      cards,
      characteristics,
      controllerId: 'player1',
      defaultCountZones: ['battlefield'],
    });
    expect(context.count!({})).toBe(2);
    expect(context.count!({ cardTypes: ['Artifact'] })).toBe(0);

    const results: ResolutionCardResults = {
      window: {
        name: 'window',
        kind: 'captured',
        observationId: 'observation',
        cards: [{ before: { card: structuredClone(boardCard), power: 2, toughness: 3 } }],
      },
    };
    const from = { kind: 'result' as const, name: 'window' };
    const fromContext = createBoardNumericContext({
      cards,
      characteristics,
      controllerId: 'player1',
      results,
      defaultCountZones: ['battlefield'],
    });
    expect(fromContext.count!({ from })).toBe(1);
    expect(fromContext.count!({ from, cardTypes: ['Artifact'] })).toBe(0);
  });

  it('reports missing result sources as an unknowable count', () => {
    const context = createBoardNumericContext({ cards, characteristics, controllerId: 'player1' });
    expect(Number.isNaN(context.count!({ from: { kind: 'result', name: 'absent' } }))).toBe(true);
    expect(
      Number.isNaN(
        context.counterTotal!({ from: { kind: 'result', name: 'absent' } }, 'charge'),
      ),
    ).toBe(true);
  });

  it('totals counters over the selected cards and defaults absent counters to zero', () => {
    const withCounters = { ...creature('charged', 'player1'), state: { ...creature('charged', 'player1').state, counters: { charge: 2 } } };
    const plain = creature('plain', 'player1');
    const context = createBoardNumericContext({
      cards: [withCounters, plain],
      characteristics,
      controllerId: 'player1',
      defaultCountZones: ['battlefield'],
    });
    expect(context.counterTotal!({}, 'charge')).toBe(2);
    expect(context.counterTotal!({ cardUuid: 'plain' }, 'charge')).toBe(0);
  });

  it('throws when a characteristic number cannot be resolved', () => {
    const context: NumericContext = {};
    expect(requireCharacteristicNumber(4, context)).toBe(4);
    expect(() => requireCharacteristicNumber({ numeric: { kind: 'binding', name: 'missing' } }, context)).toThrow(
      /Unresolved numeric characteristic: missing_binding/,
    );
    expect(requireCharacteristicNumber({ count: { zones: ['graveyard'] }, multiply: 2, add: 1 }, { count: () => 2 })).toBe(5);
  });
});

describe('action cost display', () => {
  it('describes every supported cost component', () => {
    expect(describeActionCost()).toBe('No additional cost');
    expect(describeActionCost({})).toBe('No additional cost');
    expect(
      describeActionCost({
        mana: { red: 2, blue: { numeric: { kind: 'binding', name: 'x' } } as unknown as number, green: 0 },
        removeCounters: [
          { from: 'source', counterType: 'charge', amount: 2 },
          { from: 'battlefield', counterType: 'loyalty', amount: 1 },
        ],
        destroyMaterials: { filter: {}, manaValueGreaterThan: 3 },
        life: 2,
        tap: true,
        untap: true,
        discard: 1,
        sacrifice: true,
        discardSelf: true,
      }),
    ).toBe(
      '2 red mana, Announced blue mana, Remove 2 charge counters from this card, ' +
        'Remove 1 loyalty counters from matching cards you control, ' +
        'Destroy materials with total mana value greater than 3, 2 life, Tap source, Untap source, Discard 1, ' +
        'Sacrifice source, Discard source',
    );
  });
});

describe('action cost validation', () => {
  it('accepts shapes the engine can pay', () => {
    expect(actionCostError({})).toBeUndefined();
    expect(actionCostError({ mana: { red: 1 }, life: 1, discard: 0 })).toBeUndefined();
    expect(actionCostError({ removeCounters: [{ from: 'source', counterType: 'charge', amount: 1 }] })).toBeUndefined();
    expect(actionCostError({ destroyMaterials: { filter: { cardTypes: ['Artifact'] }, manaValueGreaterThan: 1 } })).toBeUndefined();
  });

  it('rejects non-object and unknown fields', () => {
    expect(actionCostError(null as unknown as ActionCost)).toBe('Unsupported action cost');
    expect(actionCostError({ mana: {}, loyalty: 2 } as unknown as ActionCost)).toBe('Unsupported action cost');
  });

  it('validates numeric and boolean cost fields', () => {
    expect(actionCostError({ life: -1 })).toBe('Invalid action cost');
    expect(actionCostError({ life: 1.5 })).toBe('Invalid action cost');
    expect(actionCostError({ discard: 'one' as unknown as number })).toBe('Invalid action cost');
    expect(actionCostError({ tap: 'yes' as unknown as boolean })).toBe('Invalid action cost');
    expect(actionCostError({ untap: 1 as unknown as boolean })).toBe('Invalid action cost');
    expect(actionCostError({ sacrifice: 0 as unknown as boolean })).toBe('Invalid action cost');
    expect(actionCostError({ discardSelf: 'no' as unknown as boolean })).toBe('Invalid action cost');
  });

  it('validates counter removal and material destruction costs', () => {
    expect(actionCostError({ removeCounters: [{}] as never })).toBe('Invalid counter removal cost');
    expect(actionCostError({ removeCounters: null as never })).toBe('Invalid counter removal cost');
    expect(
      actionCostError({ removeCounters: Array.from({ length: 17 }, () => ({ from: 'source', counterType: 'x', amount: 1 })) }),
    ).toBe('Invalid counter removal cost');
    expect(actionCostError({ destroyMaterials: { filter: {}, manaValueGreaterThan: -1 } })).toBe(
      'Invalid material destruction cost',
    );
    expect(actionCostError({ destroyMaterials: { filter: {}, manaValueGreaterThan: 1.5 } })).toBe(
      'Invalid material destruction cost',
    );
    expect(actionCostError({ destroyMaterials: { filter: { bogus: true }, manaValueGreaterThan: 1 } })).toBe(
      'Invalid material destruction cost',
    );
    expect(
      actionCostError({ destroyMaterials: { filter: {}, manaValueGreaterThan: 1, extra: 1 } as never }),
    ).toBe('Invalid material destruction cost');
    expect(actionCostError({ destroyMaterials: 'bad' as never })).toBe('Invalid material destruction cost');
  });

  it('rejects paying both tap and untap', () => {
    expect(actionCostError({ tap: true, untap: true })).toBe('Cannot pay both tap and untap costs');
  });

  it('asserts authored cost shape, including display-only announced mana', () => {
    expect(() => assertAuthoredCostShape({ mana: { red: 1, generic: 2 } })).not.toThrow();
    expect(() => assertAuthoredCostShape(null as unknown as AuthoredActionCost)).toThrow('Invalid authored action cost');
    expect(() => assertAuthoredCostShape({ life: -1 })).toThrow('Invalid action cost');
    expect(() => assertAuthoredCostShape({ mana: 'one' as never })).toThrow('Invalid authored mana cost');
    expect(() => assertAuthoredCostShape({ mana: { purple: 1 } as never })).toThrow('Invalid authored mana cost');
    expect(() => assertAuthoredCostShape({ mana: { generic: -1 } })).toThrow('Invalid authored mana cost');
    expect(() => assertAuthoredCostShape({ mana: { generic: 1.5 } })).toThrow('Invalid authored mana cost');
  });

  it('asserts alternative cost route shape', () => {
    expect(() => assertCostRoutesShape({})).not.toThrow();
    expect(() => assertCostRoutesShape({ additionalCost: { life: 1 } })).not.toThrow();
    expect(() =>
      assertCostRoutesShape({ alternativeCosts: [{ id: 'alt', label: 'Alternative', cost: { mana: { red: 1 } } }] }),
    ).not.toThrow();
    expect(() => assertCostRoutesShape({ alternativeCosts: 'none' as unknown as CostRoutes['alternativeCosts'] })).toThrow(
      'Invalid alternative costs',
    );
    const invalid = (route: unknown) =>
      expect(() => assertCostRoutesShape({ alternativeCosts: [route] as never })).toThrow(
        'Invalid alternative cost route',
      );
    invalid(null);
    invalid({ id: 'alt', label: 'Alternative', cost: {}, extra: true });
    invalid({ id: '', label: 'Alternative', cost: {} });
    invalid({ id: '  ', label: 'Alternative', cost: {} });
    invalid({ id: 'alt', label: '', cost: {} });
    invalid({ id: 'alt', label: '  ', cost: {} });
    expect(() =>
      assertCostRoutesShape({
        alternativeCosts: [
          { id: 'alt', label: 'First', cost: {} },
          { id: 'alt', label: 'Second', cost: {} },
        ],
      }),
    ).toThrow('Invalid alternative cost route');
    expect(() =>
      assertCostRoutesShape({ alternativeCosts: [{ id: 'alt', label: 'Bad cost', cost: { life: -1 } }] }),
    ).toThrow('Invalid action cost');
  });
});
