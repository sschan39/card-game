import type { RuleCondition, RuleValue } from '../types/rule.types';
import type { NumericContext } from '../types/numeric-value.types';
import { readRulePath } from './rule-path';
import { hasNumericExpression, evaluateNumericValue } from './numeric-values';

/** Pure condition evaluation; callers supply a phase-appropriate, read-only context. */
export function conditionMatches(condition: RuleCondition | undefined, context: unknown, numericContext?: NumericContext): boolean {
  const numeric = numericContext ?? (context as { numericContext?: NumericContext } | undefined)?.numericContext ?? { readField: (path: string) => readRulePath(context, path) };
  const resolve = (value: RuleValue): { value: unknown; unresolved?: true } => {
    if (hasNumericExpression(value)) { const result = evaluateNumericValue(value, numeric); return result.ok ? { value: result.value } : { value: undefined, unresolved: true }; }
    return { value: value !== null && typeof value === 'object' ? readRulePath(context, value.path) : value };
  };
  const match = (node: RuleCondition | undefined): boolean | undefined => {
    if (!node) return true;
    if ('all' in node || 'any' in node) { const children = ('all' in node ? node.all : node.any).map(match); if (children.includes(undefined)) return undefined;
      return 'all' in node ? children.every(Boolean) : children.some(Boolean); }
    if ('not' in node) { const child = match(node.not); return child === undefined ? undefined : !child; }
    const left = resolve(node.left), right = resolve(node.right);
    if (left.unresolved || right.unresolved) return undefined;
    if (left.value === undefined || right.value === undefined) return false;
    const a = left.value, b = right.value;
    switch (node.op) {
      case 'eq': return a === b; case 'ne': return a !== b;
      case 'includes': return Array.isArray(a) && a.includes(b) || typeof a === 'string' && typeof b === 'string' && a.includes(b);
      case 'gt': return typeof a === 'number' && typeof b === 'number' && a > b;
      case 'gte': return typeof a === 'number' && typeof b === 'number' && a >= b;
      case 'lt': return typeof a === 'number' && typeof b === 'number' && a < b;
      case 'lte': return typeof a === 'number' && typeof b === 'number' && a <= b;
    }
  };
  return match(condition) === true;
}
