import { attributeMutations } from './change-cause';
import { captureSourceInformation as captureCauseSource } from './source-information';
import { EventBus, type EventContext } from './event-bus';
import { gameReducer, reduceGameOperation } from './game-reducer';
import { deriveAppliedEvents, sameStateValue, type AppliedMutation } from './applied-events';
import { captureSourceInformation, retainDepartingSource } from './source-information';
import { newTurnHistory, recordRuleEvent } from './turn-history';
import { effectIsActive, roomCards } from './continuous-effect-state';
import { planProposedMutations, UnpaidMaterialCost } from './proposed-events';
import type { PendingChoice } from '../types/choice.types';
import type { GameRoom } from '../types/game.room.types';
import type { GameMutation } from '../types/game-mutation.types';
import type { AppliedEventBatch, BatchCause, CommandContext, ResolutionReport } from '../types/game-event.types';

/** Commits one transaction and publishes its events/history. Never runs checkpoints or commands. */
export class MutationCommitter {
  private eventBatches: AppliedEventBatch[] = [];
  lastBatchId?: string;

  constructor(
    private room: GameRoom,
    private readonly eventBus: EventBus,
    private readonly mutationCollector: GameMutation[],
    private readonly generateUuid: () => string,
    private readonly getCommand: () => CommandContext | undefined,
  ) {}

  get roomState(): GameRoom {
    return this.room;
  }

  drainEventBatches(): AppliedEventBatch[] {
    return this.eventBatches.splice(0);
  }

  clearEventBatches(): void {
    this.eventBatches.length = 0;
  }

  private get isGameOver(): boolean {
    return this.room.status === 'gameOver' || this.room.outcome !== undefined;
  }

  private identifyChoice(choice: PendingChoice): PendingChoice {
    return { ...choice, id: this.generateUuid() };
  }

  /** Finish proposal decisions before committing any part of this transaction. */
  commit(mutations: GameMutation[], cause: BatchCause, resolution?: ResolutionReport): GameMutation[] {
    const command = this.getCommand();
    const object =
      resolution?.stackObj ?? mutations.flatMap((m) => (m.type === 'PUSH_STACK' ? [m.stackObject] : []))[0];
    const id = command?.commandId ?? this.generateUuid();
    let kind: import('../types/change-cause.types').ChangeCause['kind'] = 'rule';
    if (command) kind = 'command';
    if (object) kind = 'effect';
    let source = command?.source;
    let abilityId = command?.abilityId;
    if (object) {
      source = object.sourceInfo ?? captureCauseSource(this.room, object.source);
      if (object.type !== 'spell') abilityId = object.ability?.id;
    }
    const attributed = attributeMutations(
      mutations,
      {
        id,
        rootId: id,
        parentId: cause.parentBatchId,
        kind,
        source,
        abilityId,
        controllerId: object?.controllerId ?? command?.playerId,
        stackUuid: object?.uuid,
      },
      this.room,
    );
    const plan = planProposedMutations(this.room, attributed, {
      simultaneous: cause.kind === 'state-based-action',
      cause,
      resolution,
    });

    // A pending choice suspends the transaction: park the choice and stop.
    if (plan.pendingChoice) {
      return this.commitPreparedMutations(
        [
          { type: 'SET_PENDING_CHOICE', choice: this.identifyChoice(plan.pendingChoice) },
          { type: 'SET_PRIORITY', playerId: null },
          {
            type: 'SET_ENGINE_STATE',
            state: cause.kind === 'state-based-action' ? 'state_based_actions' : 'resolving_stack',
          },
        ],
        cause,
      );
    }

    if (plan.paymentFailed) throw new UnpaidMaterialCost();

    return this.commitPreparedMutations(plan.mutations, cause, resolution);
  }

