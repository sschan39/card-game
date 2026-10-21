import { v4 as uuidv4 } from 'uuid';
import { GameEngine } from '../engine/game-engine';
import { OptionService, type ActionOption } from '../engine/option-service';
import { createRoom, joinRoom, setupRPS } from '../engine/room-factory';
import type { AppliedEventBatch } from '../types/game-event.types';
import type { GameMutation } from '../types/game-mutation.types';
import type { GameRoom, PlayerId } from '../types/game.room.types';
import { serverLogger } from '../shared/game-logger';
import type { StateStore } from './state-store';
import {
  bindSocket,
  createIdentityMaps,
  decideRejoin,
  resolvePlayerId,
  unbindRoom,
  unbindSocket,
} from './reconnect';

export interface RoomDeltaRequest {
  oldState: GameRoom;
  room: GameRoom;
  mutations: GameMutation[];
  action: string;
  playerId: PlayerId;
  batches: AppliedEventBatch[];
  recipients: ReadonlyMap<PlayerId, string>;
}

export interface RoomDestroyedNotice {
  roomId: string;
  socketIds: string[];
}

export interface RoomRuntimePorts {
  publishDelta(request: RoomDeltaRequest): void;
  roomDestroyed(notice: RoomDestroyedNotice): void;
}

export type ConnectResult =
  | { kind: 'no_rejoin' }
  | { kind: 'rejoined'; roomId: string; playerId: PlayerId; room: GameRoom }
  | { kind: 'rejoin_failed'; reason: 'room_destroyed' | 'not_a_member' };

export type JoinRoomResult =
  | { kind: 'not_found' }
  | { kind: 'full' }
  | { kind: 'joined'; roomId: string; playerId: PlayerId; room: GameRoom };

export class RoomRuntime {
  private readonly engines = new Map<string, GameEngine>();
  private readonly socketRooms = new Map<string, string>();
  private readonly destroyTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly identity = createIdentityMaps();
  private readonly optionService = new OptionService();

  constructor(
    private readonly store: StateStore,
    private readonly ports: RoomRuntimePorts,
    private readonly gracePeriodMs = 30_000,
  ) {}

  connect(socketId: string, authPlayerId?: PlayerId, authRoomId?: string | null): ConnectResult {
    if (!authPlayerId || !authRoomId) return { kind: 'no_rejoin' };

    const decision = decideRejoin(roomId => this.store.getRoom(roomId), authPlayerId, authRoomId);
    if (decision.kind !== 'rejoin') {
      serverLogger.warn('player:rejoin:failed', `rejoin failed for ${authPlayerId}: ${decision.reason}`, {
        roomId: authRoomId,
        playerId: authPlayerId,
        reason: decision.reason,
      });
      return decision;
    }

    bindSocket(this.identity, socketId, authPlayerId);
    this.socketRooms.set(socketId, authRoomId);
    this.cancelScheduledDestroy(authRoomId);
    this.getOrCreateEngine(authRoomId);
    serverLogger.info('player:rejoined', `player ${authPlayerId} rejoined room ${authRoomId}`, {
      roomId: authRoomId,
      playerId: authPlayerId,
      socketId,
    });
    return { kind: 'rejoined', roomId: authRoomId, playerId: authPlayerId, room: decision.room };
  }

  createRoom(socketId: string, authPlayerId?: PlayerId): { roomId: string; playerId: PlayerId; room: GameRoom } {
    const roomId = uuidv4();
    const playerId = authPlayerId ?? (socketId as PlayerId);
    bindSocket(this.identity, socketId, playerId);
    this.socketRooms.set(socketId, roomId);

    const room = createRoom(roomId, playerId);
    this.store.saveRoom(room);
    this.replaceRoomEngine(room);
    serverLogger.info('room:created', `room created: ${roomId}`, { roomId, playerId });
    return { roomId, playerId, room };
  }

