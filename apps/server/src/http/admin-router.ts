import { Router } from 'express';
import { z } from 'zod';
import { PROTOCOL_VERSION } from '@card-game/protocol';
import type { StateStore } from '../rooms/state-store';
import type { AuthService } from '../auth/service';
import { publicAccount } from '../auth/service';
import { requireSession } from '../auth/routes';
import { AuthError } from '../auth/errors';

const pageSchema = z.object({ offset: z.coerce.number().int().min(0).max(100_000).default(0), limit: z.coerce.number().int().min(1).max(100).default(25) }).strict();
export function createAdminRouter(auth: AuthService, store: StateStore, inspectionEnabled: () => boolean): Router {
  const router = Router();
  router.use((request, _response, next) => {
    try {
      const session = requireSession(auth, request);
      if (session.scope !== 'admin') throw new AuthError(403, 'An admin-scoped session is required.');
      const account = session.subject.kind === 'account' ? auth.repository.findAccount(session.subject.id) : undefined;
      if (!account || account.role !== 'admin') throw new AuthError(403, 'Admin role required.');
      next();
    } catch (error) { next(error); }
  });
  router.get('/me', (request, response, next) => {
    try { const session = requireSession(auth, request); response.json({ protocolVersion: PROTOCOL_VERSION, account: publicAccount(auth.repository.findAccount(session.subject.id)!) }); }
    catch (error) { next(error); }
  });
  router.get('/rooms', (request, response, next) => {
    if (!inspectionEnabled()) { next(new AuthError(404, 'Inspection disabled.')); return; }
    const parsed = pageSchema.safeParse(request.query);
    if (!parsed.success) { next(new AuthError(400, 'Invalid room page.')); return; }
    const ids = store.listRooms(), { offset, limit } = parsed.data;
    const rooms = ids.slice(offset, offset + limit).flatMap(id => {
      const room = store.getRoom(id);
      return room ? [{ roomId: id, status: room.status, phase: room.phase, turnNumber: room.turnNumber ?? 0, players: room.player2Id ? 2 : 1 }] : [];
    });
    response.json({ protocolVersion: PROTOCOL_VERSION, rooms, total: ids.length, offset, limit });
  });
  return router;
}