  /** Apply and publish one complete prepared batch. Settlement belongs to the checkpoint. */
  private commitPreparedMutations(
    mutations: GameMutation[],
    cause: BatchCause,
    resolution?: ResolutionReport,
  ): GameMutation[] {
    const before = this.room;
    const steps: AppliedMutation[] = [];

    for (const proposed of mutations) {
      // Guard: a finished game accepts no further mutations.
      if (this.isGameOver) break;

      const previous = this.room;

      // A simultaneous SBA move needs the pre-batch battlefield card for its snapshot.
      const simultaneous =
        proposed.type === 'MOVE_CARD' && cause.kind === 'state-based-action'
          ? before.battlefield.find((card) => card.uuid === proposed.cardUuid)
          : undefined;

      // Fill in any identifier the caller left blank.
      let mutation: GameMutation = proposed;
      if (proposed.type === 'ADD_DELAYED_TRIGGER' && !proposed.registration.id) {
        mutation = { ...proposed, registration: { ...proposed.registration, id: this.generateUuid() } };
      } else if (proposed.type === 'SET_PENDING_CHOICE' && proposed.choice && !proposed.choice.id) {
        mutation = { ...proposed, choice: this.identifyChoice(proposed.choice) };
      } else if (simultaneous && proposed.type === 'MOVE_CARD') {
        mutation = { ...proposed, sourceSnapshot: captureSourceInformation(before, simultaneous) };
      }

      const outcome = reduceGameOperation(previous, mutation);

      // Guard: a rejected mutation is skipped without aborting the batch.
      if (outcome.status !== 'committed') continue;

      const next = outcome.state;
      this.room = next;
      steps.push({ mutation, before: previous, after: next, events: outcome.events });

      // A departing permanent must be snapshotted into any stack object still queued.
      if (mutation.type === 'MOVE_CARD') {
        const card = previous.battlefield.find((card) => card.uuid === mutation.cardUuid);

        if (card) {
          const snapshot = mutation.sourceSnapshot ?? captureSourceInformation(previous, card);

          for (let index = 0; index < this.mutationCollector.length; index++) {
            const pending = this.mutationCollector[index];

            if (pending.type === 'PUSH_STACK') {
              this.mutationCollector[index] = {
                ...pending,
                stackObject: retainDepartingSource(pending.stackObject, snapshot),
              };
            }
          }
        }
      }

      // Continuous effects whose source left the battlefield are removed.
      if (mutation.type === 'MOVE_CARD')
        for (const entry of next.continuousEffectPool) {
          if (entry.source === mutation.cardUuid && !effectIsActive(roomCards(next), entry))
            this.mutationCollector.push(
              entry.id
                ? { type: 'REMOVE_CONTINUOUS_EFFECT', id: entry.id }
                : { type: 'REMOVE_CONTINUOUS_EFFECT', source: entry.source, dependentOnly: true },
            );
        }
    }

    // Guard: nothing committed and nothing immediate means there is no batch to publish.
    if (!steps.length && !resolution?.stackObj.immediate) return [];

    const batchId = this.generateUuid();
    const eventContexts: EventContext[] = [];
    const events = deriveAppliedEvents(before, this.room, steps, resolution, (eventBefore, eventAfter) => {
      eventContexts.push({ before: eventBefore, after: eventAfter, command: this.getCommand() });
    }).map((event, index) => ({
      ...structuredClone(event),
      batchId,
      eventUuid: batchId + ':' + index,
      commandId: this.getCommand()?.commandId,
    }));

    // Conditions observe event history at their own point in an atomic batch,
    // rather than seeing later instructions or the next turn's history.
    let history = before.turnHistory ?? newTurnHistory(before.turnNumber ?? 1);
    let recorded = false;

    events.forEach((event, index) => {
      const context = eventContexts[index];

      // A turn change inside the batch resets the history baseline.
      if ((context.after.turnNumber ?? 1) !== history.turnNumber) {
        history = context.after.turnHistory ?? newTurnHistory(context.after.turnNumber ?? 1);
      }

      // Ability-use and land-play records are carried over from the committed state.
      if (
        event.eventId === 'MUTATION_APPLIED' &&
        ['RECORD_ABILITY_USE', 'RECORD_LAND_PLAY', 'SET_TURN_HISTORY'].includes(event.payload.mutation.type)
      ) {
        history = {
          ...history,
          uses: context.after.turnHistory?.uses ?? history.uses,
          landPlays: context.after.turnHistory?.landPlays ?? history.landPlays,
        };
      }

      const previousHistory = history;
      history = recordRuleEvent(history, event);
      recorded ||= history !== previousHistory;

      context.before = {
        ...(cause.kind === 'state-based-action' &&
        ['PERMANENT_LEFT', 'PERMANENT_DIED', 'PERMANENT_DESTROYED', 'CREATURE_KILLED'].includes(event.eventId)
          ? before
          : context.before),
        turnHistory: previousHistory,
      };
      context.after = { ...context.after, turnHistory: history };
    });

    // Persist the accumulated history as one extra step when it actually changed.
    if (recorded && !sameStateValue(history, this.room.turnHistory)) {
      const previous = this.room;
      const mutation: GameMutation = { type: 'SET_TURN_HISTORY', history };
      this.room = gameReducer(previous, mutation);

      const step = { mutation, before: previous, after: this.room };
      steps.push(step);

      const event = deriveAppliedEvents(previous, this.room, [step])[0];
      eventContexts.push({ before: previous, after: this.room, command: this.getCommand() });
      events.push({
        ...event,
        batchId,
        eventUuid: batchId + ':' + events.length,
        commandId: this.getCommand()?.commandId,
      });
    }

    const batch: AppliedEventBatch = {
      batchId,
      command: this.getCommand(),
      cause,
      before,
      after: this.room,
      mutations: steps.map((step) => step.mutation),
      events,
    };

    this.eventBatches.push(batch);
    this.lastBatchId = batchId;

    events.forEach((event, index) => {
      const context = eventContexts[index];

      // SBAs happen simultaneously: every departure witnesses the complete
      // batch's history, while retaining battlefield information from before it.
      if (
        cause.kind === 'state-based-action' &&
        ['PERMANENT_LEFT', 'PERMANENT_DIED', 'PERMANENT_DESTROYED', 'CREATURE_KILLED'].includes(event.eventId)
      ) {
        context.after = { ...context.after, turnHistory: this.room.turnHistory };
      }

      this.eventBus.emit(event, context);
    });

    // Discovery happens after the whole batch commits. Newly queued triggers must
    // also retain departures that occurred later than their triggering event.
    for (const step of steps) {
      const mutation = step.mutation;

      if (mutation.type !== 'MOVE_CARD' || mutation.from !== 'battlefield') continue;

      const card = step.before.battlefield.find((card) => card.uuid === mutation.cardUuid);

      if (!card) continue;

      const snapshot = mutation.sourceSnapshot ?? captureSourceInformation(step.before, card);

      for (let index = 0; index < this.mutationCollector.length; index++) {
        const pending = this.mutationCollector[index];

        if (pending.type === 'PUSH_STACK') {
          this.mutationCollector[index] = {
            ...pending,
            stackObject: retainDepartingSource(pending.stackObject, snapshot),
          };
        }
      }
    }

    // A finished game discards anything still queued.
    if (this.isGameOver) this.mutationCollector.length = 0;

    return batch.mutations;
  }
}
