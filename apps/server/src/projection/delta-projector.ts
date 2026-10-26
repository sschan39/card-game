import type { GameRoom } from '@card-game/engine/types/game.room.types';
import { PROTOCOL_VERSION, type ViewDelta, type ViewChange, type PublicNotification } from '@card-game/protocol';
import { buildPlayerView } from './view-builder';

interface DeltaMetadata { seq: number; timestamp: number; action?: string; playerId?: string; commandId?: string; notifications?: PublicNotification[] }
/** Diff only the wire schema. Neither raw mutation paths nor raw oldValue can cross this boundary. */
export function projectViewDelta(before: GameRoom | undefined, after: GameRoom, viewerId: string, metadata: DeltaMetadata): ViewDelta {
  const previous = before ? buildPlayerView(before, viewerId) : undefined;
  const next = buildPlayerView(after, viewerId);
  const oldFields = previous as unknown as Record<string, unknown> | undefined;
  const fields = next as unknown as Record<string, unknown>;
  const changes: ViewChange[] = [];
  for (const key of new Set([...Object.keys(oldFields ?? {}), ...Object.keys(fields)])) {
    if (!Object.prototype.hasOwnProperty.call(fields, key)) changes.push({ path: key, op: 'remove' });
    else if (JSON.stringify(fields[key]) !== JSON.stringify(oldFields?.[key])) changes.push({ path: key, op: 'update', value: fields[key] });
  }
  return {
    protocolVersion: PROTOCOL_VERSION, viewerId, roomId: after.roomId, seq: metadata.seq, timestamp: metadata.timestamp,
    ...(metadata.action !== undefined ? { action: metadata.action } : {}), ...(metadata.playerId !== undefined ? { playerId: metadata.playerId } : {}),
    ...(metadata.commandId !== undefined ? { commandId: metadata.commandId } : {}), ...(metadata.notifications?.length ? { notifications: metadata.notifications } : {}),
    changes,
  };
}
