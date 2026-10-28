import { CardCharacteristicService } from './card-characteristic-service';
import type { ActionData } from './action-registry';
import type { ActionCost } from '../types/effect.types';
import type { CardInstance } from '../types/card.types';
import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { GameMutation } from '../types/game-mutation.types';
import { ManaPool } from './mana-pool';
import { manaAbilities, manaOutput } from './mana-abilities';
import { ActionValidator } from './action-validator';
import { gameReducer } from './game-reducer';
import { abilityLimitReached, abilityUseKey } from './turn-history';
import { materializeAnnouncementCost } from './announcement-values';
import { actionCostError } from './cost-composition';
export { actionCostError } from './cost-composition';

type CostPlan = { success: true; mutations: GameMutation[] } | { success: false; reason: string };

const reject = (reason: string): CostPlan => ({ success: false, reason });
const preview = (room: GameRoom, mutations: GameMutation[]) => mutations.reduce(gameReducer, room);

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Plan payment without events, checkpoints or mutation of authoritative state. */
export function planActionCosts(
  room: GameRoom,
  playerId: PlayerId,
  source: CardInstance,
  cost: ActionCost = {},
  selections: ActionData = {},
  reservedCardUuid = source.state.zone === 'hand' ? source.uuid : undefined,
): CostPlan {
  let working = room;
  const mutations: GameMutation[] = [];

  if (selections.manaActivations !== undefined) {
    if (!Array.isArray(selections.manaActivations)) {
      return reject('manaActivations must be an array');
    }

    for (const selection of selections.manaActivations) {
      if (!object(selection) || selection.manaActivations !== undefined) {
        return reject('Invalid mana activation selection');
      }

      const result = planManaActivation(working, playerId, selection, reservedCardUuid);
      if (!result.success) {
        return result;
      }

      mutations.push(...result.mutations);
      working = preview(working, result.mutations);
    }
  }

  const payment = planDirectCost(working, playerId, source, cost, selections, reservedCardUuid);
  if (!payment.success) {
    return payment;
  }

  return {
    success: true,
    mutations: [...mutations, ...payment.mutations],
  };
}

function planDirectCost(
  room: GameRoom,
  playerId: PlayerId,
  source: CardInstance,
  cost: ActionCost,
  selections: ActionData,
  reservedCardUuid?: string,
): CostPlan {
  const error = actionCostError(cost);
  if (error) {
    return reject(error);
  }

  const player = room.players[playerId];
  if (!player || player.life < (cost.life ?? 0)) {
    return reject('Cannot pay life cost');
  }

  const isSourceInHand =
    cost.discardSelf &&
    player.hand.some(
      (card) =>
        card.uuid === source.uuid &&
        card.state.zone === 'hand' &&
        (card.state.zoneRevision ?? 0) === (source.state.zoneRevision ?? 0),
    );
  if (cost.discardSelf && !isSourceInHand) {
    return reject('Cost source is not in your hand');
  }

  const live = room.battlefield.find(
    (card) =>
      card.uuid === source.uuid &&
      CardCharacteristicService.resolveController(room, card) === playerId,
  );
  if (cost.tap || cost.untap || cost.sacrifice) {
    if (!live) {
      return reject('Cost source is not on your battlefield');
    }

    const hasInvalidOrientation =
      (cost.tap && live.state.isTapped) ||
      (cost.untap && !live.state.isTapped);
    if (hasInvalidOrientation) {
      return reject('Cannot pay orientation cost');
    }

    const isCreatureWithSummoningSickness =
      (cost.tap || cost.untap) &&
      CardCharacteristicService.resolveTypes(room, live).includes('Creature') &&
      live.state.summoningSickness &&
      !CardCharacteristicService.resolveKeywords(room, live).includes('Haste');
    if (isCreatureWithSummoningSickness) {
      return reject('Summoning sickness prevents paying this cost');
    }
  }

  const selected = selections.discardUuids ?? [];
  const hasValidDiscardSelection =
    Array.isArray(selected) &&
    selected.length === (cost.discard ?? 0) &&
    !selected.some((uuid) => typeof uuid !== 'string') &&
    new Set(selected).size === selected.length;
  if (!hasValidDiscardSelection) {
    return reject('Select the required cards to discard');
  }

  const discarded = selected.map((uuid) =>
    player.hand.find(
      (card) =>
        card.uuid === uuid &&
        card.uuid !== source.uuid &&
        card.uuid !== reservedCardUuid,
    ),
  );
  if (discarded.some((card) => !card)) {
    return reject('Invalid discard selection');
  }

  const payment = ManaPool.proposePayment(player.mana, cost.mana ?? {}, selections.payment);
  if (!payment) {
    return reject('Invalid mana payment');
  }

  const mutations: GameMutation[] = [];
  if (Object.keys(payment).length) {
    mutations.push({ type: 'SPEND_MANA', playerId, cost: payment });
  }
  if (cost.life) {
    mutations.push({ type: 'SET_LIFE', playerId, amount: player.life - cost.life });
  }
  if (cost.tap) {
    mutations.push({ type: 'TAP_CARD', cardUuid: source.uuid });
  }
  if (cost.untap) {
    mutations.push({ type: 'UNTAP_CARD', cardUuid: source.uuid });
  }
  if (cost.discardSelf) {
    mutations.push({
      type: 'MOVE_CARD',
      cardUuid: source.uuid,
      playerId,
      from: 'hand',
      to: 'graveyard',
      reason: 'discard',
    });
  }
  for (const card of discarded) {
    // The discard selection was validated above, so every card is present here.
    mutations.push({
      type: 'MOVE_CARD',
      cardUuid: card!.uuid,
      playerId: card!.state.ownerId,
      from: 'hand',
      to: 'graveyard',
      reason: 'discard',
    });
  }
  if (cost.sacrifice) {
    mutations.push({
      type: 'SACRIFICE_CARD',
      cardUuid: source.uuid,
      zoneRevision: source.state.zoneRevision ?? 0,
    });
  }

  return { success: true, mutations };
}

