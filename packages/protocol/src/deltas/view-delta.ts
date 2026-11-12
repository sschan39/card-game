import type { Versioned } from '../version';
import type { ManaColor } from '@card-game/engine/types/card.types';
export interface ViewChange { path: string; op: 'add' | 'remove' | 'update'; value?: unknown; oldValue?: unknown }
export interface PublicNotification { eventId: 'ACTION_RESOLVED' | 'CARD_REVEALED'; eventUuid: string; summary: string }
export type ImpactAnchor =
  | { kind: 'permanent'; cardUuid: string; zoneRevision: number }
  | { kind: 'player'; playerId: string }
  | { kind: 'stack'; stackUuid: string };
/** One applied hit, with endpoints restricted to objects visible to this viewer. */
export interface DamageImpactView {
  source?: ImpactAnchor;
  target: ImpactAnchor;
  combat: boolean;
  color?: ManaColor;
}
export interface ViewDelta extends Versioned {
  viewerId: string; roomId: string; seq: number; timestamp: number; action?: string;
  playerId?: string; commandId?: string; changes: ViewChange[]; notifications?: PublicNotification[];
  impacts?: DamageImpactView[];
}
