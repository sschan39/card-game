/**
 * src/types/delta.types.ts
 * Shared delta types used by both the server (SyncService) and the client
 * (deltaReducer). Kept in src/types/ so the client can import them without
 * pulling in Node builtins (fs/path) or the Socket.IO server.
 */

import type { PlayerId } from './game.room.types';
import type { RecordedEventBatch } from './game-event.types';

export interface DeltaChange {
  path: string;        // e.g. "players.player1.life" or "battlefield[0].state.isTapped"
  op: 'add' | 'remove' | 'update';
  value?: unknown;     // new value (for add/update)
  oldValue?: unknown;  // previous value (for update/remove, kept for backtracking)
}

export interface StateDelta {
  /** Public, per-delivery summaries; never merged into room state. */
  notifications?: { eventId: 'ACTION_RESOLVED' | 'CARD_REVEALED'; eventUuid: string; summary: string }[];
  roomId: string;
  seq: number;
  timestamp: number;
  action?: string;     // the actionId that caused this change
  playerId?: PlayerId; // who initiated the action
  commandId?: string;
  /** Internal debug timeline, retained in JSONL and stripped from player deltas. */
  batches?: RecordedEventBatch[];
  changes: DeltaChange[]; // ordered, causal sequence of individual changes
}
