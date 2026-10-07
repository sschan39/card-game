import type { ActionData } from '../engine/action-registry';

/** Parse the existing flat packet without maintaining a payload-field whitelist. */
export function parseActionPacket(input: unknown): { roomId: string; actionId: string; data: ActionData } | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const { roomId, actionId, playerId: _playerId, socketId: _socketId, ...data } = input as Record<string, unknown>;
  if (typeof roomId !== 'string' || !roomId.trim() || typeof actionId !== 'string' || !actionId.trim()) return null;
  return { roomId, actionId, data: data as ActionData };
}
