import express, { type ErrorRequestHandler } from 'express';
import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import helmet from 'helmet';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import { PROTOCOL_VERSION, AutoPassRequestSchema, PlatformResponseSchema, isProtocolMessage, PlaytestSeatAuthSchema, RoomSetupRequestSchema, JoinRoomRequestSchema, SubmitRpsSchema, RoomSnapshotRequestSchema, type ActionInspectionMessage, type OptionsMessage, type SnapshotMessage } from '@card-game/protocol';
import { createBrowserRouter } from './auth/browser-routes';
import { createPasswordLimiter } from './auth/password-rate-limit';
import { gameConfig, getRuleDefaults, getSetupPreset, snapshotSetupConfig } from './config/gameplay';
import type { RoomSettings } from './config/gameplay';
import type { GameRoom } from '@card-game/engine/types/game.room.types';
import { serverLogger } from '@card-game/engine/shared/game-logger';
import { loadServerConfig, type AuthConfig, type ServerConfig } from './config';
import { AuthService } from './auth/service';
import { loadAccountsAuthority } from './auth/accounts-authority';
import { sessionOwner, type SessionRecord } from './auth/account-store';
import { bootstrapAdmin } from './auth/bootstrap';
import { createAuthRouter, inspectorIdentity, bearerToken, requireSession } from './auth/routes';
import { AuthError } from './auth/errors';
import { createAdminRouter } from './http/admin-router';
import { createCatalogRouter } from './http/catalog-router';
import { createDecksRouter } from './http/decks-router';
import { buildCatalog } from './catalog/catalog';
import { DeckService } from './decks/deck-service';
import { loadStarterDecks } from './decks/starter-decks';
import { SqliteStore } from './stores/sqlite-store';
import { AuditService } from './admin/audit';
import { DiagnosticLogReader } from './admin/log-reader';
import { originAllowed, originPolicy } from './http/origin-policy';
import { authenticateHandshake, type SocketIdentity } from './realtime/handshake';
import { parseActionPacket, type ActionPacket } from './rooms/action-packet';
import { RoomRuntime } from './rooms/room-runtime';
import { SyncService } from './rooms/sync-service';
import { InMemoryStore, type ServerStateStore } from './rooms/state-store';
import { buildPlayerView } from './projection/view-builder';
import { decodeChoiceAnswer, projectActionInspection } from './projection/choice-view';
import { createDebugRouter } from './projection/debug-channel';
import { projectActionOptions } from './projection/action-options';
import { decodeAbilityId } from './projection/wire-identifiers';

import { MemoryScenarioRepository } from './scenarios/repository';
import { ScenarioService, scenariosEnabled } from './scenarios/service';
import { createScenariosRouter } from './http/scenarios-router';
import { createPlaytestRouter } from './http/playtest-router';
import { createOperatorPlaytestRouter } from './http/operator-playtest-router';

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
  publicClientDirectory?: string;
  accountsFetch?: typeof fetch;
}

