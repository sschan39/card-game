// src/engine/game-engine.ts
import { v4 as uuidv4 } from 'uuid';
import { EventBus } from './event-bus';
import { StateMachine } from './state-machine';
import { ActionService } from './action-service';
import { ActionRegistry, type ActionData, type ActionResult } from './action-registry';
import { gameReducer } from './game-reducer';
import { runRulesCheckpoint } from './rules-checkpoint';
import type { GameMutation } from '../types/game-mutation.types';
import type { GameRoom, PlayerId } from '../types/game.room.types';
import { TURN_SEQUENCE, type Phase } from '../types/game.state.types';
import { gameConfig } from '../config';
import { playerCommands, validateActionData } from './player-commands';
import { deriveAppliedEvents, sameStateValue, type AppliedMutation } from './applied-events';
import type { AppliedEventBatch, BatchCause, CommandContext, ResolutionReport } from '../types/game-event.types';
import { engineLogger } from '../shared/game-logger';

/**
 * GameEngine — single public API for all engine operations.
 *
 * Owns and coordinates EventBus, StateMachine, and ActionService internally.
 * server.ts talks only to GameEngine — no more juggling 3 separate engine objects.
 *
 * Mutation pipeline:
 * 1. Handlers produce GameMutation[] (pure, no side effects)
 * 2. applyMutations() sequences each through gameReducer
 * 3. The checkpoint settles SBAs before placing discovered triggers on the stack
 */
export class GameEngine {
  private eventBus: EventBus;
  private stateMachine: StateMachine;
  private actionService: ActionService;
  private room: GameRoom;
  private eventBatches: AppliedEventBatch[] = [];
  private commandContext?: CommandContext;
  private processingRules = false;
  private lastBatchId?: string;

  /** Per-room mutation collector for TriggerManager to push into during event dispatch. */
  mutationCollector: GameMutation[] = [];

  constructor(room: GameRoom) {
    this.room = room;
    this.eventBus = new EventBus(room.roomId);
    this.stateMachine = new StateMachine(room);
    this.actionService = new ActionService(this.eventBus, this.mutationCollector, () => this.generateUuid());
  }

  /** Wire one TriggerManager. Repeated initialization is safe; disposal is final. */
  initRoom(): void {
    this.actionService.initRoom(() => this.room);
  }

  /**
   * Tear down the engine's per-room systems (TriggerManager listeners).
   * Call when the room is destroyed to prevent listener leaks.
   */
  dispose(): void {
    this.actionService.destroyRoom();
    this.eventBatches.length = 0;
  }

  /**
   * Generate a UUID for StackObject creation.
   * All non-determinism is injected at the engine boundary.
   */
  generateUuid(): string {
    return uuidv4();
  }

  /**
   * Apply an array of mutations through the pure reducer, then drain the
   * mutation collector (trigger-produced mutations) in a loop until empty.
   * Returns all mutations applied (for delta emission).
   */
  applyMutations(mutations: GameMutation[], resolution?: ResolutionReport): GameMutation[] {
    if (this.isGameOver) {
      this.mutationCollector.length = 0;
      return [];
    }
    // Rule listeners enqueue work; they cannot recursively open another checkpoint.
    if (this.processingRules) {
      this.mutationCollector.push(...mutations);
      return [];
    }
    this.processingRules = true;
    try {
      const applied = this.commitMutations(mutations, { kind: this.commandContext ? 'command' : 'engine' }, resolution);
      applied.push(...runRulesCheckpoint({
        getRoom: () => this.room,
        takePending: () => this.mutationCollector.splice(0),
        apply: (pending, kind) => {
          const eventUuids = pending.flatMap(mutation => mutation.type === 'PUSH_STACK' && mutation.stackObject.type === 'triggered'
            && mutation.stackObject.triggeringEvent?.eventUuid ? [mutation.stackObject.triggeringEvent.eventUuid] : []);
          return this.commitMutations(pending, {
            kind: kind === 'state-based-action' ? kind : eventUuids.length ? 'trigger' : 'engine',
            parentBatchId: this.lastBatchId, eventUuids: [...new Set(eventUuids)],
          });
        },
      }));
      return applied;
    } finally {
      this.processingRules = false;
    }
  }

  /** Apply and publish one complete batch. Settlement belongs to the checkpoint. */
  private commitMutations(mutations: GameMutation[], cause: BatchCause, resolution?: ResolutionReport): GameMutation[] {
    const before = this.room;
    const steps: AppliedMutation[] = [];
    for (const mutation of mutations) {
      if (this.isGameOver) break;
      const previous = this.room;
      const next = gameReducer(previous, mutation);
      if (sameStateValue(previous, next)) continue;
      this.room = next;
      steps.push({ mutation, before: previous, after: next });
      if (mutation.type === 'MOVE_CARD' && next.continuousEffectPool.some(entry => entry.source === mutation.cardUuid)) {
        this.mutationCollector.push({ type: 'REMOVE_CONTINUOUS_EFFECT', source: mutation.cardUuid });
      }
    }
    if (!steps.length) return [];
    const batchId = uuidv4();
    const events = deriveAppliedEvents(before, this.room, steps, resolution).map((event, index) => ({
      ...structuredClone(event), batchId, eventUuid: batchId + ':' + index, commandId: this.commandContext?.commandId,
    }));
    const batch: AppliedEventBatch = { batchId, command: this.commandContext, cause, before, after: this.room,
      mutations: steps.map(step => step.mutation), events };
    this.eventBatches.push(batch);
    this.lastBatchId = batchId;
    for (const event of events) this.eventBus.emit(event, { before, after: batch.after, command: batch.command });
    if (this.isGameOver) this.mutationCollector.length = 0;
    return batch.mutations;
  }

