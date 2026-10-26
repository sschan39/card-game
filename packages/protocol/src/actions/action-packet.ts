import { PROTOCOL_VERSION } from '../version';
export interface ActionPacket { roomId: string; actionId: string; commandId?: string; data: Record<string, unknown> }
export function parseActionPacket(input: unknown): ActionPacket | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const { protocolVersion, roomId, actionId, commandId, playerId: _playerId, socketId: _socketId, ...data } = input as Record<string, unknown>;
  if (protocolVersion !== PROTOCOL_VERSION || typeof roomId !== 'string' || !roomId.trim() || typeof actionId !== 'string' || !actionId.trim()) return null;
  return { roomId, actionId, ...(typeof commandId === 'string' && commandId.trim() ? { commandId } : {}), data };
}
