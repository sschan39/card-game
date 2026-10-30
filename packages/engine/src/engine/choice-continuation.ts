import type { ActionData, ActionResult } from './action-registry';
import { gameReducer } from './game-reducer';
import { validateChoiceAnswer } from './choices';
import { applyResolutionChoice } from './resolution-choices';
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
import { settleOutcome } from './resolution-outcomes';

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
  if (choice.playerId !== playerId) return reject('This choice belongs to another player');
  if (data.choiceId !== choice.id) return reject('Choice request is stale');
  if (data.cancel === true && choice.continuation.type === 'action') return { success: true, mutations: host.applyMutations([{ type: 'SET_PENDING_CHOICE', choice: null }, { type: 'SET_PENDING_TRIGGERS', mutations: [] }]) };
  const answer = validateChoiceAnswer(choice, data);
  if (!answer) return reject('Invalid choice answer');
  if (choice.continuation.type === 'state_based') {
    let plan: ReturnType<typeof answerStateBasedChoice>;
    try { plan = answerStateBasedChoice(host.room, choice, answer); }
    catch (error) { return reject(error instanceof Error ? error.message : 'Invalid state-based decision'); }
    if (plan.pendingChoice) return { success: true, mutations: host.applyMutations([{ type: 'SET_PENDING_CHOICE', choice: host.identifyChoice(plan.pendingChoice) }]) };
    const mutations = host.applyMutations([{ type: 'SET_PENDING_CHOICE', choice: null }, { type: 'SET_PENDING_TRIGGERS', mutations: [] }, ...plan.mutations], undefined, { kind: 'state-based-action' });
    if (!host.isGameOver && !host.hasPendingRulesWork && choice.continuation.batch.resumePriority) mutations.push(...host.givePriorityTo(choice.continuation.batch.resumePriority));
    return { success: true, mutations };
  }
  if (choice.continuation.type === 'replacement') {
    const saved = choice.continuation;
    const transaction = saved.parents?.slice(-1)[0] ?? saved.transaction;
    let plan: ReturnType<typeof resumeProposedChoice>;
    try { plan = resumeProposedChoice(host.room, choice, answer); }
    catch (error) { return reject(error instanceof Error ? error.message : 'Invalid replacement decision'); }
    if (plan.pendingChoice) return { success: true, mutations: host.applyMutations([{ type: 'SET_PENDING_CHOICE', choice: host.identifyChoice(plan.pendingChoice) }]) };
    const completed: GameMutation[] = [{ type: 'SET_PENDING_CHOICE', choice: null }, { type: 'SET_PENDING_TRIGGERS', mutations: [] }, ...plan.mutations];
    if (saved.afterResolution) {
      const room = completed.reduce(gameReducer, host.room);
      const continuation = { ...saved.afterResolution, stackObj: settleOutcome(host.room, saved.afterResolution.stackObj, saved.afterResolution.outcomeProbe, completed), outcomeProbe: undefined };
      const next = planStackResolution(room, continuation.stackObj, continuation, host.effectContext);
      return host.commitResolution({ success: true, ...next, mutations: [...completed, ...next.mutations] });
    }
    const mutations = host.applyMutations(completed, transaction.resolution, transaction.cause);
    if (!host.isGameOver && !host.hasPendingRulesWork) mutations.push(...(transaction.resumePriority
      ? host.givePriorityTo(transaction.resumePriority) : host.applyMutations([{ type: 'SET_ENGINE_STATE', state: 'waiting_for_player' }])));
    return { success: true, mutations };
  }
  if (choice.continuation.type === 'combat') {
    const plan = answerCombatDamage(host.room, choice, answer);
    if (plan.kind === 'reject') return reject(plan.error);
    const mutations = host.applyMutations(host.combatPlanMutations(plan));
    if (!host.isGameOver && !host.hasPendingRulesWork) mutations.push(...host.givePriorityTo(host.room.activeTurnPlayerId));
    return { success: true, mutations };
  }
  if (choice.continuation.type === 'trigger') {
    const queue = applyTriggerChoice(host.room, choice, answer);
    return { success: true, mutations: host.applyMutations([{ type: 'SET_TRIGGER_QUEUE', queue }, { type: 'SET_PENDING_CHOICE', choice: null }, { type: 'SET_PENDING_TRIGGERS', mutations: [] }]) };
  }
  if (choice.continuation.type === 'resolution') {
    const continuation = applyResolutionChoice(choice, answer);
    return host.commitResolution({ success: true, ...planStackResolution(host.room, continuation.stackObj, continuation, host.effectContext) });
  }
  return host.resumeActionChoice(playerId, choice.continuation, answer);
}