  joinRoom(socketId: string, authPlayerId: PlayerId | undefined, roomId: string): JoinRoomResult {
    const room = this.store.getRoom(roomId);
    if (!room) return { kind: 'not_found' };
    if (room.player2Id !== null) return { kind: 'full' };

    const playerId = authPlayerId ?? (socketId as PlayerId);
    bindSocket(this.identity, socketId, playerId);
    this.socketRooms.set(socketId, roomId);
    joinRoom(room, playerId);
    this.store.saveRoom(room);

    const engine = this.replaceRoomEngine(room);
    serverLogger.info('room:joined', `${playerId} joined room: ${roomId}`, { roomId, playerId });

    setupRPS(room);
    engine.applyMutations([{ type: 'SET_STATUS', status: 'RPS' }]);
    engine.drainEventBatches();
    const rpsRoom = engine.roomState;
    this.store.saveRoom(rpsRoom);
    serverLogger.info('rps:started', `RPS phase started in room ${roomId}`, {
      roomId,
      p1Hand: rpsRoom.players[rpsRoom.player1Id].hand.map(card => card.blueprint.id),
      p2Hand: rpsRoom.players[playerId].hand.map(card => card.blueprint.id),
    });
    return { kind: 'joined', roomId, playerId, room: rpsRoom };
  }

  getOptions(socketId: string, roomId: string, cardUuid: string, zone: 'hand' | 'battlefield'): ActionOption[] {
    const room = this.store.getRoom(roomId);
    return room ? this.optionService.getOptions(room, resolvePlayerId(this.identity, socketId), cardUuid, zone) : [];
  }

  disconnect(socketId: string): void {
    const playerId = resolvePlayerId(this.identity, socketId);
    serverLogger.info('player:disconnected', `player disconnected: ${socketId}`, { playerId });
    const roomId = this.socketRooms.get(socketId);
    unbindSocket(this.identity, socketId);
    this.socketRooms.delete(socketId);
    if (!roomId) return;

    const room = this.store.getRoom(roomId);
    if (!room) return;
    const otherPlayerId = room.player1Id === playerId ? room.player2Id : room.player1Id;
    if (!otherPlayerId) this.destroyRoom(roomId);
    else this.scheduleDestroy(roomId);
  }

  dispose(): void {
    for (const roomId of [...this.destroyTimers.keys()]) this.cancelScheduledDestroy(roomId);
    for (const engine of this.engines.values()) engine.dispose();
    this.engines.clear();
    this.socketRooms.clear();
    this.identity.playerIdBySocket.clear();
    this.identity.socketIdByPlayer.clear();
  }

  private replaceRoomEngine(room: GameRoom): GameEngine {
    this.engines.get(room.roomId)?.dispose();
    const engine = new GameEngine(room);
    engine.initRoom();
    this.engines.set(room.roomId, engine);
    return engine;
  }

  private getOrCreateEngine(roomId: string): GameEngine {
    const engine = this.engines.get(roomId);
    if (engine) return engine;
    const room = this.store.getRoom(roomId);
    if (!room) throw new Error(`Room ${roomId} not found`);
    return this.replaceRoomEngine(room);
  }

  private destroyRoom(roomId: string): void {
    this.cancelScheduledDestroy(roomId);
    const room = this.store.getRoom(roomId);
    const engine = this.engines.get(roomId);
    if (engine) {
      engine.dispose();
      this.engines.delete(roomId);
    }
    this.store.deleteRoom(roomId);
    if (!room) return;

    const socketIds = [room.player1Id, room.player2Id]
      .filter((playerId): playerId is PlayerId => playerId !== null)
      .map(playerId => this.identity.socketIdByPlayer.get(playerId))
      .filter((socketId): socketId is string => socketId !== undefined);
    this.ports.roomDestroyed({ roomId, socketIds });
    unbindRoom(this.identity, room);
    for (const [socketId, knownRoomId] of this.socketRooms) {
      if (knownRoomId === roomId) this.socketRooms.delete(socketId);
    }
    serverLogger.info('room:destroyed', `room destroyed: ${roomId}`, { roomId });
  }

  private scheduleDestroy(roomId: string): void {
    this.cancelScheduledDestroy(roomId);
    const timer = setTimeout(() => {
      this.destroyTimers.delete(roomId);
      this.destroyRoom(roomId);
    }, this.gracePeriodMs);
    this.destroyTimers.set(roomId, timer);
    serverLogger.info('room:destroy:scheduled', `room ${roomId} scheduled for destruction in ${this.gracePeriodMs}ms`, { roomId });
  }

  private cancelScheduledDestroy(roomId: string): void {
    const timer = this.destroyTimers.get(roomId);
    if (!timer) return;
    clearTimeout(timer);
    this.destroyTimers.delete(roomId);
    serverLogger.info('room:destroy:cancelled', `room ${roomId} destruction cancelled`, { roomId });
  }
}
