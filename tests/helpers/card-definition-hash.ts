import { createHash } from 'node:crypto';

/**
 * Exclude redundant compiled-rule metadata and the pre-contract activated duration field,
 * which had no consumer.
 *
 * `translations` is display text, not rules: translating a card must not change the
 * rule-contract hash, otherwise every content batch would break this lock.
 */
export function cardDefinitionHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value, (key, child) => {
    if (key === 'translations') return undefined;
    if (key === 'rules' && Array.isArray(child) && child.length && child.every(rule => rule?.family === 'characteristics' || rule?.family === 'permissions')) return undefined;
    return child && typeof child === 'object' && !Array.isArray(child) ? Object.fromEntries(Object.entries(child)
      .filter(([field]) => !(child.type === 'activated' && field === 'duration')).sort(([a], [b]) => a.localeCompare(b))) : child;
  })).digest('hex');
}
