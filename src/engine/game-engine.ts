// src/engine/game-engine.ts
import { v4 as uuidv4 } from 'uuid';
import { EventBus } from './event-bus';
import { StateMachine } from './state-machine';
import { ActionService } from './action-service';
import { ActionRegistry, type ActionData, type ActionResult } from './action-registry';
import { gameReducer } from './game-reducer';
import { checkStateBasedActions } from './state-based-actions';
import type { GameMutation } from '../types/game-mutation.types';
import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { Phase } from '../types/game.state.types';
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
 * 3. Mutation collector drains trigger-produced mutations after event dispatch
 */
export class GameEngine {
  private eventBus: EventBus;
  private stateMachine: StateMachine;
  private actionService: ActionService;
  private room: GameRoom;
  private eventBatches: AppliedEventBatch[] = [];
  private commandContext?: CommandContext;

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
    const allApplied: GameMutation[] = [];
    let previousBatchId: string | undefined;
    const apply = (muts: GameMutation[], cause: BatchCause, report?: ResolutionReport): void => {
      const before = this.room;
      const steps: AppliedMutation[] = [];
      for (const mutation of muts) {
        if (this.isGameOver) break;
        const previous = this.room;
        const next = gameReducer(previous, mutation);
        if (sameStateValue(previous, next)) continue;
        this.room = next;
        steps.push({ mutation, before: previous, after: this.room });
        allApplied.push(mutation);
        if (mutation.type === 'MOVE_CARD' && this.room.continuousEffectPool.some(entry => entry.source === mutation.cardUuid)) {
          this.mutationCollector.push({ type: 'REMOVE_CONTINUOUS_EFFECT', source: mutation.cardUuid });
        }
      }
      // Keep the existing terminal guard; full checkpoint ordering is milestone 1.4.
      const ending = checkStateBasedActions(this.room).find(mutation => mutation.type === 'END_GAME');
      if (ending) {
        const previous = this.room;
        this.room = gameReducer(previous, ending);
        steps.push({ mutation: ending, before: previous, after: this.room });
        allApplied.push(ending);
      }
      if (!steps.length) return;
      const batchId = uuidv4();
      const events = deriveAppliedEvents(before, this.room, steps, report).map((event, index) => ({
        ...structuredClone(event), batchId, eventUuid: batchId + ':' + index, commandId: this.commandContext?.commandId,
      }));
      const batch: AppliedEventBatch = {
        batchId, command: this.commandContext, cause, before, after: this.room,
        mutations: steps.map(step => step.mutation), events,
      };
      this.eventBatches.push(batch);
      previousBatchId = batchId;
      // Every listener now sees the complete committed batch, never a planning preview.
      for (const event of events) this.eventBus.emit(event, { before, after: batch.after, command: batch.command });
      if (this.isGameOver) this.mutationCollector.length = 0;
    };
    const drainTriggers = () => {
      while (this.mutationCollector.length > 0) {
        const triggered = this.mutationCollector.splice(0);
        const eventUuids = triggered.flatMap(mutation => mutation.type === 'PUSH_STACK' && mutation.stackObject.type === 'triggered'
          && mutation.stackObject.triggeringEvent?.eventUuid ? [mutation.stackObject.triggeringEvent.eventUuid] : []);
        apply(triggered, { kind: eventUuids.length ? 'trigger' : 'engine', parentBatchId: previousBatchId, eventUuids: [...new Set(eventUuids)] });
      }
    };
    apply(mutations, { kind: this.commandContext ? 'command' : 'engine' }, resolution);
    drainTriggers();
    let sbaMutations = checkStateBasedActions(this.room);
    while (sbaMutations.length > 0) {
      apply(sbaMutations, { kind: 'state-based-action', parentBatchId: previousBatchId });
      drainTriggers();
      sbaMutations = checkStateBasedActions(this.room);
    }
    return allApplied;
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
    // Inject stackUuid if not provided — UUID generation is the engine's responsibility
    const dataWithUuid: ActionData = actionData.stackUuid != null ? actionData : { ...actionData, stackUuid: this.generateUuid() };
    return this.actionService.handleAction(this.room, playerId, actionType, dataWithUuid);
  }

  proposeAndStack(playerId: PlayerId, actionType: string, actionData: ActionData): ActionResult {
    if (this.isGameOver) return { success: false, phase: 'validate', reason: 'Game is over' };
    // Inject stackUuid if not provided — UUID generation is the engine's responsibility
    const dataWithUuid: ActionData = actionData.stackUuid != null ? actionData : { ...actionData, stackUuid: this.generateUuid() };
    const result = this.actionService.proposeAndStack(this.room, playerId, actionType, dataWithUuid);
    if (!result.success) return result;

    const allApplied: GameMutation[] = [];

    // Apply handler-produced mutations
    if (result.mutations) {
      allApplied.push(...this.applyMutations(result.mutations));
    }

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
    const result = this.actionService.resolveTopOfStack(this.room);
    if (!result.success) return result;

    // Apply resolution mutations (zone change + effects + triggers)
    const allApplied: GameMutation[] = [];
    if (result.mutations) {
      allApplied.push(...this.applyMutations(result.mutations, result.resolution));
    }

    return { ...result, mutations: allApplied };
  }

  // -- Phase / Turn delegation --

  transition(to: Phase): GameMutation[] {
    if (this.isGameOver) return [];
    const mutations = this.stateMachine.transition(this.room, to);
    if (mutations.length > 0) {
      return this.applyMutations(mutations);
    }
    return mutations;
  }

  /**
   * Advance the phase clock, stopping at the first phase that needs input.
   * Delegates to the StateMachine director.
   *
   * The director returns ONE flat array covering every auto-advanced phase.
   * We apply it in phase-boundary chunks (split after each SET_PHASE) so that
   * State-Based Actions run at each phase boundary. This is required for
   * combat: combatDamageStep applies lethal damage and cleanupStep clears it
   * (CR 514.2). If the whole chain were applied as a single batch, SBA would
   * only run after damage had already been cleared, and creatures with lethal
   * damage would survive (CR 704.3 — SBAs are checked whenever a player would
   * receive priority, i.e. at each phase boundary).
   */
  advancePhase(intent: 'complete' | 'skipToEnd'): GameMutation[] {
    if (this.isGameOver) return [];
    const mutations = this.stateMachine.advancePhase(this.room, intent);
    return this.applyPhaseChunked(mutations);
  }

  /**
   * Apply a mutation array that may contain one or more phase transitions,
   * running State-Based Actions at each phase boundary (see advancePhase).
   * SET_PHASE is always the last mutation a transition() emits, so it marks
   * the end of a phase's side effects.
   */
  private applyPhaseChunked(mutations: GameMutation[]): GameMutation[] {
    if (mutations.length === 0) return mutations;

    const allApplied: GameMutation[] = [];
    let chunk: GameMutation[] = [];
    for (const m of mutations) {
      if (this.isGameOver) break;
      chunk.push(m);
      if (m.type === 'SET_PHASE') {
        allApplied.push(...this.applyMutations(chunk));
        chunk = [];
      }
    }
    // Trailing mutations after the final SET_PHASE (e.g. givePriorityTo).
    if (chunk.length > 0) {
      allApplied.push(...this.applyMutations(chunk));
    }
    return allApplied;
  }

  switchTurn(): GameMutation[] {
    if (this.isGameOver) return [];
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
    if (this.isGameOver) return [];
    const mutations = this.stateMachine.givePriorityTo(playerId);
    if (mutations.length > 0) {
      return this.applyMutations(mutations);
    }
    return mutations;
  }

  passPriority(playerId: PlayerId): { success: boolean; mutations: GameMutation[] } {
    if (this.isGameOver) return { success: false, mutations: [] };
    const result = this.stateMachine.passPriority(this.room, playerId);
    if (!result.success) return result;

    // passPriority may embed an advancePhase chain (empty stack + both passed),
    // so apply it phase-chunked to run SBA at each phase boundary.
    const applied = this.applyPhaseChunked(result.mutations);

    // If the state machine requested stack resolution, do it now.
    if (this.room.engineState === 'resolving_stack') {
      const resolveResult = this.resolveTopOfStack();
      if (resolveResult.success) {
        applied.push(...(resolveResult.mutations ?? []));
      }
      if (this.isGameOver) return { success: true, mutations: applied };

      // After resolution, return to the SAME phase with active player priority.
      // Do NOT advance the phase — MTG 116.4: after a spell resolves, the
      // active player gets priority again in the same phase.
      applied.push(...this.applyMutations([
        { type: 'SET_ENGINE_STATE', state: 'waiting_for_player' },
      ]));
      applied.push(...this.givePriorityTo(this.room.activeTurnPlayerId));
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
