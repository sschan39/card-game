import { gameConfig } from '@card-game/engine/config';
import { GameEngine } from '@card-game/engine/engine/game-engine';
import { OptionService, type ActionOption } from '@card-game/engine/engine/option-service';
import { buildStartingCardMutations, createRoom, joinRoom, resolveRPS, setupRPS } from '@card-game/engine/engine/room-factory';
import { ACTION_IDS } from '@card-game/engine/types/action.ids';
import type { AppliedEventBatch } from '@card-game/engine/types/game-event.types';
import type { GameMutation } from '@card-game/engine/types/game-mutation.types';
import type { GameRoom, PlayerId } from '@card-game/engine/types/game.room.types';
import { serverLogger } from '@card-game/engine/shared/game-logger';
import { choiceAnswerDetails } from '@card-game/engine/shared/choice-diagnostics';
import { resolveRuntimeContext, type RuntimeContext } from '@card-game/engine/shared/runtime-context';
import type { StateStore } from './state-store';
import type { ActionPacket } from './action-packet';
import {
  bindSocket,
  createIdentityMaps,
  decideRejoin,
  resolvePlayerId,
  resolveSocketId,
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

export type PlayerActionRuntimeResult =
  | { kind: 'error'; message: string; commandId: string; action: string }
  | { kind: 'success'; commandId: string; action: string; snapshot?: GameRoom };

export class RoomRuntime {
  private readonly engines = new Map<string, GameEngine>();
  private readonly socketRooms = new Map<string, string>();
  private readonly destroyTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly identity = createIdentityMaps();
  private readonly optionService = new OptionService();
  private readonly runtimeContext: RuntimeContext;

  constructor(
    private readonly store: StateStore,
    private readonly ports: RoomRuntimePorts,
    private readonly gracePeriodMs = 30_000,
    dependencies: Partial<RuntimeContext> = {},
  ) {
    this.runtimeContext = resolveRuntimeContext(dependencies);
  }

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

    this.bindPlayerSocket(socketId, authPlayerId);
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
    const roomId = this.runtimeContext.uuid();
    const playerId = authPlayerId ?? (socketId as PlayerId);
    this.bindPlayerSocket(socketId, playerId);
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
    this.bindPlayerSocket(socketId, playerId);
    this.socketRooms.set(socketId, roomId);
    joinRoom(room, playerId);
    this.store.saveRoom(room);

    const engine = this.replaceRoomEngine(room);
    serverLogger.info('room:joined', `${playerId} joined room: ${roomId}`, { roomId, playerId });

    setupRPS(room, this.runtimeContext);
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

  executePlayerAction(socketId: string, packet: ActionPacket): PlayerActionRuntimeResult {
    const commandId = packet.commandId ?? this.runtimeContext.uuid();
    const playerId = resolvePlayerId(this.identity, socketId);
    const trace = serverLogger.withContext({ roomId: packet.roomId, commandId, action: packet.actionId, playerId });
    if (gameConfig.logging.actions) trace.info('command:received', 'Player action received', {
      cardUuid: packet.data.cardUuid,
      choiceId: packet.data.choiceId,
      ...choiceAnswerDetails(packet.data),
    });
    const room = this.store.getRoom(packet.roomId);
    if (!room) {
      if (gameConfig.logging.actions) trace.warn('command:rejected', 'Room not found');
      return { kind: 'error', message: 'Room not found', commandId, action: packet.actionId };
    }

    const engine = this.getOrCreateEngine(packet.roomId);
    const oldState = engine.roomState;
    return engine.withCommandContext(packet.actionId, playerId, () => {
      const result = engine.executePlayerAction(playerId, packet.actionId, packet.data);
      if (!result.success) return {
        kind: 'error', message: result.reason, commandId, action: packet.actionId,
      } as const;

      const mutations = [...(result.mutations ?? [])];
      let rpsResolved = false;
      const chosen = engine.roomState;
      if (packet.actionId === ACTION_IDS.rpsPlay && chosen.status === 'RPS' && chosen.player2Id &&
          chosen.rpsState.playedCards[chosen.player1Id] && chosen.rpsState.playedCards[chosen.player2Id]) {
        mutations.push(...engine.applyMutations(resolveRPS(chosen)));
        mutations.push(...engine.applyMutations(buildStartingCardMutations(engine.roomState, this.runtimeContext)));
        mutations.push(...engine.advancePhase('complete'));
        rpsResolved = true;
        serverLogger.info('rps:resolved', `RPS resolved; first player ${engine.activeTurnPlayerId}`, {
          roomId: packet.roomId,
          winner: engine.activeTurnPlayerId,
        });
      }

      const currentRoom = engine.roomState;
      this.store.saveRoom(currentRoom);
      const batches = engine.drainEventBatches();
      if (mutations.length > 0) this.ports.publishDelta({
        oldState,
        room: currentRoom,
        mutations,
        action: packet.actionId,
        playerId,
        batches,
        recipients: this.recipients(currentRoom),
      });
      return {
        kind: 'success',
        commandId,
        action: packet.actionId,
        ...(rpsResolved ? { snapshot: currentRoom } : {}),
      } as const;
    }, commandId);
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
    const engine = new GameEngine(room, this.runtimeContext);
    engine.initRoom();
    this.engines.set(room.roomId, engine);
    return engine;
  }

  private bindPlayerSocket(socketId: string, playerId: PlayerId): void {
    const oldSocketId = this.identity.socketIdByPlayer.get(playerId);
    if (oldSocketId && oldSocketId !== socketId) this.socketRooms.delete(oldSocketId);
    bindSocket(this.identity, socketId, playerId);
  }

  private getOrCreateEngine(roomId: string): GameEngine {
    const engine = this.engines.get(roomId);
    if (engine) return engine;
    const room = this.store.getRoom(roomId);
    if (!room) throw new Error(`Room ${roomId} not found`);
    return this.replaceRoomEngine(room);
  }

  private recipients(room: GameRoom): Map<PlayerId, string> {
    return new Map(
      [room.player1Id, room.player2Id]
        .filter((playerId): playerId is PlayerId => playerId !== null)
        .map(playerId => [playerId, resolveSocketId(this.identity, playerId)]),
    );
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
