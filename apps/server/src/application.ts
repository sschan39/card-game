import express, { type ErrorRequestHandler } from 'express';
import http from 'node:http';
import path from 'node:path';
import helmet from 'helmet';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import { PROTOCOL_VERSION, isProtocolMessage, RoomSetupRequestSchema, JoinRoomRequestSchema, type OptionsMessage } from '@card-game/protocol';
import { gameConfig, getSetupPreset, snapshotSetupConfig } from '@card-game/engine/config';
import type { RoomSettings } from '@card-game/engine/types/setup-config.types';
import type { GameRoom } from '@card-game/engine/types/game.room.types';
import { serverLogger } from '@card-game/engine/shared/game-logger';
import { loadServerConfig, type AuthConfig, type ServerConfig } from './config';
import { AuthService } from './auth/service';
import { bootstrapAdmin } from './auth/bootstrap';
import { createAuthRouter, inspectorIdentity } from './auth/routes';
import { AuthError } from './auth/errors';
import { createAdminRouter } from './http/admin-router';
import { createCatalogRouter } from './http/catalog-router';
import { createDecksRouter } from './http/decks-router';
import { buildCatalog } from './catalog/catalog';
import { DeckService } from './decks/deck-service';
import { SqliteStore } from './stores/sqlite-store';
import { AuditService } from './admin/audit';
import { DiagnosticLogReader } from './admin/log-reader';
import { originAllowed, originPolicy } from './http/origin-policy';
import { authenticateHandshake, type SocketIdentity } from './realtime/handshake';
import { parseActionPacket } from './rooms/action-packet';
import { RoomRuntime } from './rooms/room-runtime';
import { SyncService } from './rooms/sync-service';
import { InMemoryStore, type ServerStateStore } from './rooms/state-store';
import { buildPlayerView } from './projection/view-builder';
import { decodeChoiceAnswer } from './projection/choice-view';
import { createDebugRouter } from './projection/debug-channel';
import { projectActionOptions } from './projection/action-options';
import { decodeAbilityId } from './projection/wire-identifiers';

export interface ApplicationOptions {
  environment?: NodeJS.ProcessEnv;
  settings?: AuthConfig;
  store?: ServerStateStore;
  now?: () => number;
  databasePath?: string;
  configuration?: unknown;
  effectiveConfig?: ServerConfig;
  gameplay?: () => RoomSettings;
  auditPath?: string;
}

