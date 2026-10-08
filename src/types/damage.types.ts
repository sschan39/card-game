import type { CardSnapshot } from './card.types';

export type DamageRecipient =
  | { kind: 'player'; playerId: string }
  | { kind: 'permanent'; cardUuid: string; zoneRevision: number };

export interface DamageAssignment {
  source: CardSnapshot;
  recipient: DamageRecipient;
  amount: number;
  combat: boolean;
}
