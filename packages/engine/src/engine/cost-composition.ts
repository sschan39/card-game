import type { ActionCost } from '../types/effect.types';
import { validManaAmounts } from './mana-pool';
import { actionCostError } from '../shared/action-cost-validation';
export { actionCostError } from '../shared/action-cost-validation';

/** Compose requirements, never consume resources. Repeated source payments cannot collapse. */
export function composeActionCosts(costs: ActionCost[]): ActionCost {
  const result: ActionCost = {};
  const add = (left = 0, right = 0) => {
    const total = left + right;
    if (!Number.isSafeInteger(total)) throw new Error('Combined action cost exceeds the safe integer range');
    return total;
  };
  for (const cost of costs) {
    const error = actionCostError(cost);
    if (error) throw new Error(error);
    if (cost.mana !== undefined) {
      if (!validManaAmounts(cost.mana, true)) throw new Error('Invalid mana requirement');
      result.mana ??= {};
      for (const color of Object.keys(cost.mana) as (keyof NonNullable<ActionCost['mana']>)[]) result.mana[color] = add(result.mana[color], cost.mana[color]);
    }
    for (const field of ['life', 'discard'] as const) if (cost[field] !== undefined) result[field] = add(result[field], cost[field]);
    for (const field of ['tap', 'untap', 'sacrifice', 'discardSelf'] as const) if (cost[field]) {
      if (result[field]) throw new Error('Cannot pay the same source cost twice');
      result[field] = true;
    }
  }
  const error = actionCostError(result);
  if (error) throw new Error(error);
  if (!Number.isSafeInteger(Object.values(result.mana ?? {}).reduce((sum, amount) => sum + (amount ?? 0), 0))) throw new Error('Combined mana cost exceeds the safe integer range');
  return result;
}