/** Application composition is reusable by short HTTP/socket acceptance tests. */
export function createGameApplication(options: ApplicationOptions = {}) {
  const environment = options.environment ?? process.env, config = options.effectiveConfig ?? loadServerConfig(environment, options.configuration), settings = options.settings ?? config.auth;
  const now = options.now ?? Date.now, origins = new Set(config.origins), root = path.resolve(__dirname, '..', '..', '..');
  const inspectionEnabled = () => config.inspectionEnabled;
  const setup = config.fixturesEnabled ? snapshotSetupConfig({ ...(config.rooms.preset === 'development' ? gameConfig.setup : getSetupPreset(config.rooms.preset)), ...config.rooms.rules }) : { ...getRuleDefaults(), ...config.rooms.rules, developmentDeck: [], shuffleDevelopmentDeck: false };
  const roomSettings = options.gameplay ?? (() => ({ setup, debugMode: config.debugMode }));
  if (options.store && options.databasePath) throw new Error('Choose one storage provider');
  if (options.databasePath !== undefined && !options.databasePath.trim()) throw new Error('Database path must not be empty');
  const authority = loadAccountsAuthority(environment, config.profile, options.accountsFetch, projectId => persistent?.bindAccountProject(projectId));
  const catalog = buildCatalog();
  const persistent = options.databasePath ? new SqliteStore(options.databasePath, config.storage, {
    ...config.navigation, accountProjectId: authority?.projectId,
  }, !!authority, loadStarterDecks(catalog)) : undefined;
  const app = express(), server = http.createServer(app), store = options.store ?? new InMemoryStore(persistent, persistent, persistent);
  const audit = new AuditService(store.audit, options.auditPath ?? environment.ADMIN_AUDIT_PATH ?? '', now);
  const decks = new DeckService(store.decks, catalog, now, config.storage.maxDecksPerAccount);
  const auth = new AuthService(store.auth, store, settings, now, authority);
  let auditTimer: ReturnType<typeof setInterval> | undefined;
  const ready = auth.ready.then(() => authority ? authority.probeProject().catch(error => {
    if (!(error instanceof AuthError) || error.status !== 503) throw error;
    serverLogger.warn('auth:project:unavailable', '4A is unavailable at startup. Account operations will retry.');
  }) : bootstrapAdmin(auth, environment)).then(() => {
    audit.flush(); auditTimer = setInterval(() => audit.flush(), config.logging.auditFlushMs); auditTimer.unref();
  });
  void ready.catch(() => persistent?.close());
  const io = new SocketIOServer(server, {
    cors: { origin: (origin, callback) => callback(null, originAllowed(origins, origin)), methods: ['GET', 'POST'], allowedHeaders: ['Content-Type', 'Authorization'] },
    allowRequest: (request, callback) => callback(null, originAllowed(origins, request.headers.origin)),
  });
  const deltaPath = config.logging.deltaPath ? path.resolve(root, config.logging.deltaPath) : '';
  const sync = new SyncService(io, deltaPath), logs = new DiagnosticLogReader(deltaPath, config.logging);
  const currentAccess = new Map<string, () => Promise<void>>();
  const matchPaused = (roomId: string): boolean => {
    const room = store.getRoom(roomId);
    if (!authority || !room || runtime.isTestRoom(roomId)) return false;
    return [...runtime.recipientsFor(room).values()].some(socketId => {
      const identity = io.sockets.sockets.get(socketId)?.data.identity as SocketIdentity | undefined;
      return !!identity && !auth.canPlay(identity.session);
    });
  };
  const runtime = new RoomRuntime(store, {
    publishDelta: request => {
      const { room, viewSeq } = request;
      if (viewSeq !== undefined) sync.restoreSeq(room.roomId, viewSeq);
      try {
        const delta = sync.buildDelta(request.oldState, request.mutations, {
          action: request.action, playerId: request.playerId, batches: request.batches, viewSeq,
        });
        sync.broadcast(delta, room, playerId => request.recipients.get(playerId)!);
      } catch (error) {
        serverLogger.error('delta:publish-failed', 'Could not publish committed match update', {
          roomId: room.roomId, seq: sync.currentSeq(room.roomId), reason: error instanceof Error ? error.message : 'Unknown publish failure',
        });
      }
    },
    autoPassChanged: (socketId, status) => { io.to(socketId).emit('autoPassStatus', status); },
    matchPaused: authority ? matchPaused : undefined,
    authorizeAutoPass: authority ? (socketId, roomId) => {
      const check = currentAccess.get(socketId);
      return check ? check().then(() => true, () => false) : !!io.sockets.sockets.get(socketId)?.connected && !matchPaused(roomId);
    } : undefined,
    roomDestroyed: ({ roomId, socketIds }) => {
      store.auth.deleteRoomSeats(roomId);
      for (const socketId of socketIds) {
        const socket = io.sockets.sockets.get(socketId);
        socket?.emit('roomDestroyed', { protocolVersion: PROTOCOL_VERSION, roomId });
        if (socket?.data.playtest) socket.disconnect(true);
      }
    },
  }, config.rooms.reconnectGraceMs, {}, roomSettings, config.rooms.autoPassDelayMs, persistent);
  runtime.restoreMatches((roomId, seq) => sync.restoreSeq(roomId, seq));
  const operatorTestRooms = !!authority && scenariosEnabled(config);
  const scenarios = new ScenarioService(persistent ?? new MemoryScenarioRepository(), runtime, auth, config, now, roomId => {
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.playtest?.roomId !== roomId) continue;
      socket.emit('error', { protocolVersion: PROTOCOL_VERSION, message: 'Test Room control changed. Return to Test Rooms to resume.' });
      retireSocket(socket);
    }
  });
  const roomCleanup = operatorTestRooms ? setInterval(() => { void scenarios.refreshOwnedPlaytestAccess(); }, 60000) : undefined;
  roomCleanup?.unref();
  app.disable('x-powered-by');
  app.set('trust proxy', config.http.trustProxy);
  /* Every request carries an id so a client-visible failure can be found in the
     logs. An upstream proxy may already have assigned one; reuse it rather than
     breaking the chain. */
  app.use((request, response, next) => {
    const id = request.get('x-request-id') ?? randomUUID();
    response.locals.requestId = id;
    response.setHeader('x-request-id', id);
    next();
  });
  app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: config.profile === 'production' ? [] : null } },
    strictTransportSecurity: config.profile === 'production' ? undefined : false }));
  /* Probes sit ahead of the origin policy: a load balancer or systemd check has
     no Origin header and must not be answered with a 403. Liveness only proves
     the process is up; readiness waits for migrations and admin bootstrap. */
  app.get('/healthz', (_request, response) => { response.json({ status: 'ok' }); });
  app.get('/readyz', (_request, response) => {
    void ready.then(
      () => response.json({ status: 'ready' }),
      () => response.status(503).json({ status: 'starting' }),
    );
  });
  app.use(originPolicy(origins));
  app.use((request,response,next)=>express.json({ limit: request.path.startsWith('/api/admin/scenarios') ||
    scenariosEnabled(config) && request.path.startsWith('/api/lab/playtest/') ? 32768 : config.http.bodyLimitBytes })(request,response,next));
  app.use('/api', (_request, response, next) => { response.setHeader('Cache-Control', 'no-store'); void ready.then(() => next()).catch(next); });
  const passwordLimiter = createPasswordLimiter(settings);
  app.use('/api/auth', createAuthRouter(auth, settings, passwordLimiter));
  app.use('/api/browser', createBrowserRouter(auth, config, passwordLimiter));
  app.get('/api/platform', (_request, response) => response.json(PlatformResponseSchema.parse({ protocolVersion: PROTOCOL_VERSION, navigation: config.navigation,
    capabilities: { scenarios: scenariosEnabled(config), ...(operatorTestRooms ? { operatorTestRooms: true } : {}),
      ...(authority ? { accountManagement: true } : {}) } })));
  app.use('/api/cards', createCatalogRouter(catalog, config.http.pageSize));
  app.use('/api/decks', createDecksRouter(auth, decks, config.http.pageSize, config));
  app.get('/api/rooms/:roomId/resume', async (request, response, next) => {
    try {
      const session = auth.sessions.validate(bearerToken(request));
      const id = String(request.params.roomId);
      if (!session || session.scope !== 'game' || session.kind === 'browser') throw new AuthError(401, 'A game-tab session is required.');
      await auth.authorize(session);
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || !auth.info(session, id).roomId) throw new AuthError(404, 'This room is unavailable for this game tab.');
      response.json({ protocolVersion: PROTOCOL_VERSION, sessionId: session.id, roomId: id, playerId: auth.playerId(session, id) });
    } catch (error) { next(error); }
  });
  app.use('/api/admin/scenarios', createScenariosRouter(scenarios,auth,config,audit));
  if (operatorTestRooms) app.use('/api/lab/operator/rooms', createOperatorPlaytestRouter(scenarios, auth, config));
  if (scenariosEnabled(config)) app.use('/api/lab/playtest', createPlaytestRouter(scenarios, runtime, auth, id => sync.currentSeq(id), (room, seq) => {
    sync.restoreSeq(room.roomId, seq);
    publishSnapshot(room);
  }));
  app.post('/api/lab/rooms/:id/claim',async (request,response,next)=>{
    try {
      if(!scenariosEnabled(config))throw new AuthError(404,'Scenario capability unavailable.');
      if(!request.body || Object.keys(request.body).length!==1 || request.body.protocolVersion!==1)throw new AuthError(400,'Invalid claim request.');
      const session=auth.sessions.validate(bearerToken(request));if(!session)throw new AuthError(401,'Lab game sign-in required.');
      await auth.authorize(session);
      response.json(scenarios.claim(String(request.params.id),session));
    }catch(e){next(e);}
  });
  app.use('/api/admin', createAdminRouter({ auth, store, config, audit, logs }));
  app.use('/api/debug', createDebugRouter({ findRoom: roomId => store.getRoom(roomId), enabled: inspectionEnabled, authorize: async request => {
    const identity = inspectorIdentity(auth, request);
    if (identity && authority) await auth.authorize(requireSession(auth, request));
    return identity;
  },
    onInspect: (identity, roomId) => { audit.record(identity.accountId, 'room.inspect', roomId); audit.flush(); } }));
  app.use('/api', (_request, response) => { response.status(404).json({ protocolVersion: PROTOCOL_VERSION, message: 'API route not found.' }); });
  const publicClientDirectory = path.resolve(options.publicClientDirectory ?? path.join(__dirname, '..', '..', 'game-client', 'dist'));
  app.use(express.static(publicClientDirectory));
  app.get(['/home', '/home/', '/play', '/play/', '/play/rooms/:roomId'], (_request, response) => response.sendFile(path.join(publicClientDirectory, 'index.html')));
  if (scenariosEnabled(config)) app.get('/play/test/:roomId', (_request, response) => response.sendFile(path.join(publicClientDirectory, 'index.html')));
  if (operatorTestRooms) app.get('/play/test-rooms', (_request, response) => response.sendFile(path.join(publicClientDirectory, 'index.html')));
  app.use('/deck-builder', express.static(path.join(__dirname, '..', '..', 'deck-builder', 'dist')));
  if (config.profile !== 'production') app.use('/admin', express.static(path.join(__dirname, '..', '..', 'admin', 'dist')));
  const errors: ErrorRequestHandler = (error: unknown, request, response, _next) => {
    const status = error instanceof AuthError ? error.status : typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large' ? 413 : error instanceof SyntaxError ? 400 : 500;
    /* A 500 is the only status the client cannot explain, so it is the only one
       that must leave a server-side trace. The response stays generic; the log
       carries the request id the client was given. */
    if (status === 500) {
      serverLogger.error('http:request:failed', 'Unhandled request failure', {
        requestId: response.locals.requestId as string,
        method: request.method,
        path: request.path,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
    response.status(status).json({ protocolVersion: PROTOCOL_VERSION, message: error instanceof AuthError ? error.message : status === 500 ? 'Request could not be completed.' : 'Invalid request body.' });
  };
  app.use(errors);

  const opponentOf = (room: GameRoom, playerId: string) => playerId === room.player1Id ? room.player2Id : room.player1Id;
  const connectedSeats = (room: GameRoom) => new Map([...runtime.recipientsFor(room)]
    .filter(([, socketId]) => runtime.currentRoom(socketId) === room.roomId));
  const snapshot = (room: GameRoom, playerId: string): SnapshotMessage => {
    const run = runtime.isTestRoom(room.roomId) ? scenarios.run(room.roomId) : null;
    const opponentId = opponentOf(room, playerId);
    return {
      protocolVersion: PROTOCOL_VERSION,
      seq: sync.currentSeq(room.roomId),
      room: buildPlayerView(room, playerId),
      lobbyRps: runtime.lobbyView(room.roomId, playerId),
      ...(opponentId ? { opponentConnected: connectedSeats(room).has(opponentId) } : {}),
      ...(run ? { testContext: { scenarioId: run.scenarioId, revision: run.revision, name: run.snapshot.name } } : {}),
    };
  };
  const publishSnapshot = (room: GameRoom) => {
    for (const [playerId, socketId] of runtime.recipientsFor(room)) io.to(socketId).emit('roomSnapshot', snapshot(room, playerId));
  };
  const publishMatchAccess = (roomId: string): void => {
    const room = store.getRoom(roomId);
    if (!authority || !room || runtime.isTestRoom(roomId)) return;
    const paused = matchPaused(roomId);
    let changed = false;
    for (const socketId of runtime.recipientsFor(room).values()) {
      const socket = io.sockets.sockets.get(socketId);
      if (!socket || socket.data.matchAccess?.roomId === roomId && socket.data.matchAccess.paused === paused) continue;
      socket.data.matchAccess = { roomId, paused };
      socket.emit('matchAccess', { protocolVersion: PROTOCOL_VERSION, roomId, paused });
      changed = true;
    }
    if (changed) runtime.refreshAutoPass(roomId);
  };
  const publishPresence = (room: GameRoom) => {
    if (!room.player2Id) return;
    const recipients = connectedSeats(room);
    for (const [playerId, socketId] of recipients) {
      const opponentId = opponentOf(room, playerId);
      io.to(socketId).emit('opponentPresence', { protocolVersion: PROTOCOL_VERSION, roomId: room.roomId,
        connected: !!opponentId && recipients.has(opponentId) });
    }
    publishMatchAccess(room.roomId);
  };
  const disconnectSeat = (socket: Socket, preserveSeat: boolean) => {
    const roomId = runtime.currentRoom(socket.id);
    runtime.disconnect(socket.id, preserveSeat);
    const room = roomId ? store.getRoom(roomId) : undefined;
    if (room) publishPresence(room);
  };
  const retireSocket = (socket: Socket) => { disconnectSeat(socket, true); socket.disconnect(true); };
  const pausedMessage = 'Account service unavailable. Play will resume automatically.';
  const rejectPausedAction = (socket: Socket, event: string, args: unknown[]) => {
    const acknowledge = args[args.length - 1];
    if (event === 'playerAction' && typeof acknowledge === 'function') acknowledge({ accepted: false, message: pausedMessage });
    else if (event === 'inspectPlayerAction' && typeof acknowledge === 'function')
      acknowledge({ protocolVersion: PROTOCOL_VERSION, kind: 'unavailable', reason: pausedMessage });
    else socket.emit('error', { protocolVersion: PROTOCOL_VERSION, message: pausedMessage });
  };
  const enforceMatchAccess = (socket: Socket, session: SessionRecord) => {
    socket.use(([event, ...args], next) => {
      if (!auth.sessions.validateDigest(session.digest)) {
        if (socket.connected) retireSocket(socket);
        return;
      }
      const roomId = runtime.currentRoom(socket.id);
      const advancesMatch = event === 'playerAction' || event === 'submitRps' || event === 'inspectPlayerAction';
      if (event === 'leaveRoom' || auth.canPlay(session) && !(advancesMatch && roomId && matchPaused(roomId))) {
        next();
        return;
      }
      if (roomId) publishMatchAccess(roomId);
      rejectPausedAction(socket, event, args);
    });
  };
  // One loop for ordinary connections. AuthService shares the in-flight check
  // across game tabs and the browser session that issued them.
  const matchAccessTimer = authority ? setInterval(() => {
    void auth.retryAuthorityLogouts();
    const rooms = new Set<string>();
    for (const socket of io.sockets.sockets.values()) {
      const identity = socket.data.identity as SocketIdentity | undefined;
      if (identity?.session.subject.kind !== 'account') continue;
      const roomId = runtime.currentRoom(socket.id);
      if (roomId) rooms.add(roomId);
      void auth.refreshPlayAccess(identity.session).catch(() => {
        // The last verified decision still has its original deadline.
      }).then(() => {
        if (socket.connected && roomId && runtime.currentRoom(socket.id) === roomId) publishMatchAccess(roomId);
      });
    }
    for (const roomId of rooms) publishMatchAccess(roomId);
  }, 5000) : undefined;
  matchAccessTimer?.unref();
  const enforcePlaytestAccess = (socket: Socket, roomId: string, localSession: () => SessionRecord | undefined) => {
    const authorize = async () => {
      const session = localSession();
      if (!session) throw new AuthError(401, 'Sign in again.');
      await auth.authorize(session, 'lab.operate');
      if (!localSession()) throw new AuthError(401, 'Sign in again.');
    };
    const close = (error: unknown) => {
      if (!socket.connected || error instanceof AuthError && error.status === 503) return;
      const message = error instanceof AuthError ? error.message : 'Account service unavailable. Try again shortly.';
      socket.emit('error', { protocolVersion: PROTOCOL_VERSION, message });
      if (error instanceof AuthError && error.status === 403) {
        const session = localSession();
        if (session) scenarios.revokePlaytests(session.digest);
      }
      if (socket.connected) retireSocket(socket);
    };
    if (!authority || localSession()?.subject.kind === 'guest') {
      socket.use((_packet, next) => { if (localSession()) next(); else if (socket.connected) retireSocket(socket); });
      return;
    }
    let paused = false;
    const setPaused = (value: boolean) => {
      if (!socket.connected || value === paused) return;
      paused = value;
      socket.emit('matchAccess', { protocolVersion: PROTOCOL_VERSION, roomId, paused });
      if (!paused) runtime.refreshAutoPass(roomId);
    };
    let pending: Promise<void> | undefined;
    const check = () => pending ??= authorize().then(() => setPaused(false), error => {
      if (error instanceof AuthError && error.status === 503) setPaused(true);
      throw error;
    }).finally(() => { pending = undefined; });
    currentAccess.set(socket.id, check);
    socket.use(([event, ...args], next) => {
      void check().then(() => { if (socket.connected) next(); }).catch(error => {
        if (error instanceof AuthError && error.status === 503) rejectPausedAction(socket, event, args);
        else close(error);
      });
    });
    const timer = setInterval(() => { void check().catch(close); }, 3000);
    timer.unref();
    socket.once('disconnect', () => { clearInterval(timer); currentAccess.delete(socket.id); });
  };
  const selectedCards = (identity: SocketIdentity, deckId?: string, action = 'joining') => {
    if (deckId) {
      if (identity.session.subject.kind !== 'account') throw new AuthError(403, 'Sign in to play a saved deck.');
      return decks.matchCards(identity.session.subject.id, deckId);
    }
    const fixturesEnabled = config.debugMode !== 'off' && config.fixturesEnabled;
    if (!fixturesEnabled) throw new AuthError(400, `Select an owned saved deck before ${action} a match.`);
    return undefined;
  };
  const registerMatchHandlers = (socket: Socket, viewer: (roomId?: string) => string,
    ownsSeat: (roomId: string, playerId: string) => boolean, session: SessionRecord) => {
    socket.on('requestRoomSnapshot', (input: unknown) => {
      const parsed = RoomSnapshotRequestSchema.safeParse(input);
      if (!parsed.success) return;
      const { roomId } = parsed.data;
      if (runtime.currentRoom(socket.id) !== roomId) return;
      const room = store.getRoom(roomId);
      const viewerId = viewer(roomId);
      if (!room || (room.player1Id !== viewerId && room.player2Id !== viewerId)) return;
      if (!ownsSeat(roomId, viewerId)) return;
      socket.emit('roomSnapshot', snapshot(room, viewerId));
    });
    socket.on('setAutoPass', (input: unknown) => {
      const parsed = AutoPassRequestSchema.safeParse(input);
      if (!parsed.success || !runtime.setAutoPass(socket.id, parsed.data.roomId, parsed.data.enabled, parsed.data.untilTurn)) {
        socket.emit('error', { protocolVersion: PROTOCOL_VERSION, message: 'Invalid auto-pass preference or room membership.' });
      }
    });
    const decodeActionOptions = (packet: ActionPacket, room: GameRoom, actor: string): void => {
      if (packet.actionId === 'activate_ability' || packet.actionId === 'tapForMana')
        packet.data = decodeAbilityId(room, actor, packet.data);
      if (packet.actionId === 'choose') packet.data = decodeChoiceAnswer(room, actor, packet.data);
    };
    socket.on('inspectPlayerAction', (input: unknown, acknowledge: unknown) => {
      if (typeof acknowledge !== 'function') return;
      const reply = (result: ActionInspectionMessage) => acknowledge(result);
      const reject = (reason: string) => reply({ protocolVersion: PROTOCOL_VERSION, kind: 'unavailable', reason });
      const packet = parseActionPacket(input);
      if (!packet) return reject('Invalid player action packet');
      const room = store.getRoom(packet.roomId);
      if (!room || runtime.currentRoom(socket.id) !== packet.roomId)
        return reject('This socket is not seated in that room');
      const actor = viewer(packet.roomId);
      try { decodeActionOptions(packet, room, actor); }
      catch { return reject('Invalid action option'); }
      reply(projectActionInspection(room, actor, runtime.inspectPlayerAction(socket.id, packet)));
    });
    socket.on('playerAction', (input: unknown, acknowledge?: (receipt: import('@card-game/protocol').PlayerActionReceipt) => void) => {
      const reply = typeof acknowledge === 'function' ? acknowledge : undefined;
      const packet = parseActionPacket(input);
      if (!packet) {
        const message = 'Invalid player action packet';
        if (reply) reply({ accepted: false, message });
        else socket.emit('error', { protocolVersion: PROTOCOL_VERSION, message });
        return;
      }
      const result = runtime.executePlayerAction(socket.id, packet, (room, actor) => {
        decodeActionOptions(packet, room, actor);
        return packet.data;
      });
      if (result.kind === 'error') {
        if (reply) reply({ accepted: false, message: result.message });
        else socket.emit('error', { protocolVersion: PROTOCOL_VERSION, message: result.message, commandId: result.commandId, action: result.action });
        return;
      }
      const room = result.duplicate ? store.getRoom(packet.roomId) : undefined;
      if (room) socket.emit('roomSnapshot', snapshot(room, viewer(packet.roomId)));
      if (authority && !result.duplicate) void auth.activity(session, 'player_command').catch(() => {
        serverLogger.warn('auth:activity:failed', 'Could not record player activity');
      });
      reply?.({ accepted: true });
    });
    socket.on('getOptions', (input: unknown, acknowledge?: unknown) => {
      const data = typeof input === 'object' && input !== null && !Array.isArray(input) ? input as Record<string, unknown> : {};
      const roomId = typeof data.roomId === 'string' ? data.roomId : undefined;
      const valid = isProtocolMessage(data) && typeof data.cardUuid === 'string' && (data.zone === 'hand' || data.zone === 'battlefield');
      const options = roomId && valid ? runtime.getOptions(socket.id, roomId, data.cardUuid as string, data.zone as 'hand' | 'battlefield') : [];
      const message: OptionsMessage = { protocolVersion: PROTOCOL_VERSION, roomId: roomId ?? null, cardUuid: typeof data.cardUuid === 'string' ? data.cardUuid : null,
        zone: data.zone === 'hand' || data.zone === 'battlefield' ? data.zone : null,
        options: projectActionOptions(options, roomId ?? '', viewer(roomId)) };
      if (typeof acknowledge === 'function') acknowledge(message);
      socket.emit('optionsForCard', message);
    });
  };
  const unsubscribe = auth.sessions.onRevoke((session, reason) => {
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.playtest?.operator.digest === session.digest) {
        socket.emit('sessionEnded', { protocolVersion: PROTOCOL_VERSION, sessionId: session.id, reason });
        retireSocket(socket);
        continue;
      }
      const identity = socket.data.identity as SocketIdentity | undefined;
      if (identity?.session.digest !== session.digest) continue;
      socket.emit('sessionEnded', { protocolVersion: PROTOCOL_VERSION, sessionId: session.id, reason });
      retireSocket(socket);
    }
    scenarios.revokePlaytests(session.digest);
  });
  io.use((socket, next) => {
    void ready.then(async () => {
      try {
        const parsed = PlaytestSeatAuthSchema.safeParse(socket.handshake.auth);
        if (parsed.success) {
          const seat = scenarios.playtestSeat(parsed.data.roomId, parsed.data.playtestToken);
          if (!seat) throw new Error('The playtest seat is no longer available.');
          await auth.authorize(seat.operator, 'lab.operate');
          if (!scenarios.playtestSeat(parsed.data.roomId, parsed.data.playtestToken))
            throw new Error('The playtest seat is no longer available.');
          socket.data.playtest = { ...seat, ...parsed.data };
        } else {
          const identity = authenticateHandshake(auth, socket.handshake.auth);
          await auth.authorize(identity.session);
          socket.data.identity = identity;
        }
        next();
      }
      catch (error) { next(error instanceof Error ? error : new Error('Authentication unavailable.')); }
    }).catch(() => next(new Error('Authentication unavailable.')));
  });
  const watchSessionExpiry = (session: SessionRecord) => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      // Node otherwise turns a delay above its signed 32-bit limit into 1 ms.
      const remaining = Math.max(1, session.expiresAt - now());
      timer = setTimeout(() => {
        if (auth.sessions.validateDigest(session.digest)) schedule();
      }, Math.min(remaining, 2_147_483_647));
      timer.unref();
    };
    schedule();
    return () => clearTimeout(timer);
  };
  io.on('connection', socket => {
    const playtest = socket.data.playtest as (NonNullable<ReturnType<typeof scenarios.playtestSeat>> & { roomId: string; playtestToken: string }) | undefined;
    if (playtest) {
      const { roomId, playerId, operator, playtestToken } = playtest;
      const rejoin = runtime.connect(socket.id, playerId, roomId);
      if (rejoin.kind !== 'rejoined') { socket.disconnect(true); return; }
      const stopExpiryWatch = watchSessionExpiry(operator);
      socket.on('disconnect', () => { stopExpiryWatch(); disconnectSeat(socket, true); });
      enforcePlaytestAccess(socket, roomId, () => scenarios.playtestSeat(roomId, playtestToken)?.operator);
      registerMatchHandlers(socket, () => playerId, (id, viewer) => id === roomId && viewer === playerId, operator);
      socket.emit('roomSnapshot', snapshot(rejoin.room, playerId));
      publishPresence(rejoin.room);
      return;
    }
    const identity = socket.data.identity as SocketIdentity;
    const playerId = identity.playerId;
    serverLogger.info('player:connected', 'Authenticated connection established', { playerId, socketId: socket.id });
    socket.emit('sessionReady', { ...auth.info(identity.session, identity.roomId ?? undefined), playerId });
    const rejoin = identity.rejoinDenied ? { kind: 'rejoin_failed' as const, reason: 'This session does not own an available room seat.' } : runtime.connect(socket.id, playerId, identity.roomId);
    if (rejoin.kind === 'rejoined') {
      socket.join(rejoin.roomId); socket.emit('rejoined', { protocolVersion: PROTOCOL_VERSION, roomId: rejoin.roomId, playerId });
      socket.emit('roomSnapshot', snapshot(rejoin.room, playerId));
      publishPresence(rejoin.room);
    } else if (rejoin.kind === 'rejoin_failed') socket.emit('rejoinFailed', { protocolVersion: PROTOCOL_VERSION, reason: rejoin.reason });

    const stopExpiryWatch = watchSessionExpiry(identity.session);
    enforceMatchAccess(socket, identity.session);
    registerMatchHandlers(socket, roomId => auth.playerId(identity.session, roomId),
      (roomId, viewerId) => store.auth.seatOwner(roomId, viewerId) === sessionOwner(identity.session), identity.session);
    socket.on('leaveRoom', (input: unknown) => {
      if (!isProtocolMessage(input) || typeof input !== 'object' || input === null ||
          !('roomId' in input) || typeof input.roomId !== 'string') {
        socket.emit('error', { protocolVersion: PROTOCOL_VERSION, message: 'Invalid leave room packet' }); return;
      }
      const roomId = input.roomId;
      const actor = auth.playerId(identity.session, roomId);
      if (store.auth.seatOwner(roomId, actor) === undefined) {
        if (!runtime.currentRoom(socket.id)) socket.emit('roomLeft', { protocolVersion: PROTOCOL_VERSION, roomId });
        return;
      }
      const left = runtime.leaveRoom(socket.id, roomId);
      if (!left) { socket.emit('error', { protocolVersion: PROTOCOL_VERSION, message: 'Not seated in this room' }); return; }
      store.auth.deleteSeat(roomId, left.playerId);
      void socket.leave(roomId);
      socket.emit('roomLeft', { protocolVersion: PROTOCOL_VERSION, roomId });
      delete socket.data.matchAccess;
      identity.playerId = auth.playerId(identity.session);
      socket.emit('sessionReady', auth.info(identity.session));
      const room = store.getRoom(roomId);
      if (room) publishPresence(room);
    });
    socket.on('createRoom', (input: unknown) => {
      if (runtime.currentRoom(socket.id)) {
        socket.emit('error', { protocolVersion: PROTOCOL_VERSION, message: 'Leave the current room first.' }); return;
      }
      const parsed = RoomSetupRequestSchema.safeParse(input);
      if (!parsed.success) { socket.emit('error', { protocolVersion: PROTOCOL_VERSION, message: 'Invalid create room packet' }); return; }
      let cards: string[] | undefined;
      try { auth.assertRoomAvailable(identity.session); cards = selectedCards(identity, parsed.data.deckId, 'creating'); }
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
      if (runtime.currentRoom(socket.id) && runtime.currentRoom(socket.id) !== roomId) {
        socket.emit('error', { protocolVersion: PROTOCOL_VERSION, message: 'Leave the current room first.' }); return;
      }
      if(runtime.isTestRoom(roomId)){socket.emit('error',{protocolVersion:PROTOCOL_VERSION,message:'Claim an assigned test seat before reconnecting.'});return;}
      const ownedPlayerId = auth.playerId(identity.session, roomId);
      if (store.auth.ownedSeat(roomId, sessionOwner(identity.session))) {
        const restored = runtime.connect(socket.id, ownedPlayerId, roomId);
        if (restored.kind === 'rejoined') {
          identity.playerId = ownedPlayerId;
          socket.emit('sessionReady', { ...auth.info(identity.session, roomId), playerId: ownedPlayerId });
          socket.join(restored.roomId); socket.emit('rejoined', { protocolVersion: PROTOCOL_VERSION, roomId: restored.roomId, playerId: ownedPlayerId });
          socket.emit('roomSnapshot', snapshot(restored.room, ownedPlayerId));
          publishPresence(restored.room);
          return;
        }
      }
      let cards: string[] | undefined;
      try {
        auth.assertRoomAvailable(identity.session, roomId);
        const occupied = identity.session.subject.kind === 'account'
          ? store.auth.accountSeats(identity.session.subject.id).find(seat => seat.roomId === roomId) : undefined;
        if (occupied && occupied.owner !== sessionOwner(identity.session)) {
          throw new AuthError(409, 'Another game tab owns this account’s room.');
        }
        cards = selectedCards(identity, deckId);
      }
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
      publishSnapshot(joined.room);
      publishMatchAccess(joined.roomId);
    });
    socket.on('submitRps', (input: unknown) => {
      const parsed = SubmitRpsSchema.safeParse(input);
      if (!parsed.success) { socket.emit('error', { protocolVersion: PROTOCOL_VERSION, message: 'Invalid opening pick' }); return; }
      const { roomId, pick } = parsed.data;
      const result = runtime.submitRps(socket.id, roomId, pick);
      if (result.kind === 'error') { socket.emit('error', { protocolVersion: PROTOCOL_VERSION, message: result.message }); return; }
      publishSnapshot(result.room);
      if (result.kind === 'started') for (const socketId of runtime.recipientsFor(result.room).values()) {
        io.to(socketId).emit('startGame', { protocolVersion: PROTOCOL_VERSION, roomId, firstPlayerId: result.firstPlayerId, picks: result.picks });
      }
    });
    socket.on('disconnect', () => { stopExpiryWatch(); disconnectSeat(socket, identity.session.subject.kind === 'account'); });
  });
  server.on('close', () => { if (auditTimer) clearInterval(auditTimer); if (roomCleanup) clearInterval(roomCleanup); if (matchAccessTimer) clearInterval(matchAccessTimer); unsubscribe(); runtime.dispose(); audit.flush(); persistent?.close(); });
  return { app, server, io, store, auth, runtime, ready, decks, config, audit, scenarios };
}
