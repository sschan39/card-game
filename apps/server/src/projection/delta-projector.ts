import type { GameRoom } from '@card-game/engine/types/game.room.types';
import { PROTOCOL_VERSION, type PlayerView, type ViewDelta, type ViewChange, type PublicNotification } from '@card-game/protocol';
import { buildPlayerViews } from './view-builder';

interface DeltaMetadata { seq: number; timestamp: number; action?: string; playerId?: string; commandId?: string; notifications?: PublicNotification[] }
/** Diff only the wire schema. Neither raw mutation paths nor raw oldValue can cross this boundary. */
export function projectViewDelta(before: GameRoom | undefined, after: GameRoom, viewerId: string, metadata: DeltaMetadata): ViewDelta {
  return projectViewDeltas(before, after, [viewerId], metadata)[0];
}

export function projectViewDeltas(before: GameRoom | undefined, after: GameRoom, viewerIds: readonly string[], metadata: DeltaMetadata): ViewDelta[] {
  const previous = before && buildPlayerViews(before, viewerIds);
  const next = buildPlayerViews(after, viewerIds);
  return next.map((view, index) => diffPlayerViews(previous?.[index], view, metadata));
}

function diffPlayerViews(previous: PlayerView | undefined, next: PlayerView, metadata: DeltaMetadata): ViewDelta {
  const oldFields = previous as unknown as Record<string, unknown> | undefined;
  const fields = next as unknown as Record<string, unknown>;
  const changes: ViewChange[] = [];
  for (const key of new Set([...Object.keys(oldFields ?? {}), ...Object.keys(fields)])) {
    if (!Object.prototype.hasOwnProperty.call(fields, key)) changes.push({ path: key, op: 'remove' });
    else if (JSON.stringify(fields[key]) !== JSON.stringify(oldFields?.[key])) changes.push({ path: key, op: 'update', value: fields[key] });
  }
  return {
    protocolVersion: PROTOCOL_VERSION, viewerId: next.viewerId, roomId: next.roomId, seq: metadata.seq, timestamp: metadata.timestamp,
    ...(metadata.action !== undefined ? { action: metadata.action } : {}), ...(metadata.playerId !== undefined ? { playerId: metadata.playerId } : {}),
    ...(metadata.commandId !== undefined ? { commandId: metadata.commandId } : {}), ...(metadata.notifications?.length ? { notifications: metadata.notifications } : {}),
    changes,
  };
}
