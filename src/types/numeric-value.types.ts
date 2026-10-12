import type { EffectScope } from './continuous-effect.types';

export type NumericExpression =
  | { kind: 'binding'; name: string }
  | { kind: 'query'; id: string; args: Record<string, unknown> }
  | { kind: 'add' | 'multiply'; left: NumericValue; right: NumericValue };
export type NumericValue = number | { numeric: NumericExpression };
export type NumericBindings = Readonly<Record<string, number>>;
export type NumericFailure = { ok: false; reason: 'invalid_expression' | 'missing_binding' | 'unsupported_query' | 'missing_context' | 'invalid_number' };
export type NumericResult = { ok: true; value: number } | NumericFailure;

/** Transient read capabilities; no room mutation or persisted callbacks. */
export interface NumericContext {
  bindings?: NumericBindings;
  readField?: (path: string) => unknown;
  count?: (scope: EffectScope) => number;
}
export interface NumericQuery {
  validate: (args: Record<string, unknown>) => boolean;
  requires?: readonly (keyof NumericContext)[];
  evaluate: (args: Record<string, unknown>, context: NumericContext) => NumericResult;
}
