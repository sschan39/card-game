/** Compare immutable plain state values; shared references stop traversal. */
export function sameStateValue(before: unknown, after: unknown): boolean {
  if (Object.is(before, after)) return true;
  if (before === null || after === null || typeof before !== 'object' || typeof after !== 'object') return false;
  if (Array.isArray(before) !== Array.isArray(after)) return false;
  if (Array.isArray(before) && Array.isArray(after) && before.length !== after.length) return false;
  const oldKeys = Object.keys(before);
  const newKeys = Object.keys(after);
  if (oldKeys.length !== newKeys.length) return false;
  const oldObject = before as Record<string, unknown>;
  const newObject = after as Record<string, unknown>;
  return oldKeys.every(key => Object.prototype.hasOwnProperty.call(newObject, key) && sameStateValue(oldObject[key], newObject[key]));
}
