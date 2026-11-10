import { planMaterialPayment } from './material-costs';
import { planCounterCosts } from './counter-costs';
import { attributeMutations } from './change-cause';
import { captureSourceInformation } from './source-information';
import { CardCharacteristicService } from './card-characteristic-service';
import type { ActionData } from './action-registry';
import type { ManaSubstitution } from '../types/continuous-effect.types';
import type { ActionCost } from '../types/effect.types';
import type { CardInstance } from '../types/card.types';
import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { GameMutation } from '../types/game-mutation.types';
import { ManaPool } from './mana-pool';
import { manaAbilities, manaOutput } from './mana-abilities';
import { ActionValidator } from './action-validator';
import { gameReducer } from './game-reducer';
import { recordAbilityCommit } from './ability-usage';
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
  substitution?: ManaSubstitution,
): CostPlan {
  let working = room;
  const mutations: GameMutation[] = [];

  // Mana abilities are activated first so their output can pay the direct cost.
  if (selections.manaActivations !== undefined) {
    // Guard: the selection must be a list.
    if (!Array.isArray(selections.manaActivations)) {
      return reject('manaActivations must be an array');
    }

    for (const selection of selections.manaActivations) {
      // Guard: no nested activations and no non-object entries.
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

  const payment = planDirectCost(working, playerId, source, cost, selections, reservedCardUuid, substitution);

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
  substitution?: ManaSubstitution,
): CostPlan {
  // Guard: the cost itself must be well formed.
  const error = actionCostError(cost);

  if (error) {
    return reject(error);
  }

  // Guard: the player must exist and be able to pay the life cost.
  const player = room.players[playerId];

  if (!player || player.life < (cost.life ?? 0)) {
    return reject('Cannot pay life cost');
  }

  // Guard: a discard-self cost requires the source to still be in hand at the same revision.
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
      CardCharacteristicService.resolveController(room, card) === playerId &&
      (card.state.zoneRevision ?? 0) === (source.state.zoneRevision ?? 0),
  );

  // Orientation and sacrifice costs need the source on the battlefield.
  if (cost.tap || cost.untap || cost.sacrifice) {
    // Guard: the source must be a permanent you control.
    if (!live) {
      return reject('Cost source is not on your battlefield');
    }

    // Guard: the permanent must be in the orientation the cost expects.
    const hasInvalidOrientation = (cost.tap && live.state.isTapped) || (cost.untap && !live.state.isTapped);

    if (hasInvalidOrientation) {
      return reject('Cannot pay orientation cost');
    }

    // Guard: summoning sickness blocks tap/untap costs unless the creature has haste.
    const isCreatureWithSummoningSickness =
      (cost.tap || cost.untap) &&
      CardCharacteristicService.resolveTypes(room, live).includes('Creature') &&
      live.state.summoningSickness &&
      !CardCharacteristicService.resolveKeywords(room, live).includes('Haste');

    if (isCreatureWithSummoningSickness) {
      return reject('Summoning sickness prevents paying this cost');
    }
  }

  // Guard: the discard selection must be a distinct list of the exact required size.
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
    player.hand.find((card) => card.uuid === uuid && card.uuid !== source.uuid && card.uuid !== reservedCardUuid),
  );

  // Guard: every selected card must still be in hand.
  if (discarded.some((card) => !card)) {
    return reject('Invalid discard selection');
  }

  const payment = ManaPool.proposePayment(player.mana, cost.mana ?? {}, selections.payment, substitution);

  // Guard: the mana payment must be payable from the current pool.
  if (!payment) {
    return reject('Invalid mana payment');
  }

  const counters = planCounterCosts(room, playerId, source, cost.removeCounters, selections.counterPayments);
  if (!counters.success) return counters;
  const mutations: GameMutation[] = [...counters.mutations];

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
      playerId,
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

  if (cost.destroyMaterials) {
    const working = preview(room, mutations);
    const materials = planMaterialPayment(working, playerId, cost.destroyMaterials, selections.materialPayments);
    if (!materials.success) return materials;
    mutations.push(...materials.mutations);
  } else if (selections.materialPayments !== undefined) {
    return reject('This action does not require materials');
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
      candidate.uuid === action.cardUuid && CardCharacteristicService.resolveController(room, candidate) === playerId,
  );

  // Guard: the source must be a permanent you control.
  if (!card) {
    return reject('Card not found on your battlefield');
  }

  const candidates = manaAbilities(card, room);
  let selected;

  // Prefer an explicit ability id, then a lone ability, then an index.
  if (action.abilityId !== undefined) {
    selected = candidates.find((entry) => entry.ability.id === action.abilityId);
  } else if (action.abilityIndex === undefined && candidates.length === 1) {
    selected = candidates[0];
  } else {
    selected = candidates.find((entry) => entry.abilityIndex === action.abilityIndex);
  }

  // Guard: the selection must resolve to a real mana ability.
  if (!selected) {
    return reject('Select a valid mana ability');
  }

  const { ability } = selected;

  // Guard: the per-turn use limit must not be exhausted.
  if (abilityLimitReached(room, card, ability)) {
    return reject('Ability use limit reached');
  }

  const output = manaOutput(ability);

  // Guard: the ability must produce mana.
  if (!output) {
    return reject('Invalid mana output');
  }

  // A single-colour ability needs no explicit colour choice.
  const color = action.manaColor ?? (output.colors.length === 1 ? output.colors[0] : undefined);

  // Guard: the chosen colour must be one the ability can produce.
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

  // Guard: the activation must be legal in the current state.
  if (!valid.valid) {
    return reject(valid.reason);
  }

  // Guard: mana abilities cannot declare numeric bindings.
  if (ability.numericDeclarations?.length) {
    return reject('Mana abilities cannot declare numeric bindings');
  }

  // Guard: mana abilities cannot use alternative or additional cost routes.
  const hasCostRoute =
    ability.alternativeCosts !== undefined || ability.additionalCost !== undefined || action.costRoute !== undefined;

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
  const resultingMana = after.players[playerId].mana[manaColor] + output.amount;

  // Guard: the pool must stay within safe integer range.
  if (!Number.isSafeInteger(resultingMana)) {
    return reject('Mana output exceeds the pool limit');
  }

  const useKey = abilityUseKey(card, ability.id ?? '');
  const causeId = `mana:${useKey}:${room.turnNumber ?? 0}:${room.turnHistory?.uses[useKey] ?? 0}`;
  return {
    success: true,
    mutations: attributeMutations(
      [
        ...costs.mutations,
        {
          type: 'ADD_MANA',
          playerId,
          color: manaColor,
          amount: output.amount,
        },
        ...recordAbilityCommit(room, card, ability, playerId),
      ],
      {
        id: causeId,
        rootId: causeId,
        kind: 'effect',
        controllerId: playerId,
        source: captureSourceInformation(room, card),
        abilityId: ability.id,
      },
      room,
    ),
  };
}
