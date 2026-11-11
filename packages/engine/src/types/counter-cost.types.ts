import type { CardFilter } from './card-query.types';

interface CounterAmount {
  counterType: string;
  amount: number;
}
export type CounterRemovalCost = CounterAmount & ({ from: 'source' | 'attached_host' } | { from: 'battlefield'; filter?: CardFilter });
export interface CounterAllocation {
  cardUuid: string;
  zoneRevision: number;
  amount: number;
}
export type CounterPayments = Record<string, CounterAllocation[]>;
