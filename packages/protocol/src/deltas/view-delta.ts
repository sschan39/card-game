import type { Versioned } from '../version';
export interface ViewChange { path: string; op: 'add' | 'remove' | 'update'; value?: unknown; oldValue?: unknown }
export interface PublicNotification { eventId: 'ACTION_RESOLVED' | 'CARD_REVEALED'; eventUuid: string; summary: string }
export interface ViewDelta extends Versioned {
  viewerId: string; roomId: string; seq: number; timestamp: number; action?: string;
  playerId?: string; commandId?: string; changes: ViewChange[]; notifications?: PublicNotification[];
}
