import { applyActionChoice } from './action-choices';
import { attributeMutations, effectCause } from './change-cause';
import {
  resolutionPaymentRoom,
  canPayNonManaCost,
  prepareResolutionMana,
  manaPaymentOptions,
  hasPaymentMana,
} from './resolution-mana';
import type { ActionData } from './action-registry';
import type { ActionCost, EffectDefinition, StackObject, StackEffect } from '../types/effect.types';
import type { CardInstance } from '../types/card.types';
import type { GameRoom } from '../types/game.room.types';
import type { GameMutation } from '../types/game-mutation.types';
import type { ChoiceAnswer, ListedChoice, PaymentContinuation, ResolutionContinuation } from '../types/choice.types';
import { planActionCosts } from './action-costs';
import { planCounterCosts, counterPaymentAnswer, counterPaymentOptions } from './counter-costs';
import { materializeAnnouncementCost } from './announcement-values';
import { resolveSourceInformation } from './source-information';
import { buildStackEffects } from './resolution-planning';
import { describeActionCost } from '../shared/action-cost-description';

export type ResolutionPaymentPlan =
  | { success: false; reason: string }
  | { success: true; pendingChoice: ListedChoice }
  | { success: true; continuation: ResolutionContinuation; mutations: GameMutation[] };

function paymentCost(saved: PaymentContinuation): ActionCost {
  const object = saved.stackObj;
  const effect = object.effects[saved.effectIndex];
  const bindings = 'numericBindings' in object ? object.numericBindings : {};
  return materializeAnnouncementCost(effect.params.cost as ActionCost, bindings);
}

function request(
  saved: PaymentContinuation,
  choice: Omit<ListedChoice, 'id' | 'playerId' | 'continuation'>,
): ResolutionPaymentPlan {
  return {
    success: true,
    pendingChoice: {
      ...choice,
      id: '',
      playerId: saved.stackObj.controllerId,
      continuation: saved,
    },
  };
}

function finish(saved: PaymentContinuation, paid: boolean, mutations: GameMutation[] = []): ResolutionPaymentPlan {
  const effect = saved.stackObj.effects[saved.effectIndex];
  const definitions = effect.params.then as EffectDefinition[];
  let branch: StackEffect[] = [];
  if (paid) {
    branch = buildStackEffects(definitions, saved.stackObj.controllerId, saved.stackObj.source).map((child, index) => ({
      ...child,
      instructionId: `${effect.instructionId ?? saved.effectIndex}:paid:${index}`,
    }));
  }
  const effects = [...saved.stackObj.effects];
  effects.splice(saved.effectIndex, 1, ...branch);
  return {
    success: true,
    mutations,
    continuation: {
      type: 'resolution',
      effectIndex: saved.effectIndex,
      results: [...saved.results, { effectId: 'PAY_COST', fizzled: false }],
      stackObj: { ...saved.stackObj, effects },
    },
  };
}

/** Offer payment when payable now or when a supported mana ability may fund it. */
export function offerResolutionPayment(
  room: GameRoom,
  stackObj: StackObject,
  effectIndex: number,
  results: ResolutionContinuation['results'],
): ResolutionPaymentPlan {
  const saved: PaymentContinuation = {
    type: 'resolution',
    stackObj,
    effectIndex,
    results,
    paymentStage: 'confirm',
    paymentData: {},
  };
  const source = resolveSourceInformation(room, stackObj).card;
  const cost = paymentCost(saved);
  const paymentRoom = resolutionPaymentRoom(room, stackObj.controllerId);
  const payableNow =
    canPayNonManaCost(paymentRoom, stackObj.controllerId, source, cost, {}) &&
    hasPaymentMana(paymentRoom, stackObj.controllerId, cost);
  if (!payableNow && manaPaymentOptions(paymentRoom, stackObj.controllerId, source, cost, {}).length === 0) {
    return finish(saved, false);
  }
  const effect = stackObj.effects[effectIndex];
  const prompt = typeof effect.params.prompt === 'string' ? effect.params.prompt : `Pay ${describeActionCost(cost)}?`;
  return request(saved, {
    kind: 'optional',
    prompt,
    min: 1,
    max: 1,
    options: [
      { id: 'yes', label: 'Pay', value: true },
      { id: 'no', label: 'Decline', value: false },
    ],
  });
}

