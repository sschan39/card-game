import type { CounterRemovalCost } from '../types/counter-cost.types';
import { validCardFilter } from './card-filter-validation';
import { safeRuleKey } from './rule-path';

/** One strict contract shared by authored schemas and payment validation. */
export function validCounterRemoval(value: unknown): value is CounterRemovalCost {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const cost = value as Record<string, unknown>;
  const fields = ['from', 'counterType', 'amount'];
  if (cost.from === 'battlefield') fields.push('filter');
  if (Object.keys(cost).some((key) => !fields.includes(key))) return false;
  if (cost.from !== 'source' && cost.from !== 'attached_host' && cost.from !== 'battlefield') return false;
  if (typeof cost.counterType !== 'string' || !safeRuleKey(cost.counterType)) return false;
  if (!Number.isSafeInteger(cost.amount) || (cost.amount as number) <= 0) return false;
  return cost.filter === undefined || validCardFilter(cost.filter);
}