/** Application composition is reusable by short HTTP/socket acceptance tests. */
export function createGameApplication(options: ApplicationOptions = {}) {
  const environment = options.environment ?? process.env, config = options.effectiveConfig ?? loadServerConfig(environment, options.configuration), settings = options.settings ?? config.auth;
  const now = options.now ?? Date.now, origins = new Set(config.origins), root = path.resolve(__dirname, '..', '..', '..');
  const inspectionEnabled = () => config.inspectionEnabled;
  const setup = snapshotSetupConfig({ ...(config.rooms.preset === 'development' ? gameConfig.setup : getSetupPreset(config.rooms.preset)), ...config.rooms.rules });
  const roomSettings = options.gameplay ?? (() => ({ setup, debugMode: config.debugMode }));
  if (options.store && options.databasePath) throw new Error('Choose one storage provider');
  if (options.databasePath !== undefined && !options.databasePath.trim()) throw new Error('Database path must not be empty');
  const catalog = buildCatalog();
  const persistent = options.databasePath ? new SqliteStore(options.databasePath, config.storage) : undefined;
  const app = express(), server = http.createServer(app), store = options.store ?? new InMemoryStore(persistent, persistent, persistent);
  const audit = new AuditService(store.audit, options.auditPath ?? environment.ADMIN_AUDIT_PATH ?? '', now);
  const decks = new DeckService(store.decks, catalog, now, config.storage.maxDecksPerAccount);
  const auth = new AuthService(store.auth, store, settings, now);
  let auditTimer: ReturnType<typeof setInterval> | undefined;
  const ready = auth.ready.then(() => bootstrapAdmin(auth, environment)).then(() => {
    audit.flush(); auditTimer = setInterval(() => audit.flush(), config.logging.auditFlushMs); auditTimer.unref();
  });
  void ready.catch(() => persistent?.close());
  const io = new SocketIOServer(server, {
    cors: { origin: (origin, callback) => callback(null, originAllowed(origins, origin)), methods: ['GET', 'POST'], allowedHeaders: ['Content-Type', 'Authorization'] },
    allowRequest: (request, callback) => callback(null, originAllowed(origins, request.headers.origin)),
  });
  const deltaPath = config.logging.deltaPath ? path.resolve(root, config.logging.deltaPath) : '';
  const sync = new SyncService(io, deltaPath), logs = new DiagnosticLogReader(deltaPath, config.logging);
  const runtime = new RoomRuntime(store, {
    publishDelta: request => {
      const delta = sync.buildDelta(request.oldState, request.mutations, { action: request.action, playerId: request.playerId, batches: request.batches });
      sync.broadcast(delta, request.room, playerId => request.recipients.get(playerId) ?? playerId);
    },
    roomDestroyed: ({ roomId, socketIds }) => {
      store.auth.deleteRoomSeats(roomId);
      for (const socketId of socketIds) io.to(socketId).emit('roomDestroyed', { protocolVersion: PROTOCOL_VERSION, roomId });
    },
  }, config.rooms.reconnectGraceMs, {}, roomSettings);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: environment.NODE_ENV === 'production' ? [] : null } },
    strictTransportSecurity: environment.NODE_ENV === 'production' ? undefined : false }));
  app.use(originPolicy(origins));
  app.use(express.json({ limit: config.http.bodyLimitBytes }));
  app.use('/api', (_request, response, next) => { response.setHeader('Cache-Control', 'no-store'); void ready.then(() => next()).catch(next); });
  app.use('/api/auth', createAuthRouter(auth, settings));
  app.use('/api/cards', createCatalogRouter(catalog, config.http.pageSize));
  app.use('/api/decks', createDecksRouter(auth, decks, config.http.pageSize));
  app.use('/api/admin', createAdminRouter({ auth, store, config, audit, logs }));
  app.use('/api/debug', createDebugRouter({ findRoom: roomId => store.getRoom(roomId), enabled: inspectionEnabled, authorize: request => inspectorIdentity(auth, request),
    onInspect: (identity, roomId) => { audit.record(identity.accountId, 'room.inspect', roomId); audit.flush(); } }));
  app.use('/api', (_request, response) => { response.status(404).json({ protocolVersion: PROTOCOL_VERSION, message: 'API route not found.' }); });
  app.use(express.static(path.join(__dirname, '..', '..', 'game-client', 'dist')));
  if (config.profile !== 'production') app.use('/admin', express.static(path.join(__dirname, '..', '..', 'admin', 'dist')));
  const errors: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    const status = error instanceof AuthError ? error.status : typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large' ? 413 : error instanceof SyntaxError ? 400 : 500;
    response.status(status).json({ protocolVersion: PROTOCOL_VERSION, message: error instanceof AuthError ? error.message : status === 500 ? 'Request could not be completed.' : 'Invalid request body.' });
  };
  app.use(errors);

  const snapshot = (room: GameRoom, playerId: string) => ({ protocolVersion: PROTOCOL_VERSION, seq: sync.currentSeq(room.roomId), room: buildPlayerView(room, playerId) });
  const publishSnapshot = (room: GameRoom) => {
    for (const [playerId, socketId] of runtime.recipientsFor(room)) io.to(socketId).emit('roomSnapshot', snapshot(room, playerId));
  };
  const retireSocket = (socket: Socket) => { runtime.disconnect(socket.id, true); socket.disconnect(true); };
  const selectedCards = (identity: SocketIdentity, deckId?: string) => {
    if (deckId) {
      if (identity.session.subject.kind !== 'account') throw new AuthError(403, 'Sign in to play a saved deck.');
      return decks.matchCards(identity.session.subject.id, deckId);
    }
    const fixturesEnabled = config.debugMode !== 'off' && config.fixturesEnabled;
    if (!fixturesEnabled) throw new AuthError(400, 'Select an owned saved deck before joining a match.');
    return undefined;
  };
  const unsubscribe = auth.sessions.onRevoke((session, reason) => {
    for (const socket of io.sockets.sockets.values()) {
      const identity = socket.data.identity as SocketIdentity | undefined;
      if (identity?.session.digest !== session.digest) continue;
      socket.emit('sessionEnded', { protocolVersion: PROTOCOL_VERSION, sessionId: session.id, reason });
      retireSocket(socket);
    }
  });
  io.use((socket, next) => {
    void ready.then(() => {
      try { socket.data.identity = authenticateHandshake(auth, socket.handshake.auth); next(); }
      catch (error) { next(error instanceof Error ? error : new Error('Authentication unavailable.')); }
    }).catch(() => next(new Error('Authentication unavailable.')));
  });
  io.on('connection', socket => {
    const identity = socket.data.identity as SocketIdentity;
    const playerId = identity.playerId;
    serverLogger.info('player:connected', 'Authenticated connection established', { playerId, socketId: socket.id });
    socket.emit('sessionReady', { ...auth.info(identity.session, identity.roomId ?? undefined), playerId });
    const rejoin = runtime.connect(socket.id, playerId, identity.roomId);
    if (rejoin.kind === 'rejoined') {
      socket.join(rejoin.roomId); socket.emit('rejoined', { protocolVersion: PROTOCOL_VERSION, roomId: rejoin.roomId, playerId });
      socket.emit('roomSnapshot', snapshot(rejoin.room, playerId));
    } else if (rejoin.kind === 'rejoin_failed') socket.emit('rejoinFailed', { protocolVersion: PROTOCOL_VERSION, reason: rejoin.reason });

    let expiryTimer: ReturnType<typeof setTimeout>;
    const scheduleExpiry = () => {
      expiryTimer = setTimeout(() => { if (auth.sessions.validateDigest(identity.session.digest)) scheduleExpiry(); }, Math.max(1, identity.session.expiresAt - now()));
      expiryTimer.unref();
    };
    scheduleExpiry();
    socket.use((_packet, next) => {
      if (auth.sessions.validateDigest(identity.session.digest)) { next(); return; }
      if (socket.connected) retireSocket(socket);
    });
    socket.on('createRoom', (input: unknown) => {
      const parsed = RoomSetupRequestSchema.safeParse(input);
      if (!parsed.success) { socket.emit('error', { protocolVersion: PROTOCOL_VERSION, message: 'Invalid create room packet' }); return; }
      let cards: string[] | undefined;
      try { cards = selectedCards(identity, parsed.data.deckId); }
      catch (error) { socket.emit('error', { protocolVersion: PROTOCOL_VERSION, message: error instanceof AuthError ? error.message : 'Deck selection failed.' }); return; }
      const creator = auth.playerId(identity.session);
      const created = runtime.createRoom(socket.id, creator, cards);
      identity.playerId = creator;
      auth.claimSeat(identity.session, created.roomId, created.playerId);
      socket.emit('sessionReady', { ...auth.info(identity.session, created.roomId), playerId: creator });
      socket.join(created.roomId); socket.emit('roomCreated', { protocolVersion: PROTOCOL_VERSION, roomId: created.roomId });
      socket.emit('roomSnapshot', snapshot(created.room, created.playerId));
    });
    socket.on('joinRoom', (input: unknown) => {
      const parsed = JoinRoomRequestSchema.safeParse(input);
      if (!parsed.success) { socket.emit('error', { protocolVersion: PROTOCOL_VERSION, message: 'Invalid join room packet' }); return; }
      const { roomId, deckId } = parsed.data;
      const ownedPlayerId = auth.playerId(identity.session, roomId);
      if (store.auth.ownedSeat(roomId, `${identity.session.subject.kind}:${identity.session.subject.id}`)) {
        const restored = runtime.connect(socket.id, ownedPlayerId, roomId);
        if (restored.kind === 'rejoined') {
          identity.playerId = ownedPlayerId;
          socket.emit('sessionReady', { ...auth.info(identity.session, roomId), playerId: ownedPlayerId });
          socket.join(restored.roomId); socket.emit('rejoined', { protocolVersion: PROTOCOL_VERSION, roomId: restored.roomId, playerId: ownedPlayerId });
          socket.emit('roomSnapshot', snapshot(restored.room, ownedPlayerId)); return;
        }
      }
      let cards: string[] | undefined;
      try { cards = selectedCards(identity, deckId); }
      catch (error) { socket.emit('error', { protocolVersion: PROTOCOL_VERSION, message: error instanceof AuthError ? error.message : 'Deck selection failed.' }); return; }
      const joined = runtime.joinRoom(socket.id, ownedPlayerId, roomId, cards);
      if (joined.kind === 'not_found') { socket.emit('error', { protocolVersion: PROTOCOL_VERSION, message: 'Room not found' }); return; }
      if (joined.kind === 'already_member') { socket.emit('error', { protocolVersion: PROTOCOL_VERSION, message: 'Already seated in this room' }); return; }
      if (joined.kind === 'full') { socket.emit('roomFull', { protocolVersion: PROTOCOL_VERSION }); return; }
      identity.playerId = joined.playerId;
      auth.claimSeat(identity.session, joined.roomId, joined.playerId);
      socket.emit('sessionReady', { ...auth.info(identity.session, joined.roomId), playerId: joined.playerId });
      socket.join(joined.roomId); socket.emit('roomJoined', { protocolVersion: PROTOCOL_VERSION, roomId: joined.roomId });
      io.to(joined.roomId).emit('playerJoined', { protocolVersion: PROTOCOL_VERSION, playerId: joined.playerId });
      io.to(joined.roomId).emit('startGame', { protocolVersion: PROTOCOL_VERSION, roomId: joined.roomId });
      io.to(joined.roomId).emit('rpsPhase', { protocolVersion: PROTOCOL_VERSION, message: 'Choose Rock, Paper, or Scissors!' });
      publishSnapshot(joined.room);
    });
    socket.on('playerAction', (input: unknown) => {
      const packet = parseActionPacket(input);
      if (!packet) { socket.emit('error', { protocolVersion: PROTOCOL_VERSION, message: 'Invalid player action packet' }); return; }
      const room = store.getRoom(packet.roomId), actor = auth.playerId(identity.session, packet.roomId);
      try {
        if (room && (packet.actionId === 'activate_ability' || packet.actionId === 'tapForMana')) packet.data = decodeAbilityId(room, actor, packet.data);
        if (room && packet.actionId === 'choose') packet.data = decodeChoiceAnswer(room, actor, packet.data);
      } catch { socket.emit('error', { protocolVersion: PROTOCOL_VERSION, message: 'Invalid action option', commandId: packet.commandId, action: packet.actionId }); return; }
      const result = runtime.executePlayerAction(socket.id, packet);
      if (result.kind === 'error') { socket.emit('error', { protocolVersion: PROTOCOL_VERSION, message: result.message, commandId: result.commandId, action: result.action }); return; }
      if (result.snapshot) publishSnapshot(result.snapshot);
    });
    socket.on('getOptions', (input: unknown, acknowledge?: unknown) => {
      const data = typeof input === 'object' && input !== null && !Array.isArray(input) ? input as Record<string, unknown> : {};
      const roomId = typeof data.roomId === 'string' ? data.roomId : undefined;
      const valid = isProtocolMessage(data) && typeof data.cardUuid === 'string' && (data.zone === 'hand' || data.zone === 'battlefield');
      const options = roomId && valid ? runtime.getOptions(socket.id, roomId, data.cardUuid as string, data.zone as 'hand' | 'battlefield') : [];
      const message: OptionsMessage = { protocolVersion: PROTOCOL_VERSION, roomId: roomId ?? null, cardUuid: typeof data.cardUuid === 'string' ? data.cardUuid : null,
        zone: data.zone === 'hand' || data.zone === 'battlefield' ? data.zone : null,
        options: projectActionOptions(options, roomId ?? '', auth.playerId(identity.session, roomId)) };
      if (typeof acknowledge === 'function') acknowledge(message);
      socket.emit('optionsForCard', message);
    });
    socket.on('disconnect', () => { clearTimeout(expiryTimer); runtime.disconnect(socket.id, identity.session.subject.kind === 'account'); });
  });
  server.on('close', () => { if (auditTimer) clearInterval(auditTimer); unsubscribe(); runtime.dispose(); audit.flush(); persistent?.close(); });
  return { app, server, io, store, auth, runtime, ready, decks, config, audit };
}
