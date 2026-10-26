import { Router, type Request } from 'express';
import type { GameRoom } from '@card-game/engine/types/game.room.types';
import { PROTOCOL_VERSION } from '@card-game/protocol';

export interface InspectorIdentity { accountId: string; roles: readonly string[] }
export interface DebugChannelOptions {
  findRoom: (roomId: string) => GameRoom | undefined;
  enabled: () => boolean;
  authorize?: (request: Request) => InspectorIdentity | null;
}
/** Authentication is supplied by Phase 2; an absent authorizer always denies access. */
export function createDebugRouter({ findRoom, enabled, authorize = () => null }: DebugChannelOptions): Router {
  const router = Router();
  router.get('/room/:id', (request, response) => {
    if (!enabled()) { response.status(404).json({ protocolVersion: PROTOCOL_VERSION, message: 'Inspection disabled' }); return; }
    const identity = authorize(request);
    if (!identity) { response.status(401).json({ protocolVersion: PROTOCOL_VERSION, message: 'Authentication required' }); return; }
    if (!identity.roles.some(role => role === 'admin' || role === 'inspector')) {
      response.status(403).json({ protocolVersion: PROTOCOL_VERSION, message: 'Inspection role required' }); return;
    }
    const room = findRoom(request.params.id);
    if (!room) { response.status(404).json({ protocolVersion: PROTOCOL_VERSION, message: 'Room not found' }); return; }
    response.json({ protocolVersion: PROTOCOL_VERSION, room });
  });
  return router;
}
