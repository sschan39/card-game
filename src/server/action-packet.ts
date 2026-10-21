import type { ActionData } from '../engine/action-registry';

export interface ActionPacket {
  roomId: string;
  actionId: string;
  commandId?: string;
  data: ActionData;
}

/** Parse the existing flat packet without maintaining a payload-field whitelist. */
export function parseActionPacket(input: unknown): ActionPacket | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const { roomId, actionId, commandId, playerId: _playerId, socketId: _socketId, ...data } = input as Record<string, unknown>;
  if (typeof roomId !== 'string' || !roomId.trim() || typeof actionId !== 'string' || !actionId.trim()) return null;
  return { roomId, actionId, ...(typeof commandId === 'string' && commandId.trim() ? { commandId } : {}), data: data as ActionData };
}
