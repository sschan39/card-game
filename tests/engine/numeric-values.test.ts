import { describe, expect, it } from 'vitest';
import { evaluateNumericValue, registerNumericQuery, validateNumericValue } from '../../src/engine/numeric-values';
import { readRulePath } from '../../src/shared/rule-path';

const binding = (name: string) => ({ numeric: { kind: 'binding', name } });
const query = (id: string, args: Record<string, unknown> = {}) => ({ numeric: { kind: 'query', id, args } });
const arithmetic = (kind: string, left: unknown, right: unknown) => ({ numeric: { kind, left, right } });

describe('numeric values', () => {
  it('combines stored choices and current query results without changing either input', () => {
    const expression = arithmetic('add', arithmetic('multiply', binding('chosen'), 2), query('field', { path: 'source.power' }));
    const before = JSON.stringify(expression), bindings = Object.freeze({ chosen: 3 });
    const context = { bindings, readField: (path: string) => readRulePath({ source: { power: 4 } }, path) };
    expect(evaluateNumericValue(expression, context)).toEqual({ ok: true, value: 10 });
    expect(evaluateNumericValue(expression, { ...context, readField: () => 7 })).toEqual({ ok: true, value: 13 });
    expect(JSON.stringify(expression)).toBe(before);
    expect(bindings.chosen).toBe(3);
  });

  it('accepts zero, signed values and fractions without imposing a consumer integer domain', () => {
    expect(evaluateNumericValue(binding('zero'), { bindings: { zero: 0 } })).toEqual({ ok: true, value: 0 });
    expect(evaluateNumericValue(arithmetic('add', -3, 0.5))).toEqual({ ok: true, value: -2.5 });
  });

  it('distinguishes missing bindings, missing capabilities and unknown queries', () => {
    expect(evaluateNumericValue(binding('X'))).toEqual({ ok: false, reason: 'missing_binding' });
    expect(evaluateNumericValue(binding('X'), { bindings: Object.create({ X: 4 }) })).toEqual({ ok: false, reason: 'missing_binding' });
    expect(evaluateNumericValue(query('field', { path: 'source.power' }))).toEqual({ ok: false, reason: 'missing_context' });
    expect(evaluateNumericValue(query('field', { path: 'source.power' }), { readField: () => undefined })).toEqual({ ok: false, reason: 'missing_context' });
    expect(evaluateNumericValue(query('numeric-test-unknown'))).toEqual({ ok: false, reason: 'unsupported_query' });
  });

  it.each([NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '3', null, {},
    { numeric: { kind: 'binding', name: '' } }, { numeric: { kind: 'binding', name: '__proto__' } },
    { numeric: { kind: 'add', left: 1 } }, { numeric: { kind: 'add', left: 1, right: 2, extra: true } },
    { numeric: { kind: 'query', id: 'field', args: { path: 'source.constructor' } } },
    { numeric: { kind: 'query', id: 'field', args: { path: 'source..power' } } },
    { numeric: { kind: 'query', id: 'count', args: { scope: { bogus: true } } } },
    { numeric: { kind: 'query', id: 'count', args: { scope: { zones: ['bogus'] } } } },
    { numeric: { kind: 'query', id: 'count', args: { scope: { objects: [{ cardUuid: 'source', zoneRevision: -1 }] } } } },
  ])('rejects malformed numeric data: %j', expression => {
    expect(validateNumericValue(expression)?.ok).toBe(false);
    expect(evaluateNumericValue(expression).ok).toBe(false);
  });

  it('rejects unsafe intermediate results even if a later operation could mask them', () => {
    const unsafe = arithmetic('add', Number.MAX_SAFE_INTEGER, 1);
    expect(evaluateNumericValue(arithmetic('multiply', unsafe, 0))).toEqual({ ok: false, reason: 'invalid_number' });
    expect(evaluateNumericValue(query('field', { path: 'amount' }), { readField: () => Infinity })).toEqual({ ok: false, reason: 'invalid_number' });
  });

  it('rejects cycles while accepting a shared acyclic subtree', () => {
    const expression = arithmetic('add', 1, 2);
    (expression.numeric as any).left = expression;
    expect(evaluateNumericValue(expression)).toEqual({ ok: false, reason: 'invalid_expression' });
    const shared = binding('X');
    expect(evaluateNumericValue(arithmetic('add', shared, shared), { bindings: { X: 2 } })).toEqual({ ok: true, value: 4 });
  });

  it('allows new queries without changing the expression evaluator', () => {
    registerNumericQuery('numeric-test-extension', {
      validate: args => Object.keys(args).length === 0, requires: ['readField'],
      evaluate: (_args, context) => ({ ok: true, value: context.readField!('controller.hand.length') as number }),
    });
    expect(evaluateNumericValue(arithmetic('multiply', query('numeric-test-extension'), 2), { readField: () => 4 })).toEqual({ ok: true, value: 8 });
    expect(evaluateNumericValue(query('numeric-test-extension', { bogus: true }), { readField: () => 4 })).toEqual({ ok: false, reason: 'invalid_expression' });
    expect(() => registerNumericQuery('numeric-test-extension', { validate: () => true, evaluate: () => ({ ok: true, value: 99 }) })).toThrow(/duplicate/);
    expect(evaluateNumericValue(query('numeric-test-extension'), { readField: () => 4 })).toEqual({ ok: true, value: 4 });
  });

  it('uses the supplied count capability and validates its result', () => {
    expect(evaluateNumericValue(query('count', { scope: { controller: 'self' } }), { count: scope => scope.controller === 'self' ? 3 : 0 })).toEqual({ ok: true, value: 3 });
    expect(evaluateNumericValue(query('count', { scope: {} }), { count: () => NaN })).toEqual({ ok: false, reason: 'invalid_number' });
  });

  it('never reads inherited fields through a rules path', () => {
    expect(readRulePath({ source: Object.create({ power: 7 }) }, 'source.power')).toBeUndefined();
    expect(readRulePath({ source: { power: 7 } }, 'source.power')).toBe(7);
  });
});
