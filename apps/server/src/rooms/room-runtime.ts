import { randomBytes } from 'node:crypto';
import { AutoPassCoordinator } from './auto-pass';
import { hasLegalNonPassAction } from '@card-game/engine/engine/legal-actions';
import type { AutoPassStatus } from '@card-game/protocol';
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
import type { RoomSettings } from '@card-game/engine/types/setup-config.types';
import type { ActionPacket } from './action-packet';
import {
  bindSocket,
  createIdentityMaps,
  decideRejoin,
  resolvePlayerId,
  resolveSocketId,
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
  autoPassChanged?(socketId: string, status: AutoPassStatus): void;
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
  | { kind: 'already_member' }
  | { kind: 'joined'; roomId: string; playerId: PlayerId; room: GameRoom };

export type PlayerActionRuntimeResult =
  | { kind: 'error'; message: string; commandId: string; action: string }
  | { kind: 'success'; commandId: string; action: string; snapshot?: GameRoom };

export class RoomRuntime {
  private readonly autoPass: AutoPassCoordinator;
  private readonly labContexts = new Map<string, RuntimeContext>();
  private readonly engines = new Map<string, GameEngine>();
  private readonly socketRooms = new Map<string, string>();
  private readonly departed = new Map<string, Set<string>>();
  private readonly destroyTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly identity = createIdentityMaps();
  private readonly optionService = new OptionService();
  private readonly runtimeContext: RuntimeContext;

  constructor(
    private readonly store: StateStore,
    private readonly ports: RoomRuntimePorts,
    private readonly gracePeriodMs = 30_000,
    dependencies: Partial<RuntimeContext> = {},
    private readonly roomSettings?: () => RoomSettings,
    autoPassDelayMs = 5000,
  ) {
    this.runtimeContext = resolveRuntimeContext({
      ...dependencies,
      random: dependencies.random ?? (() => randomBytes(6).readUIntBE(0, 6) / 2 ** 48),
    });
    this.autoPass = new AutoPassCoordinator({
      position: roomId => {
        const engine = this.engines.get(roomId), room = engine?.roomState;
        if (!room || !room.player2Id || !room.priorityPlayerId) return;
        const connected = [room.player1Id, room.player2Id].every(playerId => {
          const socketId = this.identity.socketIdByPlayer.get(playerId);
          return !!socketId && this.socketRooms.get(socketId) === roomId;
        });
        const socketId = this.identity.socketIdByPlayer.get(room.priorityPlayerId);
        return connected && socketId ? { room, socketId } : undefined;
      },
      eligible: ({ room }) => {
        const engine = this.engines.get(room.roomId);
        if (!engine || engine.hasPendingRulesWork) return false;
        try { return hasLegalNonPassAction(room, room.priorityPlayerId!).kind === 'none'; }
        catch {
          serverLogger.error('auto-pass:query-failed', 'Auto-pass paused after a legality query failed', { roomId: room.roomId });
          return false;
        }
      },
      pass: (socketId, roomId) => {
        try {
          const result = this.executePlayerAction(socketId, { roomId, actionId: ACTION_IDS.passPriority, data: {} });
          if (result.kind === 'success') return;
        } catch {
          // A background pass failure must not escape the timer callback or keep retrying.
        }
        serverLogger.error('auto-pass:command-failed', 'Auto-pass disabled after a pass failed', { roomId });
        this.autoPass.setEnabled(socketId, roomId, false);
      },
      changed: (socketId, status) => this.ports.autoPassChanged?.(socketId, status),
    }, autoPassDelayMs);
  }

  installTestRoom(room:GameRoom, random:()=>number):void {
    if(this.store.getRoom(room.roomId))throw new Error('Room already exists');
    this.labContexts.set(room.roomId,{...this.runtimeContext,random});
    this.store.saveRoom(room);
    try { this.replaceRoomEngine(room); } catch(error) { this.labContexts.delete(room.roomId);this.store.deleteRoom(room.roomId);throw error; }
  }
  removeTestRoom(roomId:string):void { if(!this.labContexts.has(roomId))throw new Error('Not a test room');this.destroyRoom(roomId); }
  testRoom(roomId:string){return this.labContexts.has(roomId)?this.store.getRoom(roomId):undefined;}
  isTestRoom(roomId:string):boolean {return this.labContexts.has(roomId);}
  connect(socketId: string, authPlayerId?: PlayerId, authRoomId?: string | null): ConnectResult {
    if (!authPlayerId || !authRoomId) return { kind: 'no_rejoin' };
    if (this.departed.get(authRoomId)?.has(authPlayerId)) return { kind: 'rejoin_failed', reason: 'not_a_member' };

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
    this.autoPass.refresh(authRoomId);
    return { kind: 'rejoined', roomId: authRoomId, playerId: authPlayerId, room: decision.room };
  }

  createRoom(socketId: string, authPlayerId?: PlayerId, cards?: readonly string[]): { roomId: string; playerId: PlayerId; room: GameRoom } {
    const roomId = this.runtimeContext.uuid();
    const playerId = authPlayerId ?? (socketId as PlayerId);
    this.bindPlayerSocket(socketId, playerId);
    this.socketRooms.set(socketId, roomId);

    const room = createRoom(roomId, playerId, cards, this.roomSettings?.());
    this.store.saveRoom(room);
    this.replaceRoomEngine(room);
    serverLogger.info('room:created', `room created: ${roomId}`, { roomId, playerId });
    return { roomId, playerId, room };
  }

  joinRoom(socketId: string, authPlayerId: PlayerId | undefined, roomId: string, cards?: readonly string[]): JoinRoomResult {
    const room = this.store.getRoom(roomId);
    if (!room) return { kind: 'not_found' };
    if (room.player2Id !== null) return { kind: 'full' };

    const playerId = authPlayerId ?? (socketId as PlayerId);
    if (room.player1Id === playerId) return { kind: 'already_member' };
    this.bindPlayerSocket(socketId, playerId);
    this.socketRooms.set(socketId, roomId);
    joinRoom(room, playerId, cards);
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
    this.autoPass.refresh(roomId);
    return { kind: 'joined', roomId, playerId, room: rpsRoom };
  }

  getOptions(socketId: string, roomId: string, cardUuid: string, zone: 'hand' | 'battlefield'): ActionOption[] {
    const room = this.store.getRoom(roomId);
    return room && this.socketRooms.get(socketId) === roomId ? this.optionService.getOptions(room, resolvePlayerId(this.identity, socketId), cardUuid, zone) : [];
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

    if (this.socketRooms.get(socketId) !== packet.roomId) return {
      kind: 'error', message: 'This socket is not seated in that room', commandId, action: packet.actionId,
    };

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
        recipients: this.recipientsFor(currentRoom),
      });
      this.autoPass.refresh(packet.roomId);
      return {
        kind: 'success',
        commandId,
        action: packet.actionId,
        ...(rpsResolved ? { snapshot: currentRoom } : {}),
      } as const;
    }, commandId);
  }

  /** Only the socket currently bound to this room can opt in or cancel its own auto-pass. */
  setAutoPass(socketId: string, roomId: string, enabled: boolean): boolean {
    if (this.socketRooms.get(socketId) !== roomId) return false;
    this.autoPass.setEnabled(socketId, roomId, enabled); return true;
  }

  /** The transport uses this to prevent silently replacing an occupied room binding. */
  currentRoom(socketId: string): string | undefined { return this.socketRooms.get(socketId); }

  /** Explicit departure forfeits an active match; disconnection remains reconnectable. */
  leaveRoom(socketId: string, roomId: string): { playerId: string } | undefined {
    if (this.socketRooms.get(socketId) !== roomId) return;
    const playerId = resolvePlayerId(this.identity, socketId);
    let room = this.store.getRoom(roomId);
    if (!room) return;
    if (room.player2Id && (room.status === 'playing' || room.status === 'RPS')) {
      const result = this.executePlayerAction(socketId, { roomId, actionId: ACTION_IDS.concede, data: {} });
      if (result.kind !== 'success') return;
      room = this.store.getRoom(roomId)!;
    }
    const departed = this.departed.get(roomId) ?? new Set<string>();
    this.autoPass.forgetSocket(socketId);
    departed.add(playerId);
    this.departed.set(roomId, departed);
    unbindSocket(this.identity, socketId);
    this.socketRooms.delete(socketId);
    this.cancelScheduledDestroy(roomId);
    const remaining = [room.player1Id, room.player2Id].filter((id): id is string => !!id && !departed.has(id));
    if (!remaining.length) this.destroyRoom(roomId);
    else if (![...this.socketRooms.values()].includes(roomId)) this.scheduleDestroy(roomId);
    this.autoPass.refresh(roomId);
    return { playerId };
  }

  disconnect(socketId: string, preserveSeat = false): void {
    this.autoPass.forgetSocket(socketId);
    const playerId = resolvePlayerId(this.identity, socketId);
    serverLogger.info('player:disconnected', `player disconnected: ${socketId}`, { playerId });
    const roomId = this.socketRooms.get(socketId);
    unbindSocket(this.identity, socketId);
    this.socketRooms.delete(socketId);
    if (!roomId) return;

    const room = this.store.getRoom(roomId);
    if (!room) return;
    const otherPlayerId = room.player1Id === playerId ? room.player2Id : room.player1Id;
    if (!otherPlayerId && !preserveSeat) this.destroyRoom(roomId);
    else this.scheduleDestroy(roomId);
    this.autoPass.refresh(roomId);
  }

  dispose(): void {
    this.autoPass.dispose();
    for (const roomId of [...this.destroyTimers.keys()]) this.cancelScheduledDestroy(roomId);
    for (const engine of this.engines.values()) engine.dispose();
    this.engines.clear();
    this.labContexts.clear();
    this.departed.clear();
    this.socketRooms.clear();
    this.identity.playerIdBySocket.clear();
    this.identity.socketIdByPlayer.clear();
  }

  private replaceRoomEngine(room: GameRoom): GameEngine {
    this.engines.get(room.roomId)?.dispose();
    const engine = new GameEngine(room, this.labContexts.get(room.roomId) ?? this.runtimeContext);
    engine.initRoom();
    this.engines.set(room.roomId, engine);
    return engine;
  }

  private bindPlayerSocket(socketId: string, playerId: PlayerId): void {
    const oldSocketId = this.identity.socketIdByPlayer.get(playerId);
    if (oldSocketId && oldSocketId !== socketId) {
      const oldRoomId = this.socketRooms.get(oldSocketId);
      this.autoPass.forgetSocket(oldSocketId);
      this.socketRooms.delete(oldSocketId);
      this.autoPass.refresh(oldRoomId!);
    }
    bindSocket(this.identity, socketId, playerId);
  }

  private getOrCreateEngine(roomId: string): GameEngine {
    const engine = this.engines.get(roomId);
    if (engine) return engine;
    const room = this.store.getRoom(roomId);
    if (!room) throw new Error(`Room ${roomId} not found`);
    return this.replaceRoomEngine(room);
  }

  recipientsFor(room: GameRoom): Map<PlayerId, string> {
    return new Map(
      [room.player1Id, room.player2Id]
        .filter((playerId): playerId is PlayerId => playerId !== null)
        .map(playerId => [playerId, resolveSocketId(this.identity, playerId)]),
    );
  }

  private destroyRoom(roomId: string): void {
    this.autoPass.cancel(roomId);
    this.cancelScheduledDestroy(roomId);
    const room = this.store.getRoom(roomId);
    const engine = this.engines.get(roomId)!;
    engine.dispose();
    this.engines.delete(roomId);
    this.labContexts.delete(roomId);
    this.store.deleteRoom(roomId);
    if (!room) return;

    const socketIds = [...this.socketRooms].filter(([, id]) => id === roomId).map(([socketId]) => socketId);
    this.departed.delete(roomId);
    this.ports.roomDestroyed({ roomId, socketIds });
    for (const socketId of socketIds) { this.autoPass.forgetSocket(socketId); unbindSocket(this.identity, socketId); }
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
