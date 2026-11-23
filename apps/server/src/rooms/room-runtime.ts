import { randomBytes } from 'node:crypto';
import { AutoPassCoordinator } from './auto-pass';
import { inspectPlayerAction, type PlayerActionInspection } from '@card-game/engine/engine/player-action-query';
import { hasLegalNonPassAction } from '@card-game/engine/engine/legal-actions';
import { declarationPlayer } from '@card-game/engine/shared/turn-utils';
import type { AutoPassStatus, LobbyRpsView, RpsPick } from '@card-game/protocol';
import { gameConfig } from '@card-game/engine/config';
import { GameEngine } from '@card-game/engine/engine/game-engine';
import { OptionService, type ActionOption } from '@card-game/engine/engine/option-service';
import { createRoom, joinRoom } from '@card-game/engine/engine/room-factory';
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
import { MatchInputs, openStoredMatch, recordMatchCommand, recoverMatch, type MatchRepository, type StoredMatch } from './match-recovery';
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
  viewSeq?: number;
  recipients: ReadonlyMap<PlayerId, string>;
}

export interface RoomDestroyedNotice {
  roomId: string;
  socketIds: string[];
}

export interface RoomRuntimePorts {
  autoPassChanged?(socketId: string, status: AutoPassStatus): void;
  matchPaused?(roomId: string): boolean;
  authorizeAutoPass?(socketId: string, roomId: string): boolean | Promise<boolean>;
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
  | { kind: 'success'; commandId: string; action: string; duplicate?: true };

type RpsResult = { kind: 'error'; message: string } | { kind: 'pending'; room: GameRoom }
  | { kind: 'started'; room: GameRoom; firstPlayerId: PlayerId; picks: readonly [RpsPick, RpsPick] };

const beats: Record<RpsPick, RpsPick> = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

export class RoomRuntime {
  private readonly lobbyPicks = new Map<string, Map<PlayerId, RpsPick>>();
  private readonly autoPass: AutoPassCoordinator;
  private readonly labContexts = new Map<string, RuntimeContext>();
  private readonly pausedTestRooms = new Set<string>();
  private readonly operatorTestRooms = new Set<string>();
  private readonly engines = new Map<string, GameEngine>();
  private readonly matchHeads = new Map<string, StoredMatch>();
  private readonly matchInputs = new Map<string, MatchInputs>();
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
    autoPassDelayMs = 0,
    private readonly recovery?: MatchRepository,
  ) {
    this.runtimeContext = resolveRuntimeContext({
      ...dependencies,
      random: dependencies.random ?? (() => randomBytes(6).readUIntBE(0, 6) / 2 ** 48),
    });
    this.autoPass = new AutoPassCoordinator({
      position: roomId => {
        if (this.pausedTestRooms.has(roomId) || this.ports.matchPaused?.(roomId)) return;
        const engine = this.engines.get(roomId), room = engine?.roomState;
        if (!room || !room.player2Id || !room.priorityPlayerId) return;
        const connected = [room.player1Id, room.player2Id].every(playerId => {
          const socketId = this.identity.socketIdByPlayer.get(playerId);
          return !!socketId && this.socketRooms.get(socketId) === roomId;
        });
        const socketId = this.identity.socketIdByPlayer.get(room.priorityPlayerId);
        return connected && socketId ? { room, socketId } : undefined;
      },
      eligible: ({ room }, passForTurn) => {
        const engine = this.engines.get(room.roomId);
        if (!engine || engine.hasPendingRulesWork || room.status !== 'playing' || room.outcome ||
            room.engineState !== 'waiting_for_player' || room.pendingChoice || room.triggerQueue ||
            room.pendingTriggers?.length || declarationPlayer(room)) return false;
        if (passForTurn) return true;
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
      authorize: this.ports.authorizeAutoPass,
      changed: (socketId, status) => this.ports.autoPassChanged?.(socketId, status),
    }, autoPassDelayMs);
  }

  /** Load independently verified rooms before the application accepts connections. */
  restoreMatches(restoreSeq: (roomId: string, seq: number) => void): void {
    if (!this.recovery) return;
    for (const match of this.recovery.matches()) {
      try {
        const recovered = recoverMatch(match, this.recovery.matchCommands(match.roomId, match.checkpointOrdinal));
        this.replaceRoomEngine(recovered.room, recovered.lastBatchId);
        this.store.saveRoom(recovered.room);
        this.matchHeads.set(match.roomId, match);
        restoreSeq(match.roomId, match.viewSeq);
        serverLogger.info('match:recovered', 'Restored active match', { roomId: match.roomId, viewSeq: match.viewSeq });
      } catch (error) {
        serverLogger.error('match:recovery-failed', 'Active match could not be recovered', {
          roomId: match.roomId, reason: error instanceof Error ? error.message : 'Unknown recovery failure',
        });
      }
    }
  }

  installTestRoom(room:GameRoom, random:()=>number, singleOperator = false):void {
    if(this.store.getRoom(room.roomId))throw new Error('Room already exists');
    this.labContexts.set(room.roomId,{...this.runtimeContext,random});
    this.store.saveRoom(room);
    try { this.replaceRoomEngine(room); } catch(error) { this.labContexts.delete(room.roomId);this.store.deleteRoom(room.roomId);throw error; }
    if (singleOperator) this.operatorTestRooms.add(room.roomId);
  }
  removeTestRoom(roomId:string):void { if(!this.labContexts.has(roomId))throw new Error('Not a test room');this.destroyRoom(roomId); }
  testRoom(roomId:string){return this.labContexts.has(roomId)?this.store.getRoom(roomId):undefined;}
  isTestRoom(roomId:string):boolean {return this.labContexts.has(roomId);}

  pauseTestRoom(roomId: string, paused: boolean): void {
    if (!this.isTestRoom(roomId)) throw new Error('Not a test room');
    if (paused) this.pausedTestRooms.add(roomId);
    else this.pausedTestRooms.delete(roomId);
    this.autoPass.refresh(roomId);
  }

  refreshAutoPass(roomId: string): void { this.autoPass.refresh(roomId); }

  testCheckpoint(roomId: string) {
    if (!this.isTestRoom(roomId)) throw new Error('Not a test room');
    const engine = this.getOrCreateEngine(roomId);
    return { room: engine.roomState, lastBatchId: engine.lastBatchId };
  }

  restoreTestCheckpoint(room: GameRoom, lastBatchId?: string): void {
    if (!this.isTestRoom(room.roomId)) throw new Error('Not a test room');
    this.replaceRoomEngine(room, lastBatchId);
    this.store.saveRoom(room);
    this.autoPass.refresh(room.roomId);
  }
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

    this.replaceRoomEngine(room);
    this.lobbyPicks.set(roomId, new Map());
    serverLogger.info('room:joined', 'Second player seated; opening picks enabled', { roomId, playerId });
    return { kind: 'joined', roomId, playerId, room };
  }

