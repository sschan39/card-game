import type { ActionCost, AuthoredActionCost, CostRoutes } from '../types/effect.types';
import { validManaAmounts } from './mana-validation';

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

/** Shape only; numeric definition ownership is validated by card-definition-validator. */
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