  get hasPendingRulesWork(): boolean {
    return this.processingRules || this.mutationCollector.length > 0;
  }

  /** Consume committed batches after an operation; runtime room refs are not serialized. */
  drainEventBatches(): AppliedEventBatch[] {
    return this.eventBatches.splice(0);
  }

  // -- Action pipeline --

  /** The player-command boundary. Lower-level methods remain rules/test primitives. */
  executePlayerAction(playerId: PlayerId, actionId: string, data: unknown = {}): ActionResult {
    return this.withCommandContext(actionId, playerId, () => {
      const result = this.executeCommand(playerId, actionId, data);
      const logger = engineLogger.withContext({ roomId: this.room.roomId, ...this.commandContext });
      if (!result.success) logger.warn('command:rejected', result.reason, { phase: result.phase });
      else if (gameConfig.logging.appliedEvents) logger.debug('command:accepted');
      return result;
    });
  }

  /** Include host-side command continuations (currently RPS setup) in the same timeline. */
  withCommandContext<T>(action: string, playerId: PlayerId, operation: () => T): T {
    const previous = this.commandContext;
    this.commandContext = previous ?? { commandId: uuidv4(), action, playerId };
    try { return operation(); }
    finally { this.commandContext = previous; }
  }

  private executeCommand(playerId: PlayerId, actionId: string, data: unknown): ActionResult {
    const reject = (reason: string): ActionResult => ({ success: false, phase: 'validate', reason });
    if (this.isGameOver) return reject('Game is over');
    if (this.hasPendingRulesWork) return reject('Rules checkpoint is pending');
    if ((playerId !== this.room.player1Id && playerId !== this.room.player2Id) ||
        !Object.prototype.hasOwnProperty.call(this.room.players, playerId) || !this.room.players[playerId]) return reject('Player is not in this room');
    if (typeof actionId !== 'string' || !actionId.trim()) return reject('actionId must be a nonempty string');
    const shapeError = validateActionData(data);
    if (shapeError) return reject(shapeError);
    // Stack identity belongs to the engine. Keep fixture injection on the
    // lower-level methods, while retaining all other addon payload fields.
    const { stackUuid: _stackUuid, ...actionData } = data as ActionData;
    const command = Object.prototype.hasOwnProperty.call(playerCommands, actionId) ? playerCommands[actionId] : undefined;
    if (!command && !Object.prototype.hasOwnProperty.call(ActionRegistry, actionId)) {
      return reject(`No handler registered for action: ${actionId}`);
    }
    const status = command?.status ?? 'playing';
    if (this.room.status !== status) return reject(`Action requires ${status} status`);
    if (this.room.engineState !== 'waiting_for_player') return reject('Engine is not ready for player input');
    const mode = this.room.debugMode ?? gameConfig.debugMode;
    if (command?.debug && mode !== 'flow' && mode !== command.debug) return reject('Debug command is disabled in this mode');
    const commandError = command?.validate(actionData);
    if (commandError) return reject(commandError);
    return command ? command.execute(this, playerId, actionData) : this.proposeAndStack(playerId, actionId, actionData);
  }

  handleAction(playerId: PlayerId, actionType: string, actionData: ActionData): ActionResult {
    if (this.isGameOver) return { success: false, phase: 'validate', reason: 'Game is over' };
    if (this.hasPendingRulesWork) return { success: false, phase: 'validate', reason: 'Rules checkpoint is pending' };
    // Inject stackUuid if not provided — UUID generation is the engine's responsibility
    const dataWithUuid: ActionData = actionData.stackUuid != null ? actionData : { ...actionData, stackUuid: this.generateUuid() };
    return this.actionService.handleAction(this.room, playerId, actionType, dataWithUuid);
  }

  proposeAndStack(playerId: PlayerId, actionType: string, actionData: ActionData): ActionResult {
    if (this.isGameOver) return { success: false, phase: 'validate', reason: 'Game is over' };
    if (this.hasPendingRulesWork) return { success: false, phase: 'validate', reason: 'Rules checkpoint is pending' };
    // Inject stackUuid if not provided — UUID generation is the engine's responsibility
    const dataWithUuid: ActionData = actionData.stackUuid != null ? actionData : { ...actionData, stackUuid: this.generateUuid() };
    const result = this.actionService.proposeAndStack(this.room, playerId, actionType, dataWithUuid);
    if (!result.success) return result;

    const allApplied: GameMutation[] = [];

    // Apply handler-produced mutations
    allApplied.push(...this.applyMutations([{ type: 'SET_LAST_PASSED', playerId: null }, ...(result.mutations ?? [])]));

    // Sync stack to StateMachine (phase transition + event + priority)
    if (result.stackObject && !this.isGameOver) {
      const smMutations = this.stateMachine.addToStack(this.room, result.stackObject);
      if (smMutations.length > 0) {
        allApplied.push(...this.applyMutations(smMutations));
      }
    }

    return { ...result, mutations: allApplied };
  }

