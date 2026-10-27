import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import { PROTOCOL_VERSION, PageQuerySchema, AdminIdentityResponseSchema, AdminRoomsResponseSchema, AdminRoomResponseSchema, AdminAccountsResponseSchema, AdminAccountResponseSchema, DisableAccountRequestSchema, AdminLogsResponseSchema, AdminConfigResponseSchema, LogQuerySchema, type AuditRecord } from '@card-game/protocol';
import type { ServerStateStore } from '../rooms/state-store';
import type { AuthService } from '../auth/service';
import { publicAccount } from '../auth/service';
import { requireSession } from '../auth/routes';
import { AuthError } from '../auth/errors';
import { configRevision, type ServerConfig } from '../config';
import type { AuditService } from '../admin/audit';
import { AdminAccountService } from '../admin/account-service';
import type { DiagnosticLogReader } from '../admin/log-reader';

interface Options { auth: AuthService; store: ServerStateStore; config: ServerConfig; audit: AuditService; logs: DiagnosticLogReader }
export function createAdminRouter({ auth, store, config, audit, logs }: Options): Router {
  const router = Router(), accounts = new AdminAccountService(auth, audit);
  const record = (actor: string | null, action: AuditRecord['action'], target: string, outcome: AuditRecord['outcome'] = 'success') => { audit.record(actor, action, target, outcome); audit.flush(); };
  router.use((request, response, next) => {
    let actor: string | null = null;
    try {
      const session = requireSession(auth, request);
      const account = session.subject.kind === 'account' ? auth.repository.findAccount(session.subject.id) : undefined;
      actor = account?.id ?? null;
      if (session.scope !== 'admin' || !account || account.role !== 'admin') throw new AuthError(403, 'An admin-scoped session and current admin role are required.');
      response.locals.actorId = account.id; next();
    } catch (error) { try { record(actor, 'admin.denied', 'admin', 'denied'); } catch {} next(error); }
  });
  const page = (request: Request) => {
    const result = PageQuerySchema.safeParse({ ...request.query, limit: request.query.limit ?? config.http.pageSize });
    if (!result.success) throw new AuthError(400, 'Invalid admin page.'); return result.data;
  };
  const run = (action: AuditRecord['action'], target: string | ((request: Request) => string), work: (request: Request, actorId: string) => unknown): RequestHandler => (request, response, next) => {
    const label = typeof target === 'string' ? target : target(request), safeTarget = label.length <= 128 ? label : 'invalid-target';
    try { const result = work(request, response.locals.actorId); record(response.locals.actorId, action, safeTarget); response.json(result); }
    catch (error) {
      try { record(response.locals.actorId, action, safeTarget, error instanceof AuthError && error.status === 404 ? 'not_found' : 'denied'); } catch {}
      next(error);
    }
  };
  router.get('/me', run('admin.identity', 'self', (_request, actor) => AdminIdentityResponseSchema.parse({ protocolVersion: PROTOCOL_VERSION, account: publicAccount(auth.repository.findAccount(actor)!) })));
  router.get('/rooms', run('rooms.list', 'rooms', request => {
    if (!config.inspectionEnabled) throw new AuthError(404, 'Inspection disabled.');
    const { offset, limit } = page(request), ids = store.listRooms();
    const rooms = ids.slice(offset, offset + limit).flatMap(id => {
      const room = store.getRoom(id);
      return room ? [{ roomId: id, status: room.status, phase: room.phase, turnNumber: room.turnNumber ?? 0, players: room.player2Id ? 2 : 1 }] : [];
    });
    return AdminRoomsResponseSchema.parse({ protocolVersion: PROTOCOL_VERSION, rooms, total: ids.length, offset, limit });
  }));
  router.get('/rooms/:id', run('room.inspect', request => store.getRoom(String(request.params.id)) ? String(request.params.id) : 'unknown-room', request => {
    if (!config.inspectionEnabled) throw new AuthError(404, 'Inspection disabled.');
    const id = z.string().min(1).max(128).safeParse(request.params.id), room = id.success ? store.getRoom(id.data) : undefined;
    if (!room) throw new AuthError(404, 'Room not found.');
    return AdminRoomResponseSchema.parse({ protocolVersion: PROTOCOL_VERSION, room });
  }));
  router.get('/accounts', run('accounts.list', 'accounts', request => {
    const { offset, limit } = page(request);
    return AdminAccountsResponseSchema.parse({ protocolVersion: PROTOCOL_VERSION, ...auth.repository.listAccounts(offset, limit), offset, limit });
  }));
  router.post('/accounts/:id/disable', (request, response, next) => {
    try {
      const id = z.string().uuid().safeParse(request.params.id);
      if (!id.success || !DisableAccountRequestSchema.safeParse(request.body).success) throw new AuthError(400, 'Invalid account disable request.');
      response.json(AdminAccountResponseSchema.parse({ protocolVersion: PROTOCOL_VERSION, account: accounts.disable(response.locals.actorId, id.data) }));
    } catch (error) { try { record(response.locals.actorId, 'account.disable', z.string().uuid().safeParse(request.params.id).success ? String(request.params.id) : 'invalid-target', error instanceof AuthError && error.status === 404 ? 'not_found' : 'denied'); } catch {} next(error); }
  });
  router.get('/deltas', run('logs.read', 'diagnostic-log', request => {
    const query = LogQuerySchema.safeParse({ ...request.query, limit: request.query.limit ?? config.http.pageSize });
    if (!query.success) throw new AuthError(400, 'Invalid log page.');
    return AdminLogsResponseSchema.parse(logs.page(query.data));
  }));
  router.get('/config', run('config.read', 'effective-config', () => AdminConfigResponseSchema.parse({
    protocolVersion: PROTOCOL_VERSION, revision: configRevision(config), profile: config.profile, inspectionEnabled: config.inspectionEnabled,
    fixturesEnabled: config.fixturesEnabled, debugMode: config.debugMode, reconnectGraceMs: config.rooms.reconnectGraceMs,
    sessionTtlMs: config.auth.sessionTtlMs, adminSessionTtlMs: config.auth.adminSessionTtlMs, pageSize: config.http.pageSize,
    maxDecksPerAccount: config.storage.maxDecksPerAccount, auditExportPending: audit.exportPending,
  })));
  return router;
}
