import type { ActionData, ActionResult } from './action-registry';
import { capturedChoiceAllowed } from './captured-windows';
import { gameReducer } from './game-reducer';
import { validateChoiceAnswer } from './choices';
import { applyResolutionChoice, planResolutionOptionUses } from './resolution-choices';
import { planStackResolution } from './effect-resolver';
import { applyTriggerChoice } from './trigger-scheduler';
import { answerCombatDamage, type CombatPlan } from './combat-service';
import { resumeProposedChoice } from './proposed-events';
import { answerStateBasedChoice } from './state-based-planner';
import type { EffectContext } from './effect-context';
import type { ActionContinuation, ChoiceAnswer, PendingChoice } from '../types/choice.types';
import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { GameMutation } from '../types/game-mutation.types';
import type { BatchCause, ResolutionReport } from '../types/game-event.types';
import { answerResolutionPayment } from './resolution-payments';
import type { PaymentContinuation } from '../types/choice.types';
import { settleOutcome } from './resolution-outcomes';
import { settleCardResult } from './resolution-results';

/** Existing rule planners own each decision; these callbacks only commit/resume their results. */
interface ChoiceHost {
  readonly room: GameRoom;
  readonly isGameOver: boolean;
  readonly hasPendingRulesWork: boolean;
  readonly effectContext: EffectContext;
  applyMutations(mutations: GameMutation[], resolution?: ResolutionReport, cause?: BatchCause): GameMutation[];
  identifyChoice(choice: PendingChoice): PendingChoice;
  givePriorityTo(playerId: PlayerId): GameMutation[];
  combatPlanMutations(plan: Exclude<CombatPlan, { kind: 'reject' }>): GameMutation[];
  commitResolution(result: Extract<ActionResult, { success: true }>): ActionResult;
  resumeActionChoice(playerId: PlayerId, continuation: ActionContinuation, answer: ChoiceAnswer): ActionResult;
}

