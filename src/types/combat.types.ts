import type { CardSnapshot } from './card.types';
import type { DamageRecipient } from './damage.types';

export interface CombatDamageRequest {
  source: CardSnapshot;
  declarationUuid: string;
  role: 'attacker' | 'blocker';
  total: number;
  recipients: DamageRecipient[];
}

/** Plain room state; partial allocations and pass position survive engine reconstruction. */
export interface CombatDamageState {
  passes: string[];
  passIndex: number;
  completed: boolean;
  requests: CombatDamageRequest[];
  allocations: Record<string, Record<string, number>>;
}
