import { validCardFilter } from './card-filter-validation';
import { validCounterRemoval } from './counter-cost-validation';
import type { ActionCost, AuthoredActionCost, CostRoutes } from '../types/effect.types';
import { validManaAmounts } from './mana-validation';

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export function actionCostError(cost: ActionCost): string | undefined {
  if (
    !object(cost) ||
    Object.keys(cost).some(
      (key) => !['mana', 'life', 'tap', 'untap', 'discard', 'discardSelf', 'sacrifice', 'removeCounters', 'destroyMaterials', 'exileMaterials'].includes(key),
    )
  )
    return 'Unsupported action cost';
  for (const field of ['life', 'discard'] as const) {
    if (
      cost[field] !== undefined &&
      (typeof cost[field] !== 'number' || !Number.isSafeInteger(cost[field]) || cost[field]! < 0)
    )
      return 'Invalid action cost';
  }
  for (const field of ['tap', 'untap', 'sacrifice', 'discardSelf'] as const) {
    if (cost[field] !== undefined && typeof cost[field] !== 'boolean') return 'Invalid action cost';
  }
  if (
    cost.removeCounters !== undefined &&
    (!Array.isArray(cost.removeCounters) ||
      cost.removeCounters.length > 16 ||
      !cost.removeCounters.every(validCounterRemoval))
  )
    return 'Invalid counter removal cost';
  const materials = cost.destroyMaterials;
  if (materials !== undefined && (
    !object(materials) ||
    Object.keys(materials).some(key => !['filter', 'manaValueGreaterThan'].includes(key)) ||
    !validCardFilter(materials.filter) ||
    typeof materials.manaValueGreaterThan !== 'number' ||
    !Number.isSafeInteger(materials.manaValueGreaterThan) ||
    materials.manaValueGreaterThan < 0
  )) return 'Invalid material destruction cost';
  const exile = cost.exileMaterials;
  if (exile !== undefined && (
    !object(exile) || Object.keys(exile).some(key => !['filter', 'count'].includes(key)) ||
    !validCardFilter(exile.filter) || typeof exile.count !== 'number' || !Number.isSafeInteger(exile.count) || exile.count < 1
  )) return 'Invalid material exile cost';
  if (materials && exile) return 'An action can declare one selected material payment';
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
    if (
      !validManaAmounts(colors) ||
      (generic !== undefined && typeof generic === 'number' && (!Number.isSafeInteger(generic) || generic < 0))
    )
      throw new Error('Invalid authored mana cost');
  }
}

export function assertCostRoutesShape(routes: CostRoutes): void {
  if (routes.additionalCost !== undefined) assertAuthoredCostShape(routes.additionalCost);
  if (routes.alternativeCosts === undefined) return;
  if (!Array.isArray(routes.alternativeCosts)) throw new Error('Invalid alternative costs');
  const ids = new Set<string>();
  for (const route of routes.alternativeCosts) {
    if (
      !object(route) ||
      Object.keys(route).some((key) => !['id', 'label', 'cost'].includes(key)) ||
      typeof route.id !== 'string' ||
      !route.id.trim() ||
      ids.has(route.id) ||
      typeof route.label !== 'string' ||
      !route.label.trim()
    )
      throw new Error('Invalid alternative cost route');
    ids.add(route.id);
    assertAuthoredCostShape(route.cost);
  }
}