  resolveTopOfStack(): ActionResult {
    if (this.isGameOver) return { success: false, phase: 'resolve', reason: 'Game is over' };
    if (this.hasPendingRulesWork) return { success: false, phase: 'resolve', reason: 'Rules checkpoint is pending' };
    const result = this.actionService.resolveTopOfStack(this.room);
    if (!result.success) return result;

    // Apply resolution mutations (zone change + effects + triggers)
    const allApplied: GameMutation[] = [];
    if (result.mutations) {
      allApplied.push(...this.applyMutations(result.mutations, result.resolution));
    }

    if (!this.isGameOver) allApplied.push(...this.applyMutations([
      { type: 'SET_LAST_PASSED', playerId: null },
      ...this.stateMachine.givePriorityTo(this.room.activeTurnPlayerId),
    ]));
    return { ...result, mutations: allApplied };
  }

  // -- Phase / Turn delegation --

  transition(to: Phase): GameMutation[] {
    if (this.isGameOver || this.hasPendingRulesWork) return [];
    const mutations = this.stateMachine.transition(this.room, to);
    if (mutations.length > 0) {
      return this.applyMutations(mutations);
    }
    return mutations;
  }

  /** Advance one committed step at a time, stopping for live stack/input/terminal state. */
  advancePhase(intent: 'complete' | 'skipToEnd'): GameMutation[] {
    if (this.isGameOver || this.hasPendingRulesWork || this.room.stack.length > 0) return [];
    const applied: GameMutation[] = [];
    for (let guard = 0; guard < TURN_SEQUENCE.length; guard++) {
      const step = this.stateMachine.planNextStep(this.room, guard === 0 ? intent : 'complete');
      if (!step) break;
      applied.push(...this.applyMutations([
        { type: 'SET_LAST_PASSED', playerId: null },
        { type: 'SET_PRIORITY', playerId: null },
        ...step.mutations,
      ]));
      if (this.isGameOver || this.hasPendingRulesWork) break;
      if (this.room.stack.length > 0 || step.needsInput) {
        // Triggers need a response window even in an otherwise automatic phase.
        const playerId = this.room.stack.length ? this.room.activeTurnPlayerId : step.priorityPlayerId;
        applied.push(...this.givePriorityTo(playerId));
        break;
      }
    }
    return applied;
  }

  switchTurn(): GameMutation[] {
    if (this.isGameOver || this.hasPendingRulesWork) return [];
    const mutations = this.stateMachine.switchTurn(this.room);
    if (mutations.length > 0) {
      return this.applyMutations(mutations);
    }
    return mutations;
  }

  isPlayerTurn(playerId: PlayerId): boolean {
    if (this.isGameOver) return false;
    return this.stateMachine.isPlayerTurn(this.room, playerId);
  }

  // -- Priority delegation --

  givePriorityTo(playerId: PlayerId): GameMutation[] {
    if (this.isGameOver || this.hasPendingRulesWork) return [];
    const mutations = this.stateMachine.givePriorityTo(playerId);
    if (mutations.length > 0) {
      return this.applyMutations(mutations);
    }
    return mutations;
  }

  passPriority(playerId: PlayerId): { success: boolean; mutations: GameMutation[] } {
    if (this.isGameOver || this.hasPendingRulesWork) return { success: false, mutations: [] };
    const result = this.stateMachine.passPriority(this.room, playerId);
    if (!result.success) return result;
    const applied = this.applyMutations(result.mutations);
    if (!this.isGameOver && result.continuation === 'resolve') {
      const resolved = this.resolveTopOfStack();
      if (resolved.success) applied.push(...(resolved.mutations ?? []));
    } else if (!this.isGameOver && result.continuation === 'advance') {
      applied.push(...this.advancePhase('complete'));
    }
    return { success: true, mutations: applied };
  }

  // -- Accessors --

  private get isGameOver(): boolean {
    return this.room.status === 'gameOver' || this.room.outcome !== undefined;
  }

  get roomState(): GameRoom {
    return this.room;
  }

  get phase(): Phase {
    return this.room.phase;
  }

  get status(): GameRoom['status'] {
    return this.room.status;
  }

  get engineState(): GameRoom['engineState'] {
    return this.room.engineState;
  }

  get activeTurnPlayerId(): PlayerId {
    return this.room.activeTurnPlayerId;
  }

  get priorityPlayerId(): PlayerId | null {
    return this.room.priorityPlayerId;
  }
}
