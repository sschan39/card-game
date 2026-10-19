import type { ActionCost, AuthoredActionCost, CostRoutes } from '../types/effect.types';
import { validManaAmounts } from './mana-pool';

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function actionCostError(cost: ActionCost): string | undefined {
  if (!object(cost) || Object.keys(cost).some(key => !['mana', 'life', 'tap', 'untap', 'discard', 'discardSelf', 'sacrifice'].includes(key))) return 'Unsupported action cost';
  for (const field of ['life', 'discard'] as const) {
    if (cost[field] !== undefined && (typeof cost[field] !== 'number' || !Number.isSafeInteger(cost[field]) || cost[field]! < 0)) return 'Invalid action cost';
  }
  for (const field of ['tap', 'untap', 'sacrifice', 'discardSelf'] as const) {
    if (cost[field] !== undefined && typeof cost[field] !== 'boolean') return 'Invalid action cost';
  }
  if (cost.tap && cost.untap) return 'Cannot pay both tap and untap costs';
}

/** Shape only; numeric definition ownership is validated by numeric-definitions. */
export function assertAuthoredCostShape(cost: AuthoredActionCost): void {
  if (!object(cost)) throw new Error('Invalid authored action cost');
  const { mana, ...fixed } = cost;
  const error = actionCostError(fixed);
  if (error) throw new Error(error);
  if (mana !== undefined) {
    if (!object(mana)) throw new Error('Invalid authored mana cost');
    const { generic, ...colors } = mana;
    if (!validManaAmounts(colors) || (generic !== undefined && typeof generic === 'number' && (!Number.isSafeInteger(generic) || generic < 0))) throw new Error('Invalid authored mana cost');
  }
}

export function assertCostRoutesShape(routes: CostRoutes): void {
  if (routes.additionalCost !== undefined) assertAuthoredCostShape(routes.additionalCost);
  if (routes.alternativeCosts === undefined) return;
  if (!Array.isArray(routes.alternativeCosts)) throw new Error('Invalid alternative costs');
  const ids = new Set<string>();
  for (const route of routes.alternativeCosts) {
    if (!object(route) || Object.keys(route).some(key => !['id', 'label', 'cost'].includes(key)) ||
        typeof route.id !== 'string' || !route.id.trim() || ids.has(route.id) || typeof route.label !== 'string' || !route.label.trim()) throw new Error('Invalid alternative cost route');
    ids.add(route.id);
    assertAuthoredCostShape(route.cost);
  }
}

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