  lobbyView(roomId: string, viewerId: PlayerId): LobbyRpsView | undefined {
    const room = this.store.getRoom(roomId), picks = this.lobbyPicks.get(roomId);
    if (!picks || room?.status !== 'waiting' || !room.player2Id ||
        (viewerId !== room.player1Id && viewerId !== room.player2Id)) return;
    const opponent = viewerId === room.player1Id ? room.player2Id : room.player1Id;
    return { myPick: picks.get(viewerId) ?? null, opponentReady: picks.has(opponent) };
  }

  submitRps(socketId: string, roomId: string, pick: RpsPick): RpsResult {
    const playerId = resolvePlayerId(this.identity, socketId);
    const room = this.store.getRoom(roomId), picks = this.lobbyPicks.get(roomId);
    if (this.socketRooms.get(socketId) !== roomId || !room?.player2Id || !picks || !this.lobbyView(roomId, playerId)) {
      return { kind: 'error', message: 'No opening round for this seat' };
    }
    if (picks.has(playerId)) return { kind: 'error', message: 'Opening pick already locked' };
    const first = playerId === room.player1Id ? pick : picks.get(room.player1Id);
    const second = playerId === room.player2Id ? pick : picks.get(room.player2Id);
    if (!first || !second) {
      picks.set(playerId, pick);
      return { kind: 'pending', room };
    }
    const firstPlayerId = first === second || beats[first] === second ? room.player1Id : room.player2Id;
    const engine = this.getOrCreateEngine(roomId);
    try {
      engine.startMatch(firstPlayerId);
      if (this.recovery) {
        const head = openStoredMatch(engine);
        this.recovery.createMatch(head);
        this.matchHeads.set(roomId, head);
      }
    } catch (error) {
      if (!this.recovery) throw error;
      this.replaceRoomEngine(room);
      serverLogger.error('match:checkpoint-failed', 'Could not save the opening match checkpoint', { roomId });
      return { kind: 'error', message: 'Could not save the match. Retry your opening pick.' };
    }
    this.lobbyPicks.delete(roomId);
    const started = engine.roomState;
    this.store.saveRoom(started);
    engine.drainEventBatches();
    serverLogger.info('match:started', 'Opening round resolved', { roomId, firstPlayerId, picks: [first, second] });
    this.autoPass.refresh(roomId);
    return { kind: 'started', room: started, firstPlayerId, picks: [first, second] };
  }

