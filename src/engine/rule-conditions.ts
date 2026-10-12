import type { RuleCondition, RuleValue } from '../types/rule.types';
import type { CardInstance, CardSnapshot } from '../types/card.types';
import type { GameRoom } from '../types/game.room.types';
import type { TriggeringEvent } from '../types/effect.types';
import { captureSourceInformation } from './source-information';
import { emptyEventCounts } from './turn-history';
import { readRulePath } from '../shared/rule-path';
import { hasNumericExpression, evaluateNumericValue } from './numeric-values';
import { createBoardNumericContext } from './numeric-characteristics';
import { roomCards } from './continuous-effects';
import { CardCharacteristicService } from './card-characteristic-service';
import type { NumericContext } from '../types/numeric-value.types';

export { readRulePath } from '../shared/rule-path';

export function conditionMatches(condition: RuleCondition | undefined, context: unknown, numericContext?: NumericContext): boolean {
  const numeric = numericContext ?? (context as { numericContext?: NumericContext } | undefined)?.numericContext ?? { readField: (path: string) => readRulePath(context, path) };
  const resolve = (value: RuleValue): { value: unknown; unresolved?: true } => {
    if (hasNumericExpression(value)) {
      const result = evaluateNumericValue(value, numeric);
      return result.ok ? { value: result.value } : { value: undefined, unresolved: true };
    }
    return { value: value !== null && typeof value === 'object' ? readRulePath(context, value.path) : value };
  };
  // Undefined is a numeric evaluation failure, distinct from an ordinary false predicate.
  const match = (node: RuleCondition | undefined): boolean | undefined => {
    if (!node) return true;
    if ('all' in node || 'any' in node) {
      const children = ('all' in node ? node.all : node.any).map(match);
      if (children.includes(undefined)) return undefined;
      return 'all' in node ? children.every(Boolean) : children.some(Boolean);
    }
    if ('not' in node) { const child = match(node.not); return child === undefined ? undefined : !child; }
    const left = resolve(node.left), right = resolve(node.right);
    if (left.unresolved || right.unresolved) return undefined;
    if (left.value === undefined || right.value === undefined) return false;
    const a = left.value, b = right.value;
    switch (node.op) {
      case 'eq': return a === b;
      case 'ne': return a !== b;
      case 'includes': return Array.isArray(a) && a.includes(b);
      case 'gt': return typeof a === 'number' && typeof b === 'number' && a > b;
      case 'gte': return typeof a === 'number' && typeof b === 'number' && a >= b;
      case 'lt': return typeof a === 'number' && typeof b === 'number' && a < b;
      case 'lte': return typeof a === 'number' && typeof b === 'number' && a <= b;
    }
  };
  return match(condition) === true;
}

export function createRuleContext(room: GameRoom | undefined, source: CardInstance, controllerId: string, event?: TriggeringEvent, snapshot?: CardSnapshot): Record<string, unknown> {
  const info = snapshot ?? (room ? captureSourceInformation(room, source) : { card: source, power: source.blueprint.power ?? 0, toughness: source.blueprint.toughness ?? 0 });
  const fields = { source: { ...info.card, power: info.power, toughness: info.toughness }, controller: room?.players[controllerId], event,
    history: { ...room?.turnHistory, own: room?.turnHistory?.playerCounts[controllerId] ?? emptyEventCounts() } };
  return { ...fields, numericContext: room ? createBoardNumericContext({ cards: roomCards(room), characteristics: card => CardCharacteristicService.resolve(room, card),
    source: info.card, controllerId, fields, defaultCountZones: ['battlefield'] }) : { readField: (path: string) => readRulePath(fields, path) } };
}
