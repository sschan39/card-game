/**
 * src/client/types/client.types.ts
 * Client-only types (UI state, etc.).
 */

import type { ActionOption } from '@card-game/protocol';

export interface ContextMenuState {
  x: number;
  y: number;
  cardUuid: string;
  zone: 'hand' | 'battlefield';
  options: ActionOption[];
}

export interface LogEntry {
  seq: number;
  action?: string;
  playerId?: string;
  changes: number;
}