  getOptions(socketId: string, roomId: string, cardUuid: string, zone: 'hand' | 'battlefield'): ActionOption[] {
    const room = this.store.getRoom(roomId);
    return room && this.socketRooms.get(socketId) === roomId ? this.optionService.getOptions(room, resolvePlayerId(this.identity, socketId), cardUuid, zone) : [];
  }

  inspectPlayerAction(socketId: string, packet: ActionPacket): PlayerActionInspection {
    const room = this.store.getRoom(packet.roomId);
    if (!room || this.socketRooms.get(socketId) !== packet.roomId)
      return { kind: 'unavailable', reason: 'This socket is not seated in that room' };
    const playerId = resolvePlayerId(this.identity, socketId);
    const engine = this.engines.get(packet.roomId);
    return engine ? engine.inspectPlayerAction(playerId, packet.actionId, packet.data)
      : inspectPlayerAction(room, playerId, packet.actionId, packet.data);
  }

  executePlayerAction(
    socketId: string, packet: ActionPacket, decode?: (room: GameRoom, playerId: PlayerId) => ActionPacket['data'],
  ): PlayerActionRuntimeResult {
    const commandId = packet.commandId ?? this.runtimeContext.uuid();
    const playerId = resolvePlayerId(this.identity, socketId);
    const trace = serverLogger.withContext({ roomId: packet.roomId, commandId, action: packet.actionId, playerId });
    const room = this.store.getRoom(packet.roomId);
    const seated = this.socketRooms.get(socketId) === packet.roomId;
    const head = room && seated ? this.matchHeads.get(packet.roomId) : undefined;
    const accepted = head && this.recovery?.acceptedAction(packet.roomId, playerId, commandId);
    let invalidOption = false;
    try {
      if (room && seated && !accepted && decode) packet = { ...packet, data: decode(room, playerId) };
    } catch {
      invalidOption = true;
    }

    if (gameConfig.logging.actions) trace.info('command:received', 'Player action received', {
      cardUuid: packet.data.cardUuid,
      choiceId: packet.data.choiceId,
      ...choiceAnswerDetails(packet.data),
    });
    if (!room) {
      if (gameConfig.logging.actions) trace.warn('command:rejected', 'Room not found');
      return { kind: 'error', message: 'Room not found', commandId, action: packet.actionId };
    }

    if (!seated) return {
      kind: 'error', message: 'This socket is not seated in that room', commandId, action: packet.actionId,
    };

    if (this.pausedTestRooms.has(packet.roomId)) return {
      kind: 'error', message: 'Resume play before taking a game action.', commandId, action: packet.actionId,
    };

    if (accepted) return accepted === packet.actionId
      ? { kind: 'success', commandId, action: accepted, duplicate: true }
      : { kind: 'error', commandId, action: packet.actionId, message: 'Command ID already used' };

    if (invalidOption) return { kind: 'error', commandId, action: packet.actionId, message: 'Invalid action option' };

    const engine = this.getOrCreateEngine(packet.roomId);
    const oldState = engine.roomState;
    const lastBatchId = engine.lastBatchId;
    const execute = () => engine.withCommandContext(packet.actionId, playerId,
      () => engine.executePlayerAction(playerId, packet.actionId, packet.data), commandId);
    let committedHead: StoredMatch | undefined;
    let mutations: GameMutation[];
    let batches: AppliedEventBatch[];
    const reject = (message: string): PlayerActionRuntimeResult => ({ kind: 'error', message, commandId, action: packet.actionId });
    try {
      const { result, inputs } = head ? this.matchInputs.get(packet.roomId)!.record(execute) : { result: execute(), inputs: [] };
      if (!result.success) {
        if (head && engine.roomState !== oldState) this.replaceRoomEngine(oldState, lastBatchId);
        return reject(result.reason);
      }
      mutations = result.mutations ?? [];
      batches = engine.drainEventBatches();
      if (head && this.recovery) {
        const record = recordMatchCommand(head, engine, packet, playerId, commandId, inputs, batches, mutations.length > 0);
        this.recovery.appendMatchCommand(packet.roomId, record.command, record.head);
        committedHead = record.head;
        this.matchHeads.set(packet.roomId, committedHead);
      }
    } catch (error) {
      if (!head) throw error;
      this.replaceRoomEngine(oldState, lastBatchId);
      trace.error('match:commit-failed', 'Action could not be saved');
      return reject('Could not save the action. Retry the command.');
    }

    const currentRoom = engine.roomState;
    this.store.saveRoom(currentRoom);
    if (mutations.length > 0) this.ports.publishDelta({
      oldState, room: currentRoom, mutations, action: packet.actionId, playerId, batches,
      recipients: this.recipientsFor(currentRoom), viewSeq: committedHead?.viewSeq,
    });
    this.autoPass.refresh(packet.roomId);
    return { kind: 'success', commandId, action: packet.actionId };
  }

