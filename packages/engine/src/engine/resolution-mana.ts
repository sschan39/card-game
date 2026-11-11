import type { GameRoom } from '../types/game.room.types';
import type { CardInstance } from '../types/card.types';
import type { ActionCost } from '../types/effect.types';
import type { ActionData } from './action-registry';
import type { ListedChoice, PaymentContinuation, PendingChoice, ActionContinuation } from '../types/choice.types';
import { prepareActionChoice } from './action-choices';
import { planActionCosts, planManaActivation } from './action-costs';
import { planCounterCosts } from './counter-costs';
import { manaAbilities, manaOutput } from './mana-abilities';
import { gameReducer } from './game-reducer';
import { CardCharacteristicService } from './card-characteristic-service';
import { ManaPool } from './mana-pool';

/** A read-only planning view: mana abilities may pay a resolution cost without granting real priority. */
export function resolutionPaymentRoom(room: GameRoom, playerId: string): GameRoom {
  return { ...room, priorityPlayerId: playerId };
}

/** Test the complete non-mana inventory using a witness for selections still owned by the player. */
export function canPayNonManaCost(
  room: GameRoom,
  playerId: string,
  source: CardInstance,
  cost: ActionCost,
  data: ActionData,
): boolean {
  const counters = planCounterCosts(room, playerId, source, cost.removeCounters, data.counterPayments, true);
  if (!counters.success) return false;
  const discardUuids = room.players[playerId].hand
    .filter((card) => card.uuid !== source.uuid)
    .slice(0, cost.discard ?? 0)
    .map((card) => card.uuid);
  const selections = {
    ...data,
    manaActivations: undefined,
    counterPayments: counters.payments,
    discardUuids: data.discardUuids ?? discardUuids,
  };
  return planActionCosts(room, playerId, source, { ...cost, mana: {} }, selections).success;
}

/** Replay selected mana abilities in a planning copy, asking their ordinary cost choices when needed. */
export function prepareResolutionMana(
  room: GameRoom,
  saved: PaymentContinuation,
): { success: false; reason: string } | { success: true; working: GameRoom; pendingChoice?: ListedChoice } {
  let working = resolutionPaymentRoom(room, saved.stackObj.controllerId);
  const activations = saved.paymentData.manaActivations ?? [];
  if (!Array.isArray(activations) || activations.length > 128) {
    return { success: false, reason: 'Too many mana activations in one payment' };
  }
  for (let index = 0; index < activations.length; index++) {
    const selection = activations[index] as ActionData;
    const prepared = prepareActionChoice(working, saved.stackObj.controllerId, 'tapForMana', selection);
    if (prepared.kind === 'reject') return { success: false, reason: prepared.error };
    if (prepared.kind === 'prompt') {
      const choice = prepared.choice as Exclude<PendingChoice, { kind: 'number' }> & {
        continuation: ActionContinuation;
      };
      return {
        success: true,
        working,
        pendingChoice: {
          ...choice,
          continuation: {
            ...saved,
            paymentStage: 'mana_ability',
            manaActivationIndex: index,
            manaChoice: choice.continuation,
          },
        },
      };
    }
    const payment = planManaActivation(working, saved.stackObj.controllerId, selection);
    if (!payment.success) return payment;
    working = payment.mutations.reduce(gameReducer, working);
  }
  return { success: true, working };
}

/** List real mana abilities whose payment can still leave the parent non-mana cost payable. */
export function manaPaymentOptions(
  working: GameRoom,
  playerId: string,
  source: CardInstance,
  cost: ActionCost,
  data: ActionData,
): ListedChoice['options'] {
  const options: ListedChoice['options'] = [];
  for (const card of working.battlefield) {
    if (CardCharacteristicService.resolveController(working, card) !== playerId) continue;
    for (const { ability } of manaAbilities(card, working)) {
      const output = manaOutput(ability);
      for (const color of output?.colors ?? []) {
        const selection = { cardUuid: card.uuid, abilityId: ability.id, manaColor: color };
        const prepared = prepareActionChoice(working, playerId, 'tapForMana', selection);
        if (prepared.kind === 'reject') continue;
        if (prepared.kind === 'none') {
          const payment = planManaActivation(working, playerId, selection);
          if (!payment.success) continue;
          const after = payment.mutations.reduce(gameReducer, working);
          if (!canPayNonManaCost(after, playerId, source, cost, data)) continue;
        }
        options.push({
          id: `${card.uuid}:${ability.id}:${color}`,
          value: selection,
          label: `${CardCharacteristicService.resolve(working, card).name}: add ${output!.amount} ${color} mana`,
        });
      }
    }
  }
  return options;
}

/** Check the current pool independently of future, explicitly selected mana activations. */
export function hasPaymentMana(room: GameRoom, playerId: string, cost: ActionCost): boolean {
  return ManaPool.canPay(room.players[playerId].mana, cost.mana ?? {});
}
