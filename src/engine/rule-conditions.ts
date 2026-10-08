import type { RuleCondition, RuleValue } from '../types/rule.types';
import type { CardInstance, CardSnapshot } from '../types/card.types';
import type { GameRoom } from '../types/game.room.types';
import type { TriggeringEvent } from '../types/effect.types';
import { captureSourceInformation } from './source-information';
import { emptyEventCounts } from './turn-history';

/** Read only own fields of serializable rules data, never executable expressions. */
export function readRulePath(context: unknown, path: string): unknown {
  let value: unknown = context;
  for (const key of path.split('.')) {
    if (!key || ['__proto__', 'constructor', 'prototype'].includes(key) || value === null || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}
const resolve = (value: RuleValue, context: unknown) => value !== null && typeof value === 'object' ? readRulePath(context, value.path) : value;

export function conditionMatches(condition: RuleCondition | undefined, context: unknown): boolean {
  if (!condition) return true;
  if ('all' in condition) return condition.all.every(child => conditionMatches(child, context));
  if ('any' in condition) return condition.any.some(child => conditionMatches(child, context));
  if ('not' in condition) return !conditionMatches(condition.not, context);
  const left = resolve(condition.left, context), right = resolve(condition.right, context);
  if (left === undefined || right === undefined) return false;
  switch (condition.op) {
    case 'eq': return left === right;
    case 'ne': return left !== right;
    case 'includes': return Array.isArray(left) && left.includes(right);
    case 'gt': return typeof left === 'number' && typeof right === 'number' && left > right;
    case 'gte': return typeof left === 'number' && typeof right === 'number' && left >= right;
    case 'lt': return typeof left === 'number' && typeof right === 'number' && left < right;
    case 'lte': return typeof left === 'number' && typeof right === 'number' && left <= right;
  }
}

export function createRuleContext(room: GameRoom | undefined, source: CardInstance, controllerId: string, event?: TriggeringEvent, snapshot?: CardSnapshot): Record<string, unknown> {
  const info = snapshot ?? (room ? captureSourceInformation(room, source) : { card: source, power: source.blueprint.power ?? 0, toughness: source.blueprint.toughness ?? 0 });
  return { source: { ...info.card, power: info.power, toughness: info.toughness }, controller: room?.players[controllerId], event,
    history: { ...room?.turnHistory, own: room?.turnHistory?.playerCounts[controllerId] ?? emptyEventCounts() } };
}
