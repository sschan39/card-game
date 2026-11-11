import type { ActionCost } from '../types/effect.types';
import { validManaAmounts } from './mana-pool';
import { actionCostError } from '../shared/action-cost-validation';
export { actionCostError } from '../shared/action-cost-validation';

/** Compose requirements, never consume resources. Repeated source payments cannot collapse. */
export function composeActionCosts(costs: ActionCost[]): ActionCost {
  const result: ActionCost = {};

  /** Add two amounts, rejecting totals outside the safe integer range. */
  const add = (left = 0, right = 0) => {
    const total = left + right;
    if (!Number.isSafeInteger(total)) throw new Error('Combined action cost exceeds the safe integer range');
    return total;
  };

  for (const cost of costs) {
    // Guard: each individual cost must be well-formed before it is merged.
    const error = actionCostError(cost);
    if (error) throw new Error(error);

    // Mana requirements accumulate per colour.
    if (cost.mana !== undefined) {
      if (!validManaAmounts(cost.mana, true)) throw new Error('Invalid mana requirement');
      result.mana ??= {};
      for (const color of Object.keys(cost.mana) as (keyof NonNullable<ActionCost['mana']>)[]) {
        result.mana[color] = add(result.mana[color], cost.mana[color]);
      }
    }

    if (cost.removeCounters) {
      result.removeCounters = [...(result.removeCounters ?? []), ...structuredClone(cost.removeCounters)];
    }

    if (cost.destroyMaterials) {
      if (result.destroyMaterials) throw new Error('An action can declare one material destruction cost');
      result.destroyMaterials = structuredClone(cost.destroyMaterials);
    }

    if (cost.exileMaterials) {
      if (result.exileMaterials) throw new Error('An action can declare one material exile cost');
      result.exileMaterials = structuredClone(cost.exileMaterials);
    }

    // Numeric costs accumulate.
    for (const field of ['life', 'discard'] as const) {
      if (cost[field] !== undefined) result[field] = add(result[field], cost[field]);
    }

    // Boolean source costs cannot be paid twice by the same action.
    for (const field of ['tap', 'untap', 'sacrifice', 'discardSelf'] as const) {
      if (cost[field]) {
        if (result[field]) throw new Error('Cannot pay the same source cost twice');
        result[field] = true;
      }
    }
  }

  // Guard: the merged result must still be a valid cost.
  const error = actionCostError(result);
  if (error) throw new Error(error);

  // Guard: the summed mana must stay within the safe integer range.
  if (!Number.isSafeInteger(Object.values(result.mana ?? {}).reduce((sum, amount) => sum + (amount ?? 0), 0))) {
    throw new Error('Combined mana cost exceeds the safe integer range');
  }

  return result;
}