/** Immediate mana activation; reusable within a larger payment transaction. */
export function planManaActivation(
  room: GameRoom,
  playerId: PlayerId,
  action: ActionData,
  reservedCardUuid?: string,
): CostPlan {
  const card = room.battlefield.find(
    (candidate) =>
      candidate.uuid === action.cardUuid &&
      CardCharacteristicService.resolveController(room, candidate) === playerId,
  );
  if (!card) {
    return reject('Card not found on your battlefield');
  }

  const candidates = manaAbilities(card, room);
  let selected;
  if (action.abilityId !== undefined) {
    selected = candidates.find(
      (entry) => entry.ability.id === action.abilityId,
    );
  } else if (action.abilityIndex === undefined && candidates.length === 1) {
    selected = candidates[0];
  } else {
    selected = candidates.find(
      (entry) => entry.abilityIndex === action.abilityIndex,
    );
  }
  if (!selected) {
    return reject('Select a valid mana ability');
  }

  const { ability } = selected;
  if (abilityLimitReached(room, card, ability)) {
    return reject('Ability use limit reached for this turn');
  }

  const output = manaOutput(ability);
  if (!output) {
    return reject('Invalid mana output');
  }

  const color =
    action.manaColor ??
    (output.colors.length === 1 ? output.colors[0] : undefined);
  if (!output.colors.includes(color as (typeof output.colors)[number])) {
    return reject('Select a valid mana color');
  }

  const valid = ActionValidator.canActivate(
    room,
    playerId,
    card,
    { allowedZones: ['battlefield'], speed: ability.castSpeed },
    'activate',
    ability.id,
  );
  if (!valid.valid) {
    return reject(valid.reason ?? 'Cannot activate mana ability');
  }
  if (ability.numericDeclarations?.length) {
    return reject('Mana abilities cannot declare numeric bindings');
  }

  const hasCostRoute =
    ability.alternativeCosts !== undefined ||
    ability.additionalCost !== undefined ||
    action.costRoute !== undefined;
  if (hasCostRoute) {
    return reject('Mana abilities do not support cost routes');
  }

  let cost: ActionCost;
  try {
    cost = materializeAnnouncementCost(ability.cost);
  } catch {
    return reject('Invalid mana ability cost');
  }

  const costs = planActionCosts(room, playerId, card, cost, action, reservedCardUuid);
  if (!costs.success) {
    return costs;
  }

  const after = preview(room, costs.mutations);
  const manaColor = color as (typeof output.colors)[number];
  const resultingMana =
    after.players[playerId].mana[manaColor] + output.amount;
  if (!Number.isSafeInteger(resultingMana)) {
    return reject('Mana output exceeds the pool limit');
  }

  return {
    success: true,
    mutations: [
      ...costs.mutations,
      {
        type: 'ADD_MANA',
        playerId,
        color: manaColor,
        amount: output.amount,
      },
      {
        type: 'RECORD_ABILITY_USE',
        key: abilityUseKey(card, ability.id ?? ''),
      },
    ],
  };
}
