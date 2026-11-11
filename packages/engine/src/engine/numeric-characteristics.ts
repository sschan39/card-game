import type { CardInstance, CardZone } from '../types/card.types';
import type { CardCharacteristics, CharacteristicNumber } from '../types/continuous-effect.types';
import type { NumericContext } from '../types/numeric-value.types';
import { fixedManaValue } from '../shared/card-query';
import { readRulePath } from '../shared/rule-path';
import { scopeMatches } from './effect-scopes';
import { characteristicNumericValue, evaluateNumericValue } from '../shared/numeric-values';
import { collectCardSource } from '../shared/card-collections';
import type { ResolutionCardResults } from '../types/resolution-result.types';
export { characteristicNumericValue } from '../shared/numeric-values';

export interface BoardNumericContextOptions {
  results?: ResolutionCardResults;
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
  /** Present a card as its resolved characteristics, or undefined when absent. */
  const cardView = (card: CardInstance | undefined) => {
    if (!card) return undefined;
    const value = options.characteristics(card);
    return { ...card, ...value, manaValue: fixedManaValue(value) };
  };

  /** Cards selected by a scope, honouring the scope's source collection. */
  const selected = (scope: import('../types/continuous-effect.types').EffectScope) => collectCardSource(options.cards, scope.from, options.results)?.filter((entry) =>
    scopeMatches(
      { ...(!scope.from && !scope.storedUnderSource && options.defaultCountZones ? { zones: options.defaultCountZones } : {}), ...scope },
      entry.card,
      () => entry.recordedCharacteristics ?? options.characteristics(entry.card),
      options.source,
      options.controllerId,
    ));

  return {
    readField: (path) => {
      const root = path.split('.')[0];
      const fields = options.fields ?? {};

      // `source` and `target` are synthesized from the card views unless the
      // caller explicitly supplied them.
      return readRulePath(
        root === 'source' && !Object.prototype.hasOwnProperty.call(fields, root)
          ? { source: cardView(options.source) }
          : root === 'target' && !Object.prototype.hasOwnProperty.call(fields, root)
            ? { target: cardView(options.target) }
            : fields,
        path,
      );
    },

    count: (scope) => selected(scope)?.length ?? NaN,

    firstManaValue: (scope) => {
      const entry = selected(scope)?.[0];
      return entry ? fixedManaValue(entry.recordedCharacteristics ?? options.characteristics(entry.card)) : undefined;
    },

    counterTotal: (scope, counterType) =>
      selected(scope)?.reduce((total, entry) => total + (entry.card.state.counters[counterType] ?? 0), 0) ?? NaN,
  };
}

/** Evaluate a characteristic number, throwing when it cannot be resolved. */
export function requireCharacteristicNumber(value: CharacteristicNumber, context: NumericContext): number {
  const result = evaluateNumericValue(characteristicNumericValue(value), context);

  // Guard: an unresolved value is a rules bug, not a recoverable condition.
  if (!result.ok) throw new Error('Unresolved numeric characteristic: ' + result.reason);

  return result.value;
}
