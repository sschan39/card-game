// src/engine/game-engine.ts
import { v4 as uuidv4 } from 'uuid';
import { EventBus } from './event-bus';
import { MutationCommitter } from './mutation-committer';
import { answerPendingChoice } from './choice-continuation';
import { StateMachine } from './state-machine';
import { ActionService } from './action-service';
import { ActionRegistry, type ActionData, type ActionResult } from './action-registry';
import { createDefaultActionRegistry } from './default-action-registry';
import { gameReducer } from './game-reducer';
import { runRulesCheckpoint } from './rules-checkpoint';
import type { GameMutation } from '../types/game-mutation.types';
import type { GameRoom, PlayerId } from '../types/game.room.types';
import { declarationPlayer } from '../shared/turn-utils';
import { TURN_SEQUENCE, type Phase } from '../types/game.state.types';
import { gameConfig } from '../config';
import { playerCommands, validateActionData } from './player-commands';
import type { AppliedEventBatch, BatchCause, CommandContext, ResolutionReport } from '../types/game-event.types';
import { engineLogger } from '../shared/game-logger';
import { prepareActionChoice, applyActionChoice } from './action-choices';
import type { PendingChoice, ActionContinuation, ChoiceAnswer } from '../types/choice.types';
import { planTriggerScheduling } from './trigger-scheduler';
import { startCombatDamage, type CombatPlan } from './combat-service';
import { defaultEffectContext, type EffectContext } from './effect-context';
import { planStackResolution } from './effect-resolver';
import { immediateAction, isImmediateAction } from './mechanics/immediate-actions';

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
  private readonly commits: MutationCommitter;
  private commandContext?: CommandContext;
  private processingRules = false;
  private readonly effectContext: EffectContext;

  /** Per-room mutation collector for TriggerManager to push into during event dispatch. */
  mutationCollector: GameMutation[] = [];

  constructor(
    room: GameRoom,
    dependencies: Partial<EffectContext> = {},
    private readonly actionRegistry = createDefaultActionRegistry(),
  ) {
    this.effectContext = { ...defaultEffectContext, ...dependencies };
    this.mutationCollector.push(...room.pendingTriggers ?? []);
    this.eventBus = new EventBus(room.roomId);
    this.commits = new MutationCommitter(room, this.eventBus, this.mutationCollector, () => this.generateUuid(), () => this.commandContext);
    this.stateMachine = new StateMachine(room);
    this.actionService = new ActionService(this.eventBus, this.mutationCollector, () => this.generateUuid(), this.effectContext, this.actionRegistry);
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
    this.commits.clearEventBatches();
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
  applyMutations(mutations: GameMutation[], resolution?: ResolutionReport, cause?: BatchCause): GameMutation[] {
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
      const applied = this.commits.commit(mutations, cause ?? { kind: this.commandContext ? 'command' : 'engine' }, resolution);
      if (this.room.pendingChoice) {
        applied.push(...this.commits.commit([{ type: 'SET_PENDING_TRIGGERS', mutations: [...this.mutationCollector] }], { kind: 'engine' }));
        return applied;
      }
      applied.push(...runRulesCheckpoint({
        getRoom: () => this.room,
        takePending: () => this.mutationCollector.splice(0),
        getPending: () => [...this.mutationCollector],
        schedule: () => {
          const planned = planTriggerScheduling(this.room);
          if (planned.immediateObject) {
            const resolution = planStackResolution(planned.mutations.reduce(gameReducer, this.room), planned.immediateObject, undefined, this.effectContext);
            return this.commits.commit([...planned.mutations, ...resolution.mutations,
              ...(resolution.pendingChoice ? [{ type: 'SET_PENDING_CHOICE' as const, choice: this.identifyChoice(resolution.pendingChoice) },
                { type: 'SET_PRIORITY' as const, playerId: null }, { type: 'SET_ENGINE_STATE' as const, state: 'resolving_stack' as const }] : [])],
              { kind: 'trigger', parentBatchId: this.commits.lastBatchId, eventUuids: planned.immediateObject.type === 'triggered' && planned.immediateObject.triggeringEvent?.eventUuid ? [planned.immediateObject.triggeringEvent.eventUuid] : [] }, resolution.resolution);
          }
          const eventUuids = planned.mutations.flatMap(mutation => mutation.type === 'PUSH_STACK' && mutation.stackObject.type === 'triggered' && mutation.stackObject.triggeringEvent?.eventUuid ? [mutation.stackObject.triggeringEvent.eventUuid] : []);
          return this.commits.commit([...planned.mutations, ...(planned.choice ? [{ type: 'SET_PENDING_CHOICE' as const, choice: this.identifyChoice(planned.choice) }, { type: 'SET_PRIORITY' as const, playerId: null }, { type: 'SET_ENGINE_STATE' as const, state: 'state_based_actions' as const }] : [])], { kind: eventUuids.length ? 'trigger' : 'engine', parentBatchId: this.commits.lastBatchId, eventUuids });
        },
        apply: (pending, kind) => {
          const triggers = pending.flatMap(mutation => mutation.type === 'PUSH_STACK' && mutation.stackObject.type === 'triggered' ? [mutation.stackObject] : []);
          if (triggers.length) return this.commits.commit([
            ...pending.filter(mutation => mutation.type !== 'PUSH_STACK' || mutation.stackObject.type !== 'triggered'),
            { type: 'SET_TRIGGER_QUEUE', queue: { resumePriority: this.room.triggerQueue?.resumePriority ?? this.room.priorityPlayerId ?? this.room.activeTurnPlayerId,
              entries: [...this.room.triggerQueue?.entries ?? [], ...triggers.map(object => ({ object, selections: {}, ordered: false }))] } },
          ], { kind: 'engine', parentBatchId: this.commits.lastBatchId });
          const eventUuids = pending.flatMap(mutation => mutation.type === 'PUSH_STACK' && mutation.stackObject.type === 'triggered'
            && mutation.stackObject.triggeringEvent?.eventUuid ? [mutation.stackObject.triggeringEvent.eventUuid] : []);
          return this.commits.commit(pending, {
            kind: kind === 'state-based-action' ? kind : eventUuids.length ? 'trigger' : 'engine',
            parentBatchId: this.commits.lastBatchId, eventUuids: [...new Set(eventUuids)],
          });
        },
      }));
      if (this.room.pendingChoice) applied.push(...this.commits.commit([{ type: 'SET_PENDING_TRIGGERS', mutations: [...this.mutationCollector] }], { kind: 'engine' }));
      return applied;
    } finally {
      this.processingRules = false;
    }
  }

  get hasPendingRulesWork(): boolean {
    return this.processingRules || this.mutationCollector.length > 0 || !!this.room.pendingChoice || !!this.room.triggerQueue;
  }

  /** Consume committed batches after an operation; runtime room refs are not serialized. */
  drainEventBatches(): AppliedEventBatch[] {
    return this.commits.drainEventBatches();
  }

  // -- Action pipeline --

  /** The player-command boundary. Lower-level methods remain rules/test primitives. */
  executePlayerAction(playerId: PlayerId, actionId: string, data: unknown = {}): ActionResult {
    return this.withCommandContext(actionId, playerId, () => {
      const result = this.executeCommand(playerId, actionId, data);
      const logger = engineLogger.withContext({ roomId: this.room.roomId, ...this.commandContext });
      if (!result.success) { if (gameConfig.logging.actions) logger.warn('command:rejected', result.reason, { phase: result.phase }); }
      else if (gameConfig.logging.actions) logger.info('command:accepted', this.room.pendingChoice ? 'Choice opened' : 'Action accepted', {
        outcome: this.room.pendingChoice ? 'choice' : result.mutations?.length ? 'committed' : 'no_change',
        choiceId: this.room.pendingChoice?.id, kind: this.room.pendingChoice?.kind, phase: this.room.phase, stack: this.room.stack.length,
        priorityPlayerId: this.room.priorityPlayerId, declarationPlayerId: declarationPlayer(this.room),
        ...(this.room.pendingChoice ? this.room.pendingChoice.kind === 'number' ? { range: this.room.pendingChoice.range } : { total: this.room.pendingChoice.total } : {}),
      });
      else if (gameConfig.logging.appliedEvents) logger.debug('command:accepted');
      return result;
    });
  }

  /** Include host-side command continuations (currently RPS setup) in the same timeline. */
  withCommandContext<T>(action: string, playerId: PlayerId, operation: () => T, commandId?: string): T {
    const previous = this.commandContext;
    this.commandContext = previous ?? { commandId: commandId?.trim() ? commandId : uuidv4(), action, playerId };
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
    if (this.room.pendingChoice) {
      if (actionId !== 'choose') return reject('A choice is pending');
      const engine = this;
      return answerPendingChoice({
        get room() { return engine.room; },
        get isGameOver() { return engine.isGameOver; },
        get hasPendingRulesWork() { return engine.hasPendingRulesWork; },
        effectContext: this.effectContext,
        applyMutations: this.applyMutations.bind(this), identifyChoice: this.identifyChoice.bind(this),
        givePriorityTo: this.givePriorityTo.bind(this), combatPlanMutations: this.combatPlanMutations.bind(this),
        commitResolution: this.commitResolution.bind(this), resumeActionChoice: this.resumeActionChoice.bind(this),
      }, playerId, actionData);
    }
    if (actionId === 'choose') return reject('No choice is pending');
    if (this.hasPendingRulesWork) return reject('Rules checkpoint is pending');
    const timingError = this.readyCommandError(this.room, actionId, actionData);
    if (timingError) return reject(timingError);
    const command = Object.prototype.hasOwnProperty.call(playerCommands, actionId) ? playerCommands[actionId] : undefined;
    const preparation = prepareActionChoice(this.room, playerId, actionId, actionData);
    if (preparation.error) return reject(preparation.error);
    if (preparation.choice) return { success: true, mutations: this.applyMutations([{ type: 'SET_PENDING_CHOICE', choice: this.identifyChoice(preparation.choice) }]) };
    return command ? command.execute(this, playerId, actionData) : this.proposeAndStack(playerId, actionId, actionData);
  }

  /** Rechecked on action-choice completion against the current room. */
  private readyCommandError(room: GameRoom, actionId: string, data: ActionData): string | undefined {
    const declaration = declarationPlayer(room);
    if (declaration && !room.stack.length && actionId !== 'declare_attackers' && actionId !== 'declare_blockers' && actionId !== 'end_turn') return 'Combat declaration is required';
    const command = Object.prototype.hasOwnProperty.call(playerCommands, actionId) ? playerCommands[actionId] : undefined;
    if (!command && !this.actionRegistry.has(actionId)) {
      return `No handler registered for action: ${actionId}`;
    }
    const status = command?.status ?? 'playing';
    if (room.status !== status) return `Action requires ${status} status`;
    if (room.engineState !== 'waiting_for_player') return 'Engine is not ready for player input';
    const mode = room.debugMode ?? gameConfig.debugMode;
    if (command?.debug && mode !== 'flow' && mode !== command.debug) return 'Debug command is disabled in this mode';
    const commandError = command?.validate(data);
    return commandError;
  }

  private identifyChoice(choice: PendingChoice): PendingChoice {
    return { ...choice, id: this.generateUuid() };
  }

  private resumeActionChoice(playerId: PlayerId, continuation: ActionContinuation, answer: ChoiceAnswer): ActionResult {
    const reject = (reason: string): ActionResult => ({ success: false, phase: 'validate', reason });
    const actionData = applyActionChoice(continuation, answer);
    const room = { ...this.room, pendingChoice: null };
    const timingError = this.readyCommandError(room, continuation.actionId, actionData);
    if (timingError) return reject(timingError);
    const preparation = prepareActionChoice(room, playerId, continuation.actionId, actionData, true);
    if (preparation.error) return reject(preparation.error);
    if (preparation.choice) return { success: true, mutations: this.applyMutations([{ type: 'SET_PENDING_CHOICE', choice: this.identifyChoice(preparation.choice) }]) };
    // Plan against the current room before consuming the request. Clearing the
    // choice and committing the action are one transaction: no checkpoint can
    // interleave between validation and payment, and failure keeps the request.
    const result = this.actionService.proposeAndStack(room, playerId, continuation.actionId,
      { ...actionData, stackUuid: this.generateUuid() });
    if (!result.success) return result;
    return this.commitAction(result, [{ type: 'SET_PENDING_CHOICE', choice: null }, { type: 'SET_PENDING_TRIGGERS', mutations: [] }]);
  }

  handleAction(playerId: PlayerId, actionType: string, actionData: ActionData): ActionResult {
    if (this.isGameOver) return { success: false, phase: 'validate', reason: 'Game is over' };
    if (this.hasPendingRulesWork) return { success: false, phase: 'validate', reason: 'Rules checkpoint is pending' };
    if (declarationPlayer(this.room) && !this.room.stack.length && actionType !== 'declare_attackers' && actionType !== 'declare_blockers') return { success: false, phase: 'validate', reason: 'Combat declaration is required' };
    // Inject stackUuid if not provided — UUID generation is the engine's responsibility
    const dataWithUuid: ActionData = actionData.stackUuid != null ? actionData : { ...actionData, stackUuid: this.generateUuid() };
    return this.actionService.handleAction(this.room, playerId, actionType, dataWithUuid);
  }

  proposeAndStack(playerId: PlayerId, actionType: string, actionData: ActionData): ActionResult {
    const result = this.handleAction(playerId, actionType, actionData);
    return result.success ? this.commitAction(result) : result;
  }

  /** Commit a previously planned action; no player packet validation here. */
  private commitAction(result: Extract<ActionResult, { success: true }>, prefix: GameMutation[] = []): ActionResult {
    if (result.stackObject && isImmediateAction(this.room, result.stackObject)) {
      const object = immediateAction(this.room, result.stackObject);
      const costs = [...prefix, { type: 'SET_LAST_PASSED' as const, playerId: null }, ...(result.mutations ?? []).filter(mutation =>
        !(mutation.type === 'PUSH_STACK' && mutation.stackObject.uuid === object.uuid) &&
        !(mutation.type === 'MOVE_CARD' && mutation.to === 'stack' && mutation.stackObject?.uuid === object.uuid))];
      const planned = planStackResolution(costs.reduce(gameReducer, this.room), object, undefined, this.effectContext);
      return this.commitResolution({ success: true, ...planned, mutations: [...costs, ...planned.mutations] });
    }
    const allApplied: GameMutation[] = [];

    // Apply handler-produced mutations
    allApplied.push(...this.applyMutations([...prefix, { type: 'SET_LAST_PASSED', playerId: null }, ...(result.mutations ?? [])]));

    // Sync stack to StateMachine (phase transition + event + priority)
    if (result.stackObject && !this.isGameOver && !this.room.pendingChoice) {
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

    return this.commitResolution(result);
  }

  private commitResolution(result: Extract<ActionResult, { success: true }>): ActionResult {
    const resumePriority = result.resolution?.stackObj.immediate
      ? this.room.triggerQueue?.resumePriority ?? result.resolution.stackObj.controllerId
      : this.room.activeTurnPlayerId;
    // Apply resolution mutations (zone change + effects + triggers)
    const allApplied: GameMutation[] = [];
    if (result.mutations) {
      allApplied.push(...this.applyMutations([
        ...result.mutations,
        { type: 'SET_PENDING_CHOICE', choice: result.pendingChoice ? this.identifyChoice(result.pendingChoice) : null },
        ...(result.pendingChoice ? [{ type: 'SET_PRIORITY' as const, playerId: null }, { type: 'SET_ENGINE_STATE' as const, state: 'resolving_stack' as const }]
          : [{ type: 'SET_PENDING_TRIGGERS' as const, mutations: [] }]),
      ], result.resolution));
    }

    if (!this.isGameOver && !this.room.pendingChoice) allApplied.push(...this.applyMutations([
      { type: 'SET_LAST_PASSED', playerId: null },
      ...(declarationPlayer(this.room) && !this.room.stack.length ? [{ type: 'SET_PRIORITY' as const, playerId: null }, { type: 'SET_ENGINE_STATE' as const, state: 'waiting_for_player' as const }] : this.stateMachine.givePriorityTo(resumePriority)),
    ]));
    return { ...result, mutations: allApplied };
  }

  // -- Phase / Turn delegation --

  private combatPlanMutations(plan: CombatPlan): GameMutation[] {
    return [...plan.mutations, ...(plan.choice ? [{ type: 'SET_PENDING_CHOICE' as const, choice: this.identifyChoice(plan.choice) }]
      : this.stateMachine.givePriorityTo(this.room.activeTurnPlayerId))];
  }

  private phaseMutations(mutations: GameMutation[]): GameMutation[] {
    const enteringDamage = mutations.some(mutation => mutation.type === 'SET_PHASE' && mutation.phase === 'combatDamageStep');
    return enteringDamage ? [...mutations, ...this.combatPlanMutations(startCombatDamage(mutations.reduce(gameReducer, this.room)))] : mutations;
  }

  transition(to: Phase): GameMutation[] {
    if (this.isGameOver || this.hasPendingRulesWork) return [];
    const mutations = this.stateMachine.transition(this.room, to);
    if (mutations.length > 0) {
      return this.applyMutations(this.phaseMutations(mutations));
    }
    return mutations;
  }

  /** Advance one committed step at a time, stopping for live stack/input/terminal state. */
  advancePhase(intent: 'complete' | 'skipToEnd'): GameMutation[] {
    if (this.isGameOver || this.hasPendingRulesWork || this.room.stack.length > 0 || (intent === 'complete' && declarationPlayer(this.room))) return [];
    const damage = this.room.combatDamage;
    if (intent === 'complete' && this.room.phase === 'combatDamageStep' && damage?.completed && damage.passIndex + 1 < damage.passes.length) {
      const mutations = this.applyMutations(this.combatPlanMutations(startCombatDamage(this.room, true)));
      if (!this.isGameOver && !this.hasPendingRulesWork) mutations.push(...this.givePriorityTo(this.room.activeTurnPlayerId));
      return mutations;
    }
    const applied: GameMutation[] = [];
    for (let guard = 0; guard < TURN_SEQUENCE.length; guard++) {
      const step = this.stateMachine.planNextStep(this.room, guard === 0 ? intent : 'complete');
      if (!step) break;
      applied.push(...this.applyMutations([
        { type: 'SET_LAST_PASSED', playerId: null },
        { type: 'SET_PRIORITY', playerId: null },
        // Retain response tails, then let combat declaration choices suppress them.
        ...this.phaseMutations([...step.mutations, ...(step.priorityPlayerId ? this.stateMachine.givePriorityTo(step.priorityPlayerId)
          : [{ type: 'SET_ENGINE_STATE' as const, state: 'waiting_for_player' as const }])]),
      ]));
      if (this.isGameOver || this.hasPendingRulesWork) break;
      const stopForInput = intent === 'skipToEnd' ? step.phase === 'stateMainPhase' : step.needsInput;
      if (this.room.stack.length > 0 || stopForInput) {
        // Triggers need a response window even in an otherwise automatic phase.
        const playerId = this.room.stack.length ? this.room.activeTurnPlayerId : step.priorityPlayerId;
        applied.push(...(playerId ? this.givePriorityTo(playerId) : this.applyMutations([{ type: 'SET_ENGINE_STATE', state: 'waiting_for_player' }])));
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
    if (this.isGameOver || this.hasPendingRulesWork || (declarationPlayer(this.room) && !this.room.stack.length)) return { success: false, mutations: [] };
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

  private get room(): GameRoom { return this.commits.roomState; }

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
