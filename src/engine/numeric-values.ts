import type { NumericContext, NumericExpression, NumericFailure, NumericQuery, NumericResult } from '../types/numeric-value.types';
import type { EffectScope } from '../types/continuous-effect.types';
import { safeRuleKey, validRulePath } from '../shared/rule-path';
import { validEffectScope } from './effect-scopes';

const failure = (reason: NumericFailure['reason']): NumericFailure => ({ ok: false, reason });
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keysAre = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
const checkedNumber = (value: unknown): NumericResult => typeof value === 'number' && Number.isFinite(value)
  && (!Number.isInteger(value) || Number.isSafeInteger(value)) ? { ok: true, value } : failure('invalid_number');
export const hasNumericExpression = (value: unknown): value is { numeric: NumericExpression } => record(value) && Object.prototype.hasOwnProperty.call(value, 'numeric');
const queries = new Map<string, NumericQuery>();

export function registerNumericQuery(id: string, query: NumericQuery): void {
  if (!safeRuleKey(id) || queries.has(id)) throw new Error('Invalid or duplicate numeric query: ' + id);
  queries.set(id, query);
}
registerNumericQuery('field', {
  validate: args => keysAre(args, ['path']) && validRulePath(args.path), requires: ['readField'],
  evaluate: (args, context) => {
    const value = context.readField!(args.path as string);
    return value === undefined ? failure('missing_context') : checkedNumber(value);
  },
});
registerNumericQuery('count', {
  validate: args => keysAre(args, ['scope']) && validEffectScope(args.scope), requires: ['count'],
  evaluate: (args, context) => checkedNumber(context.count!(args.scope as EffectScope)),
});
registerNumericQuery('exists', {
  validate: args => keysAre(args, ['scope']) && validEffectScope(args.scope), requires: ['count'],
  evaluate: (args, context) => {
    const count = checkedNumber(context.count!(args.scope as EffectScope));
    return count.ok ? { ok: true, value: count.value > 0 ? 1 : 0 } : count;
  },
});

/** Validate authored syntax without reading live state or asking for a choice. */
export function validateNumericValue(value: unknown): NumericFailure | undefined {
  const active = new Set<object>();
  const visit = (input: unknown): NumericFailure | undefined => {
    if (typeof input === 'number') { const result = checkedNumber(input); return result.ok ? undefined : result; }
    if (!record(input) || !keysAre(input, ['numeric']) || !record(input.numeric) || active.has(input)) return failure('invalid_expression');
    active.add(input);
    const expression = input.numeric;
    let error: NumericFailure | undefined;
    switch (expression.kind) {
      case 'binding':
        if (!keysAre(expression, ['kind', 'name']) || typeof expression.name !== 'string' || !safeRuleKey(expression.name)) error = failure('invalid_expression');
        break;
      case 'query': {
        if (!keysAre(expression, ['kind', 'id', 'args']) || typeof expression.id !== 'string' || !record(expression.args)) { error = failure('invalid_expression'); break; }
        const query = queries.get(expression.id);
        error = !query ? failure('unsupported_query') : !query.validate(expression.args) ? failure('invalid_expression') : undefined;
        break;
      }
      case 'add': case 'multiply':
        error = !keysAre(expression, ['kind', 'left', 'right']) ? failure('invalid_expression') : visit(expression.left) ?? visit(expression.right);
        break;
      default: error = failure('invalid_expression');
    }
    active.delete(input);
    return error;
  };
  return visit(value);
}

/** All consumers share this arithmetic; their context decides what a query sees. */
export function evaluateNumericValue(value: unknown, context: NumericContext = {}): NumericResult {
  const error = validateNumericValue(value);
  if (error) return error;
  const visit = (input: number | { numeric: NumericExpression }): NumericResult => {
    if (typeof input === 'number') return checkedNumber(input);
    const expression = input.numeric;
    switch (expression.kind) {
      case 'binding': return context.bindings && Object.prototype.hasOwnProperty.call(context.bindings, expression.name)
        ? checkedNumber(context.bindings[expression.name]) : failure('missing_binding');
      case 'query': {
        const query = queries.get(expression.id)!;
        if (query.requires?.some(capability => context[capability] === undefined)) return failure('missing_context');
        const result = query.evaluate(expression.args, context);
        return result.ok ? checkedNumber(result.value) : result;
      }
      case 'add': case 'multiply': {
        const left = visit(expression.left);
        if (!left.ok) return left;
        const right = visit(expression.right);
        return !right.ok ? right : checkedNumber(expression.kind === 'add' ? left.value + right.value : left.value * right.value);
      }
    }
  };
  return visit(value as number | { numeric: NumericExpression });
}
