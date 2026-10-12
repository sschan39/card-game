export const safeRuleKey = (key: string): boolean => !!key && !['__proto__', 'constructor', 'prototype'].includes(key);
export const validRulePath = (path: unknown): path is string => typeof path === 'string' && path.split('.').every(safeRuleKey);

/** Read only own fields of rules data, never executable expressions. */
export function readRulePath(context: unknown, path: string): unknown {
  if (!validRulePath(path)) return undefined;
  let value: unknown = context;
  for (const key of path.split('.')) {
    if (value === null || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}
