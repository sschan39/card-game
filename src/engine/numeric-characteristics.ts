import type { CardInstance, CardZone } from '../types/card.types';
import type { CardCharacteristics, CharacteristicNumber } from '../types/continuous-effect.types';
import type { NumericContext, NumericValue } from '../types/numeric-value.types';
import { readRulePath } from '../shared/rule-path';
import { scopeMatches } from './effect-scopes';
import { hasNumericExpression, evaluateNumericValue } from './numeric-values';

export interface BoardNumericContextOptions {
  cards: CardInstance[];
  characteristics: (card: CardInstance) => CardCharacteristics;
  source?: CardInstance;
  target?: CardInstance;
  controllerId?: string;
  fields?: Record<string, unknown>;
  defaultCountZones?: CardZone[];
}

/** The caller supplies either an intermediate board or the normal rules view. */
export function createBoardNumericContext(options: BoardNumericContextOptions): NumericContext {
  const cardView = (card: CardInstance | undefined) => card ? { ...card, ...options.characteristics(card) } : undefined;
  return {
    readField: path => {
      const root = path.split('.')[0];
      const fields = options.fields ?? {};
      return readRulePath(root === 'source' && !Object.prototype.hasOwnProperty.call(fields, root) ? { source: cardView(options.source) }
        : root === 'target' && !Object.prototype.hasOwnProperty.call(fields, root) ? { target: cardView(options.target) } : fields, path);
    },
    count: scope => options.cards.filter(card => scopeMatches({ ...(options.defaultCountZones ? { zones: options.defaultCountZones } : {}), ...scope },
      card, options.characteristics(card), options.source, options.controllerId)).length,
    counterTotal: (scope, counterType) => options.cards.filter(card => scopeMatches({ ...(options.defaultCountZones ? { zones: options.defaultCountZones } : {}), ...scope },
      card, options.characteristics(card), options.source, options.controllerId)).reduce((total, card) => total + (card.state.counters[counterType] ?? 0), 0),
  };
}

/** Compatibility syntax translates to the common expression language. */
export function characteristicNumericValue(value: CharacteristicNumber): NumericValue {
  if (typeof value === 'number' || hasNumericExpression(value)) return value;
  return { numeric: { kind: 'add', left: { numeric: { kind: 'multiply',
    left: { numeric: { kind: 'query', id: 'count', args: { scope: value.count } } }, right: value.multiply ?? 1 } }, right: value.add ?? 0 } };
}

export function requireCharacteristicNumber(value: CharacteristicNumber, context: NumericContext): number {
  const result = evaluateNumericValue(characteristicNumericValue(value), context);
  if (!result.ok) throw new Error('Unresolved numeric characteristic: ' + result.reason);
  return result.value;
}
