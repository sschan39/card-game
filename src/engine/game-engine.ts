// src/engine/game-engine.ts
import { v4 as uuidv4 } from 'uuid';
import { EventBus, type EventContext } from './event-bus';
import { StateMachine } from './state-machine';
import { ActionService } from './action-service';
import { ActionRegistry, type ActionData, type ActionResult } from './action-registry';
import { gameReducer, reduceGameOperation } from './game-reducer';
import { runRulesCheckpoint } from './rules-checkpoint';
import type { GameMutation } from '../types/game-mutation.types';
import type { GameRoom, PlayerId } from '../types/game.room.types';
import { declarationPlayer } from '../shared/turn-utils';
import { TURN_SEQUENCE, type Phase } from '../types/game.state.types';
import { gameConfig } from '../config';
import { playerCommands, validateActionData } from './player-commands';
import { deriveAppliedEvents, sameStateValue, type AppliedMutation } from './applied-events';
import type { AppliedEventBatch, BatchCause, CommandContext, ResolutionReport } from '../types/game-event.types';
import { engineLogger } from '../shared/game-logger';
import { prepareActionChoice, applyActionChoice } from './action-choices';
import { validateChoiceAnswer } from './choices';
import { applyResolutionChoice } from './resolution-choices';
import { planStackResolution } from './effect-resolver';
import type { PendingChoice } from '../types/choice.types';
import { captureSourceInformation, retainDepartingSource } from './source-information';
import { applyTriggerChoice, planTriggerScheduling } from './trigger-scheduler';
import { newTurnHistory, recordRuleEvent } from './turn-history';
import { answerCombatDamage, startCombatDamage, type CombatPlan } from './combat-service';
import { effectIsActive, roomCards } from './continuous-effects';
import { planProposedMutations, resumeProposedChoice } from './proposed-events';
import { answerStateBasedChoice } from './state-based-planner';
import { defaultEffectContext, type EffectContext } from './effect-context';

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
  private readonly effectContext: EffectContext;

  /** Per-room mutation collector for TriggerManager to push into during event dispatch. */
  mutationCollector: GameMutation[] = [];

  constructor(room: GameRoom, dependencies: Partial<EffectContext> = {}) {
    this.effectContext = { ...defaultEffectContext, ...dependencies };
    this.room = room;
    this.mutationCollector.push(...room.pendingTriggers ?? []);
    this.eventBus = new EventBus(room.roomId);
    this.stateMachine = new StateMachine(room);
    this.actionService = new ActionService(this.eventBus, this.mutationCollector, () => this.generateUuid(), this.effectContext);
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
      const applied = this.commitMutations(mutations, cause ?? { kind: this.commandContext ? 'command' : 'engine' }, resolution);
      if (this.room.pendingChoice) {
        applied.push(...this.commitMutations([{ type: 'SET_PENDING_TRIGGERS', mutations: [...this.mutationCollector] }], { kind: 'engine' }));
        return applied;
      }
      applied.push(...runRulesCheckpoint({
        getRoom: () => this.room,
        takePending: () => this.mutationCollector.splice(0),
        getPending: () => [...this.mutationCollector],
        schedule: () => {
          const planned = planTriggerScheduling(this.room);
          const eventUuids = planned.mutations.flatMap(mutation => mutation.type === 'PUSH_STACK' && mutation.stackObject.type === 'triggered' && mutation.stackObject.triggeringEvent?.eventUuid ? [mutation.stackObject.triggeringEvent.eventUuid] : []);
          return this.commitMutations([...planned.mutations, ...(planned.choice ? [{ type: 'SET_PENDING_CHOICE' as const, choice: this.identifyChoice(planned.choice) }, { type: 'SET_PRIORITY' as const, playerId: null }, { type: 'SET_ENGINE_STATE' as const, state: 'state_based_actions' as const }] : [])], { kind: eventUuids.length ? 'trigger' : 'engine', parentBatchId: this.lastBatchId, eventUuids });
        },
        apply: (pending, kind) => {
          const triggers = pending.flatMap(mutation => mutation.type === 'PUSH_STACK' && mutation.stackObject.type === 'triggered' ? [mutation.stackObject] : []);
          if (triggers.length) return this.commitMutations([
            ...pending.filter(mutation => mutation.type !== 'PUSH_STACK' || mutation.stackObject.type !== 'triggered'),
            { type: 'SET_TRIGGER_QUEUE', queue: { resumePriority: this.room.triggerQueue?.resumePriority ?? this.room.priorityPlayerId ?? this.room.activeTurnPlayerId,
              entries: [...this.room.triggerQueue?.entries ?? [], ...triggers.map(object => ({ object, selections: {}, ordered: false }))] } },
          ], { kind: 'engine', parentBatchId: this.lastBatchId });
          const eventUuids = pending.flatMap(mutation => mutation.type === 'PUSH_STACK' && mutation.stackObject.type === 'triggered'
            && mutation.stackObject.triggeringEvent?.eventUuid ? [mutation.stackObject.triggeringEvent.eventUuid] : []);
          return this.commitMutations(pending, {
            kind: kind === 'state-based-action' ? kind : eventUuids.length ? 'trigger' : 'engine',
            parentBatchId: this.lastBatchId, eventUuids: [...new Set(eventUuids)],
          });
        },
      }));
      if (this.room.pendingChoice) applied.push(...this.commitMutations([{ type: 'SET_PENDING_TRIGGERS', mutations: [...this.mutationCollector] }], { kind: 'engine' }));
      return applied;
    } finally {
      this.processingRules = false;
    }
  }

  /** Finish proposal decisions before committing any part of this transaction. */
  private commitMutations(mutations: GameMutation[], cause: BatchCause, resolution?: ResolutionReport): GameMutation[] {
    const plan = planProposedMutations(this.room, mutations, { simultaneous: cause.kind === 'state-based-action', cause, resolution });
    if (plan.pendingChoice) return this.commitPreparedMutations([
      { type: 'SET_PENDING_CHOICE', choice: this.identifyChoice(plan.pendingChoice) },
      { type: 'SET_PRIORITY', playerId: null }, { type: 'SET_ENGINE_STATE', state: cause.kind === 'state-based-action' ? 'state_based_actions' : 'resolving_stack' },
    ], cause);
    return this.commitPreparedMutations(plan.mutations, cause, resolution);
  }

  /** Apply and publish one complete prepared batch. Settlement belongs to the checkpoint. */
  private commitPreparedMutations(mutations: GameMutation[], cause: BatchCause, resolution?: ResolutionReport): GameMutation[] {
    const before = this.room;
    const steps: AppliedMutation[] = [];
    for (const proposed of mutations) {
      if (this.isGameOver) break;
      const previous = this.room;
      const simultaneous = proposed.type === 'MOVE_CARD' && cause.kind === 'state-based-action' ? before.battlefield.find(card => card.uuid === proposed.cardUuid) : undefined;
      const mutation: GameMutation = proposed.type === 'ADD_DELAYED_TRIGGER' && !proposed.registration.id
        ? { ...proposed, registration: { ...proposed.registration, id: this.generateUuid() } }
        : proposed.type === 'SET_PENDING_CHOICE' && proposed.choice && !proposed.choice.id ? { ...proposed, choice: this.identifyChoice(proposed.choice) }
        : simultaneous && proposed.type === 'MOVE_CARD' ? { ...proposed, sourceSnapshot: captureSourceInformation(before, simultaneous) } : proposed;
      const outcome = reduceGameOperation(previous, mutation);
      if (outcome.status !== 'committed') continue;
      const next = outcome.state;
      this.room = next;
      steps.push({ mutation, before: previous, after: next, events: outcome.events });
      if (mutation.type === 'MOVE_CARD') {
        const card = previous.battlefield.find(card => card.uuid === mutation.cardUuid);
        if (card) {
          const snapshot = mutation.sourceSnapshot ?? captureSourceInformation(previous, card);
          for (let index = 0; index < this.mutationCollector.length; index++) {
            const pending = this.mutationCollector[index];
            if (pending.type === 'PUSH_STACK') this.mutationCollector[index] = { ...pending, stackObject: retainDepartingSource(pending.stackObject, snapshot) };
          }
        }
      }
      if (mutation.type === 'MOVE_CARD') for (const entry of next.continuousEffectPool) {
        if (entry.source === mutation.cardUuid && !effectIsActive(roomCards(next), entry)) this.mutationCollector.push(entry.id
          ? { type: 'REMOVE_CONTINUOUS_EFFECT', id: entry.id }
          : { type: 'REMOVE_CONTINUOUS_EFFECT', source: entry.source, dependentOnly: true });
      }
    }
    if (!steps.length) return [];
    const batchId = uuidv4();
    const eventContexts: EventContext[] = [];
    const events = deriveAppliedEvents(before, this.room, steps, resolution, (eventBefore, eventAfter) => {
      eventContexts.push({ before: eventBefore, after: eventAfter, command: this.commandContext });
    }).map((event, index) => ({
      ...structuredClone(event), batchId, eventUuid: batchId + ':' + index, commandId: this.commandContext?.commandId,
    }));
    // Conditions observe event history at their own point in an atomic batch,
    // rather than seeing later instructions or the next turn's history.
    let history = before.turnHistory ?? newTurnHistory(before.turnNumber ?? 1);
    let recorded = false;
    events.forEach((event, index) => {
      const context = eventContexts[index];
      if ((context.after.turnNumber ?? 1) !== history.turnNumber) history = context.after.turnHistory ?? newTurnHistory(context.after.turnNumber ?? 1);
      if (event.eventId === 'MUTATION_APPLIED' && ['RECORD_ABILITY_USE', 'SET_TURN_HISTORY'].includes(event.payload.mutation.type)) {
        history = { ...history, uses: context.after.turnHistory?.uses ?? history.uses };
      }
      const previousHistory = history;
      history = recordRuleEvent(history, event);
      recorded ||= history !== previousHistory;
      context.before = { ...(cause.kind === 'state-based-action' && ['PERMANENT_LEFT', 'PERMANENT_DIED'].includes(event.eventId) ? before : context.before), turnHistory: previousHistory };
      context.after = { ...context.after, turnHistory: history };
    });
    if (recorded && !sameStateValue(history, this.room.turnHistory)) {
      const previous = this.room;
      const mutation: GameMutation = { type: 'SET_TURN_HISTORY', history };
      this.room = gameReducer(previous, mutation);
      const step = { mutation, before: previous, after: this.room };
      steps.push(step);
      const event = deriveAppliedEvents(previous, this.room, [step])[0];
      eventContexts.push({ before: previous, after: this.room, command: this.commandContext });
      events.push({ ...event, batchId, eventUuid: batchId + ':' + events.length, commandId: this.commandContext?.commandId });
    }
    const batch: AppliedEventBatch = { batchId, command: this.commandContext, cause, before, after: this.room,
      mutations: steps.map(step => step.mutation), events };
    this.eventBatches.push(batch);
    this.lastBatchId = batchId;
    events.forEach((event, index) => {
      const context = eventContexts[index];
      // SBAs happen simultaneously: every departure witnesses the complete
      // batch's history, while retaining battlefield information from before it.
      if (cause.kind === 'state-based-action' && ['PERMANENT_LEFT', 'PERMANENT_DIED'].includes(event.eventId)) context.after = { ...context.after, turnHistory: this.room.turnHistory };
      this.eventBus.emit(event, context);
    });
    // Discovery happens after the whole batch commits. Newly queued triggers must
    // also retain departures that occurred later than their triggering event.
    for (const step of steps) {
      const mutation = step.mutation;
      if (mutation.type !== 'MOVE_CARD' || mutation.from !== 'battlefield') continue;
      const card = step.before.battlefield.find(card => card.uuid === mutation.cardUuid);
      if (!card) continue;
      const snapshot = mutation.sourceSnapshot ?? captureSourceInformation(step.before, card);
      for (let index = 0; index < this.mutationCollector.length; index++) {
        const pending = this.mutationCollector[index];
        if (pending.type === 'PUSH_STACK') this.mutationCollector[index] = { ...pending, stackObject: retainDepartingSource(pending.stackObject, snapshot) };
      }
    }
    if (this.isGameOver) this.mutationCollector.length = 0;
    return batch.mutations;
  }

  get hasPendingRulesWork(): boolean {
    return this.processingRules || this.mutationCollector.length > 0 || !!this.room.pendingChoice || !!this.room.triggerQueue;
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
    if (this.room.pendingChoice) {
      if (actionId !== 'choose') return reject('A choice is pending');
      return this.answerChoice(playerId, actionData);
    }
    if (actionId === 'choose') return reject('No choice is pending');
    if (this.hasPendingRulesWork) return reject('Rules checkpoint is pending');
    const declaration = declarationPlayer(this.room);
    if (declaration && !this.room.stack.length && actionId !== 'declare_attackers' && actionId !== 'declare_blockers' && actionId !== 'end_turn') return reject('Combat declaration is required');
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
    const preparation = prepareActionChoice(this.room, playerId, actionId, actionData);
    if (preparation.error) return reject(preparation.error);
    if (preparation.choice) return { success: true, mutations: this.applyMutations([{ type: 'SET_PENDING_CHOICE', choice: this.identifyChoice(preparation.choice) }]) };
    return command ? command.execute(this, playerId, actionData) : this.proposeAndStack(playerId, actionId, actionData);
  }

  private identifyChoice(choice: PendingChoice): PendingChoice {
    return { ...choice, id: this.generateUuid() };
  }

  private answerChoice(playerId: PlayerId, data: ActionData): ActionResult {
    const choice = this.room.pendingChoice!;
    const reject = (reason: string): ActionResult => ({ success: false, phase: 'validate', reason });
    if (choice.playerId !== playerId) return reject('This choice belongs to another player');
    if (data.choiceId !== choice.id) return reject('Choice request is stale');
    if (data.cancel === true && choice.continuation.type === 'action') return { success: true, mutations: this.applyMutations([{ type: 'SET_PENDING_CHOICE', choice: null }, { type: 'SET_PENDING_TRIGGERS', mutations: [] }]) };
    const answer = validateChoiceAnswer(choice, data);
    if (!answer) return reject('Invalid choice answer');
    if (choice.continuation.type === 'state_based') {
      let plan: ReturnType<typeof answerStateBasedChoice>;
      try { plan = answerStateBasedChoice(this.room, choice, answer); }
      catch (error) { return reject(error instanceof Error ? error.message : 'Invalid state-based decision'); }
      if (plan.pendingChoice) return { success: true, mutations: this.applyMutations([{ type: 'SET_PENDING_CHOICE', choice: this.identifyChoice(plan.pendingChoice) }]) };
      const mutations = this.applyMutations([{ type: 'SET_PENDING_CHOICE', choice: null }, { type: 'SET_PENDING_TRIGGERS', mutations: [] }, ...plan.mutations], undefined, { kind: 'state-based-action' });
      if (!this.isGameOver && !this.hasPendingRulesWork && choice.continuation.batch.resumePriority) mutations.push(...this.givePriorityTo(choice.continuation.batch.resumePriority));
      return { success: true, mutations };
    }
    if (choice.continuation.type === 'replacement') {
      const saved = choice.continuation;
      const transaction = saved.parents?.slice(-1)[0] ?? saved.transaction;
      let plan: ReturnType<typeof resumeProposedChoice>;
      try { plan = resumeProposedChoice(this.room, choice, answer); }
      catch (error) { return reject(error instanceof Error ? error.message : 'Invalid replacement decision'); }
      if (plan.pendingChoice) return { success: true, mutations: this.applyMutations([{ type: 'SET_PENDING_CHOICE', choice: this.identifyChoice(plan.pendingChoice) }]) };
      const completed: GameMutation[] = [{ type: 'SET_PENDING_CHOICE', choice: null }, { type: 'SET_PENDING_TRIGGERS', mutations: [] }, ...plan.mutations];
      if (saved.afterResolution) {
        const room = completed.reduce(gameReducer, this.room);
        const next = planStackResolution(room, saved.afterResolution.stackObj, saved.afterResolution, this.effectContext);
        return this.commitResolution({ success: true, ...next, mutations: [...completed, ...next.mutations] });
      }
      const mutations = this.applyMutations(completed, transaction.resolution, transaction.cause);
      if (!this.isGameOver && !this.hasPendingRulesWork) mutations.push(...(transaction.resumePriority
        ? this.givePriorityTo(transaction.resumePriority) : this.applyMutations([{ type: 'SET_ENGINE_STATE', state: 'waiting_for_player' }])));
      return { success: true, mutations };
    }
    if (choice.continuation.type === 'combat') {
      const plan = answerCombatDamage(this.room, choice, answer);
      if (plan.error) return reject(plan.error);
      const mutations = this.applyMutations(this.combatPlanMutations(plan));
      if (!this.isGameOver && !this.hasPendingRulesWork) mutations.push(...this.givePriorityTo(this.room.activeTurnPlayerId));
      return { success: true, mutations };
    }
    if (choice.continuation.type === 'trigger') {
      const queue = applyTriggerChoice(this.room, choice, answer);
      return { success: true, mutations: this.applyMutations([{ type: 'SET_TRIGGER_QUEUE', queue }, { type: 'SET_PENDING_CHOICE', choice: null }, { type: 'SET_PENDING_TRIGGERS', mutations: [] }]) };
    }
    if (choice.continuation.type === 'resolution') {
      const continuation = applyResolutionChoice(choice, answer);
      return this.commitResolution({ success: true, ...planStackResolution(this.room, continuation.stackObj, continuation, this.effectContext) });
    }
    const continuation = choice.continuation;
    const actionData = applyActionChoice(continuation, answer);
    const room = { ...this.room, pendingChoice: null };
    const preparation = prepareActionChoice(room, playerId, continuation.actionId, actionData, true);
    if (preparation.error) return reject(preparation.error);
    if (preparation.choice) return { success: true, mutations: this.applyMutations([{ type: 'SET_PENDING_CHOICE', choice: this.identifyChoice(preparation.choice) }]) };
    // Validate the complete transaction before clearing a request or paying any cost.
    const validation = ActionRegistry[continuation.actionId]?.validate(room, playerId, actionData);
    if (!validation?.success) return validation ?? reject('No action handler registered');
    const cleared = this.applyMutations([{ type: 'SET_PENDING_CHOICE', choice: null }, { type: 'SET_PENDING_TRIGGERS', mutations: [] }]);
    const result = this.executeCommand(playerId, continuation.actionId, actionData);
    return result.success ? { ...result, mutations: [...cleared, ...result.mutations ?? []] } : result;
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
    if (this.isGameOver) return { success: false, phase: 'validate', reason: 'Game is over' };
    if (this.hasPendingRulesWork) return { success: false, phase: 'validate', reason: 'Rules checkpoint is pending' };
    if (declarationPlayer(this.room) && !this.room.stack.length && actionType !== 'declare_attackers' && actionType !== 'declare_blockers') return { success: false, phase: 'validate', reason: 'Combat declaration is required' };
    // Inject stackUuid if not provided — UUID generation is the engine's responsibility
    const dataWithUuid: ActionData = actionData.stackUuid != null ? actionData : { ...actionData, stackUuid: this.generateUuid() };
    const result = this.actionService.proposeAndStack(this.room, playerId, actionType, dataWithUuid);
    if (!result.success) return result;

    const allApplied: GameMutation[] = [];

    // Apply handler-produced mutations
    allApplied.push(...this.applyMutations([{ type: 'SET_LAST_PASSED', playerId: null }, ...(result.mutations ?? [])]));

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
      ...(declarationPlayer(this.room) && !this.room.stack.length ? [{ type: 'SET_PRIORITY' as const, playerId: null }, { type: 'SET_ENGINE_STATE' as const, state: 'waiting_for_player' as const }] : this.stateMachine.givePriorityTo(this.room.activeTurnPlayerId)),
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