/** Resume a server-owned decision; no payment commits until every selection has been validated. */
export function answerResolutionPayment(
  room: GameRoom,
  saved: PaymentContinuation,
  answer?: ChoiceAnswer,
  cancel = false,
): ResolutionPaymentPlan {
  if (cancel || (saved.paymentStage === 'confirm' && answer?.values[0] !== true)) return finish(saved, false);
  const data = { ...saved.paymentData };
  if (saved.paymentStage === 'counters') {
    data.counterPayments = {
      ...(data.counterPayments as object),
      [saved.counterCostIndex!]: counterPaymentAnswer(answer!),
    };
  }
  if (saved.paymentStage === 'discard') data.discardUuids = answer!.values;
  if (saved.paymentStage === 'mana_sources') {
    const selections = (data.manaActivations as ActionData[] | undefined) ?? [];
    data.manaActivations = [...selections, answer!.values[0] as ActionData];
  }
  if (saved.paymentStage === 'mana_ability') {
    const selections = data.manaActivations as ActionData[];
    data.manaActivations = selections.map((entry, index) =>
      index === saved.manaActivationIndex ? applyActionChoice(saved.manaChoice!, answer!) : entry,
    );
  }
  const next = { ...saved, paymentData: data };
  const source = resolveSourceInformation(room, saved.stackObj).card;
  const cost = paymentCost(saved);
  const playerId = saved.stackObj.controllerId;
  const mana = prepareResolutionMana(room, next);
  if (!mana.success) return mana;
  if (mana.pendingChoice) return { success: true, pendingChoice: mana.pendingChoice };
  const working = mana.working;
  const nonManaReady = canPayNonManaCost(working, playerId, source, cost, data);
  if (!nonManaReady || !hasPaymentMana(working, playerId, cost)) {
    const options = manaPaymentOptions(working, playerId, source, cost, data);
    if (!options.length) return { success: false, reason: 'No available mana source can complete this payment' };
    return request(
      { ...next, paymentStage: 'mana_sources' },
      {
        kind: 'options',
        prompt: 'Choose a mana source for this payment',
        options,
        min: 1,
        max: 1,
      },
    );
  }
  const counters = planCounterCosts(working, playerId, source, cost.removeCounters, data.counterPayments, true);
  // Unreachable: the identical planCounterCosts call inside canPayNonManaCost
  // already proved this exact payment feasible.
  const selected = (data.counterPayments ?? {}) as Record<string, unknown>;
  const index = cost.removeCounters?.findIndex(
    (entry, number) => entry.from === 'battlefield' && !Object.prototype.hasOwnProperty.call(selected, number),
  );
  if (index !== undefined && index >= 0) {
    const entry = cost.removeCounters![index];
    return request(
      { ...next, paymentStage: 'counters', counterCostIndex: index },
      {
        kind: 'distribution',
        prompt: `Remove ${entry.amount} ${entry.counterType} counters to pay`,
        options: counterPaymentOptions(working, playerId, source, entry, {
          costs: cost.removeCounters!,
          payments: data.counterPayments,
          index,
        }),
        min: 0,
        max: room.battlefield.length,
        total: entry.amount,
        minimumPerOption: 0,
      },
    );
  }
  if (cost.discard && data.discardUuids === undefined) {
    return request(
      { ...next, paymentStage: 'discard' },
      {
        kind: 'discard',
        prompt: 'Choose cards to discard as payment',
        min: cost.discard,
        max: cost.discard,
        options: working.players[playerId].hand
          .filter((card) => card.uuid !== source.uuid)
          .map((card) => ({ id: card.uuid, label: card.blueprint.name, value: card.uuid })),
      },
    );
  }
  const paymentRoom = resolutionPaymentRoom(room, playerId);
  const payment = planActionCosts(paymentRoom, playerId, source, cost, data);
  if (!payment.success) return payment;
  const cause = effectCause(room, saved.stackObj, saved.stackObj.effects[saved.effectIndex]);
  return finish(next, true, attributeMutations(payment.mutations, cause, room));
}