/** Dispatch one already room-owned pending request. No general action routing. */
export function answerPendingChoice(host: ChoiceHost, playerId: PlayerId, data: ActionData): ActionResult {
  const choice = host.room.pendingChoice!;
  const reject = (reason: string): ActionResult => ({ success: false, phase: 'validate', reason });

  // Guard: the choice must belong to this player and still be current.
  if (choice.playerId !== playerId) return reject('This choice belongs to another player');
  if (data.choiceId !== choice.id) return reject('Choice request is stale');
  if (!capturedChoiceAllowed(host.room, choice)) return reject('Captured card access is no longer available');

  if (choice.continuation.type === 'resolution' && 'paymentStage' in choice.continuation) {
    const answer = data.cancel === true ? undefined : validateChoiceAnswer(choice, data);
    if (!answer && data.cancel !== true) return reject('Invalid payment choice');
    const payment = answerResolutionPayment(
      host.room,
      choice.continuation as PaymentContinuation,
      answer,
      data.cancel === true,
    );
    if (!payment.success) return reject(payment.reason);
    if ('pendingChoice' in payment) {
      return host.commitResolution({ success: true, mutations: [], pendingChoice: payment.pendingChoice });
    }
    const room = payment.mutations.reduce(gameReducer, host.room);
    const next = planStackResolution(room, payment.continuation.stackObj, payment.continuation, host.effectContext);
    return host.commitResolution({ success: true, ...next, mutations: [...payment.mutations, ...next.mutations] });
  }

  // Cancelling an action choice clears the pending state without resolving.
  if (data.cancel === true && choice.continuation.type === 'action') {
    return {
      success: true,
      mutations: host.applyMutations([
        { type: 'SET_PENDING_CHOICE', choice: null },
        { type: 'SET_PENDING_TRIGGERS', mutations: [] },
      ]),
    };
  }

  const answer = validateChoiceAnswer(choice, data);
  if (!answer) return reject('Invalid choice answer');

  if (choice.continuation.type === 'state_based') {
    let plan: ReturnType<typeof answerStateBasedChoice>;

    try {
      plan = answerStateBasedChoice(host.room, choice, answer);
    } catch (error) {
      return reject(error instanceof Error ? error.message : 'Invalid state-based decision');
    }

    // Another decision is needed before the batch can commit.
    if (plan.pendingChoice) {
      return {
        success: true,
        mutations: host.applyMutations([
          {
            type: 'SET_PENDING_CHOICE',
            choice: host.identifyChoice(plan.pendingChoice),
          },
        ]),
      };
    }

    const mutations = host.applyMutations(
      [
        { type: 'SET_PENDING_CHOICE', choice: null },
        { type: 'SET_PENDING_TRIGGERS', mutations: [] },
        ...plan.mutations,
      ],
      undefined,
      { kind: 'state-based-action' },
    );

    // Hand priority back once the rules work has settled.
    if (!host.isGameOver && !host.hasPendingRulesWork && choice.continuation.batch.resumePriority) {
      mutations.push(...host.givePriorityTo(choice.continuation.batch.resumePriority));
    }

    return { success: true, mutations };
  }

  if (choice.continuation.type === 'replacement') {
    const saved = choice.continuation;
    const transaction = saved.parents?.slice(-1)[0] ?? saved.transaction;

    let plan: ReturnType<typeof resumeProposedChoice>;

    try {
      plan = resumeProposedChoice(host.room, choice, answer);
    } catch (error) {
      return reject(error instanceof Error ? error.message : 'Invalid replacement decision');
    }

    if (plan.pendingChoice) {
      return {
        success: true,
        mutations: host.applyMutations([
          {
            type: 'SET_PENDING_CHOICE',
            choice: host.identifyChoice(plan.pendingChoice),
          },
        ]),
      };
    }

    const completed: GameMutation[] = [
      { type: 'SET_PENDING_CHOICE', choice: null },
      { type: 'SET_PENDING_TRIGGERS', mutations: [] },
      ...plan.mutations,
    ];

    // A replacement that interrupted a resolution resumes that resolution.
    if (saved.afterResolution) {
      const room = completed.reduce(gameReducer, host.room);
      const object = settleOutcome(
        host.room,
        saved.afterResolution.stackObj,
        saved.afterResolution.outcomeProbe,
        completed,
      );
      const continuation = {
        ...saved.afterResolution,
        stackObj: settleCardResult(host.room, object, saved.afterResolution.cardResultProbe, completed),
        outcomeProbe: undefined,
        cardResultProbe: undefined,
      };
      const next = planStackResolution(room, continuation.stackObj, continuation, host.effectContext);

      return host.commitResolution({ success: true, ...next, mutations: [...completed, ...next.mutations] });
    }

    const mutations = host.applyMutations(completed, transaction.resolution, transaction.cause);

    if (!host.isGameOver && !host.hasPendingRulesWork) {
      mutations.push(
        ...(transaction.resumePriority
          ? host.givePriorityTo(transaction.resumePriority)
          : host.applyMutations([{ type: 'SET_ENGINE_STATE', state: 'waiting_for_player' }])),
      );
    }

    return { success: true, mutations };
  }

  if (choice.continuation.type === 'combat') {
    const plan = answerCombatDamage(host.room, choice, answer);
    if (plan.kind === 'reject') return reject(plan.error);

    const mutations = host.applyMutations(host.combatPlanMutations(plan));

    if (!host.isGameOver && !host.hasPendingRulesWork) {
      mutations.push(...host.givePriorityTo(host.room.activeTurnPlayerId));
    }

    return { success: true, mutations };
  }

  if (choice.continuation.type === 'trigger') {
    const queue = applyTriggerChoice(host.room, choice, answer);
    if (!queue) return reject('Select trigger modes with legal required targets');

    return {
      success: true,
      mutations: host.applyMutations([
        { type: 'SET_TRIGGER_QUEUE', queue },
        { type: 'SET_PENDING_CHOICE', choice: null },
        { type: 'SET_PENDING_TRIGGERS', mutations: [] },
      ]),
    };
  }

  if (choice.continuation.type === 'resolution') {
    const uses = planResolutionOptionUses(host.room, choice, answer);
    if (!uses) return reject('A selected option is no longer available');
    const room = uses.reduce(gameReducer, host.room);
    const continuation = applyResolutionChoice(room, choice, answer);
    const next = planStackResolution(room, continuation.stackObj, continuation, host.effectContext);
    return host.commitResolution({ success: true, ...next, mutations: [...uses, ...next.mutations] });
  }

  return host.resumeActionChoice(playerId, choice.continuation, answer);
}