  /** Only the socket currently bound to this room can opt in or cancel its own auto-pass. */
  setAutoPass(socketId: string, roomId: string, enabled: boolean, untilTurn?: number): boolean {
    if (this.socketRooms.get(socketId) !== roomId) return false;
    if (untilTurn !== undefined) {
      const room = this.engines.get(roomId)?.roomState;
      if (!room || room.status !== 'playing' || room.outcome ||
          untilTurn !== (room.turnNumber ?? 0)) return false;
    }
    this.autoPass.setEnabled(socketId, roomId, enabled, untilTurn); return true;
  }

  /** The transport uses this to prevent silently replacing an occupied room binding. */
  currentRoom(socketId: string): string | undefined { return this.socketRooms.get(socketId); }

  /** Explicit departure forfeits an active match; disconnection remains reconnectable. */
  leaveRoom(socketId: string, roomId: string): { playerId: string } | undefined {
    if (this.socketRooms.get(socketId) !== roomId) return;
    const playerId = resolvePlayerId(this.identity, socketId);
    let room = this.store.getRoom(roomId);
    if (!room) return;
    if (room.status === 'waiting') {
      this.destroyRoom(roomId);
      return { playerId };
    }
    if (room.player2Id && room.status === 'playing') {
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
    else if (!this.operatorTestRooms.has(roomId)) this.scheduleDestroy(roomId);
    this.autoPass.refresh(roomId);
  }

  dispose(): void {
    this.autoPass.dispose();
    for (const roomId of [...this.destroyTimers.keys()]) this.cancelScheduledDestroy(roomId);
    for (const engine of this.engines.values()) engine.dispose();
    this.engines.clear();
    this.matchInputs.clear();
    this.matchHeads.clear();
    this.labContexts.clear();
    this.pausedTestRooms.clear();
    this.operatorTestRooms.clear();
    this.lobbyPicks.clear();
    this.departed.clear();
    this.socketRooms.clear();
    this.identity.playerIdBySocket.clear();
    this.identity.socketIdByPlayer.clear();
  }

  private replaceRoomEngine(room: GameRoom, lastBatchId?: string): GameEngine {
    const context = this.labContexts.get(room.roomId);
    const inputs = !context && this.recovery ? new MatchInputs(this.runtimeContext) : undefined;
    if (inputs) this.matchInputs.set(room.roomId, inputs);
    const engine = new GameEngine(room, context ?? inputs ?? this.runtimeContext, undefined, lastBatchId);
    engine.initRoom();
    this.engines.get(room.roomId)?.dispose();
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
    if (this.matchHeads.has(roomId)) this.recovery?.deleteMatch(roomId);
    this.matchHeads.delete(roomId);
    this.matchInputs.delete(roomId);
    this.engines.get(roomId)?.dispose();
    this.engines.delete(roomId);
    this.labContexts.delete(roomId);
    this.pausedTestRooms.delete(roomId);
    this.operatorTestRooms.delete(roomId);
    this.lobbyPicks.delete(roomId);
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
