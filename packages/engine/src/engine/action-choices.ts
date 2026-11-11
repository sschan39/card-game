import { materialPaymentOptions, planMaterialPayment } from './material-costs';
import { planCounterCosts, counterPaymentOptions, counterPaymentAnswer } from './counter-costs';
import { CardCharacteristicService } from './card-characteristic-service';
import { abilityEffects } from './ability-effects';
import { findActivationSource } from './activation-source';
import type { GameRoom } from '../types/game.room.types';
import type { ActionData } from './action-registry';
import type { PendingChoice, ListedChoice, ActionContinuation, ChoiceAnswer } from '../types/choice.types';
import type { ActivatedAbility } from '../types/card.types';
import { ActionValidator } from './action-validator';
import { describeTargetGroups, isExplicitTargeting, targetKey } from '../shared/target-legality';
import { selectModeEffects } from '../shared/action-modes';
import { isActionTimingAllowed } from '../shared/turn-utils';
import { targetOptions, choiceCanComplete } from './choices';
import { MANA_COLORS } from '../types/card.types';
import { manaAbilities } from './mana-abilities';
import { actionCostError, planManaActivation } from './action-costs';
import { gameReducer } from './game-reducer';
import { planTargetGroups } from './target-groups';
import { buildStackEffects } from './resolution-planning';
import { abilityLimitReached } from './turn-history';
import {
  prepareAnnouncement,
  spellAnnouncementDefinition,
  abilityAnnouncementDefinition,
  materializeAnnouncementCost,
} from './announcement-values';
import { composeActionCosts } from './cost-composition';
import { describeActionCost } from '../shared/action-cost-description';

type TargetLabelSource = {
  targetType: string;
  playerId?: string;
  cardUuid?: string;
  stackUuid?: string;
};

function targetLabel(target: TargetLabelSource): string {
  return targetKey(target as never).split(':').slice(1).join(':');
}

/**
 * Outcome of preparing an action's choices. Exactly one of three states, and the
 * discriminant makes each one impossible to confuse with the others:
 * - `prompt` — the engine must ask the player something before continuing.
 * - `reject` — the action is rejected; the message is player-visible.
 * - `none`   — nothing to ask and nothing wrong; the caller proceeds to the
 *              registered handler, which owns its own validation messages.
 */
export type ActionChoicePreparation =
  | { kind: 'prompt'; choice: PendingChoice }
  | { kind: 'reject'; error: string }
  | { kind: 'none' };

/**
 * No prompt is needed: the action has no choice phase, or every choice it needs
 * is already supplied. This is NOT a rejection — rejections use `reject()`.
 */
const NO_CHOICE: ActionChoicePreparation = { kind: 'none' };

/** Reject the action with a player-visible reason. */
const reject = (error: string): ActionChoicePreparation => ({ kind: 'reject', error });

/** Ask the player something before the action can continue. */
const prompt = (choice: PendingChoice): ActionChoicePreparation => ({ kind: 'prompt', choice });

/** Missing selections open prompts; supplied invalid selections still reject normally. */
export function prepareActionChoice(
  room: GameRoom,
  playerId: string,
  actionId: string,
  data: ActionData,
  continuing = false,
): ActionChoicePreparation {
  // Actions outside this list have no choice phase; their handlers validate them.
  const supportedActions = ['cast_spell', 'activate_ability', 'tapForMana'];

  if (!supportedActions.includes(actionId)) {
    return NO_CHOICE;
  }

  const card =
    actionId === 'cast_spell'
      ? room.players[playerId].hand.find((candidate) => candidate.uuid === data.cardUuid)
      : findActivationSource(room, playerId, data.cardUuid);

  // Guard: the handler owns the "card not found" message; it knows the zone rules.
  if (!card) {
    return NO_CHOICE;
  }

  const isLandSpell = actionId === 'cast_spell' && CardCharacteristicService.resolveTypes(room, card).includes('Land');

  // Guard: a land is played, never cast.
  if (isLandSpell) {
    return reject('Lands are played directly, not cast as spells');
  }

  const candidates = manaAbilities(card, room);
  let ability = undefined;

  if (actionId === 'activate_ability') {
    ability = CardCharacteristicService.resolveAbilities(room, card).find(
      (candidate) => candidate.id === data.abilityId,
    );
  } else if (actionId === 'tapForMana') {
    // A mana ability is selected by id, then by index, then by being the only one.
    let selectedManaAbility;
    if (data.abilityId !== undefined) {
      selectedManaAbility = candidates.find((candidate) => candidate.ability.id === data.abilityId);
    } else if (data.abilityIndex !== undefined) {
      selectedManaAbility = candidates.find((candidate) => candidate.abilityIndex === data.abilityIndex);
    } else if (candidates.length === 1) {
      selectedManaAbility = candidates[0];
    }

    ability = selectedManaAbility?.ability;
  }

  // Guard: not an activated ability, so no announcement, mode or target prompts apply.
  if (actionId !== 'cast_spell' && (!ability || ability.type !== 'activated')) {
    return NO_CHOICE;
  }

  // Guard: a per-turn ability limit blocks the action outright.
  if (ability?.type === 'activated' && abilityLimitReached(room, card, ability)) {
    return reject('Ability use limit reached');
  }

  const blueprint = CardCharacteristicService.resolveBlueprint(room, card);
  const definition =
    ability?.type === 'activated' ? abilityAnnouncementDefinition(ability) : spellAnnouncementDefinition(blueprint);

  // Guard: mana abilities cannot declare numeric bindings.
  if (actionId === 'tapForMana' && definition.numericDeclarations?.length) {
    return reject('Mana abilities cannot declare numeric bindings');
  }

  const hasCostRoute =
    definition.alternativeCosts !== undefined ||
    definition.additionalCost !== undefined ||
    data.costRoute !== undefined;

  // Guard: mana abilities do not support cost routes.
  if (actionId === 'tapForMana' && hasCostRoute) {
    return reject('Mana abilities do not support cost routes');
  }

  const announcement = prepareAnnouncement(
    card,
    definition,
    data,
    actionId === 'cast_spell'
      ? {
          room,
          playerId,
        }
      : undefined,
  );
  if (!announcement.success) {
    return reject(announcement.reason);
  }

  const cost = announcement.cost;

  if (cost) {
    const costError = actionCostError(cost);

    if (costError) {
      return reject(costError);
    }
  }

  const counterAvailability = planCounterCosts(room, playerId, card, cost?.removeCounters, data.counterPayments, true);
  if (!counterAvailability.success) return reject(counterAvailability.reason);

  const needsAnnouncementData =
    Boolean(definition.numericDeclarations?.length) ||
    Boolean(definition.cost?.removeCounters?.length) ||
    definition.alternativeCosts !== undefined ||
    definition.additionalCost !== undefined;
  const savedData = needsAnnouncementData
    ? {
        ...data,
        announcement: announcement.snapshot,
        numericBindings: announcement.bindings,
      }
    : data;

  const activated = ability as ActivatedAbility;
  const req =
    actionId === 'cast_spell'
      ? blueprint.castRequirements
      : {
          allowedZones: activated.allowedZones ?? (['battlefield'] as const),
          speed: activated.castSpeed,
        };
  const timing = ActionValidator.canActivate(
    room,
    playerId,
    card,
    { ...req, allowedZones: [...req.allowedZones], cost: undefined },
    actionId === 'cast_spell' ? 'cast' : 'activate',
    ability?.id,
  );

  // Guard: timing and zone permission are checked before any prompt is raised.
  if (!timing.valid) {
    return reject(timing.reason);
  }

  const modes = ability?.type === 'activated' ? ability.modes : blueprint.modes;
  const count = (ability?.type === 'activated' ? ability.modeCount : blueprint.modeCount) ?? { min: 1, max: 1 };

  // Build the continuation that resumes this action after the answer.
  const continuation = (field: ActionContinuation['field'], groupId?: string): ActionContinuation => ({
    type: 'action',
    actionId,
    data: savedData,
    field,
    groupId,
  });

  // Raise a prompt, or reject when no legal answer exists.
  const request = (choice: Omit<ListedChoice, 'id' | 'playerId'>): ActionChoicePreparation => {
    if (!choiceCanComplete(choice)) {
      return reject('No legal choices can complete this action');
    }

    return prompt({ ...choice, id: '', playerId });
  };

  if (modes?.length && data.modes === undefined) {
    const options = modes
      .filter((mode) => isActionTimingAllowed(room, playerId, mode.castSpeed))
      .map((mode) => ({ id: mode.id, label: mode.label, value: mode.id }));

    return request({
      kind: 'modes',
      prompt: 'Choose modes',
      options,
      min: count.min,
      max: count.max,
      continuation: continuation('modes'),
    });
  }

  let base = blueprint.onCastEffects!;
  if (actionId !== 'cast_spell') {
    base = abilityEffects(ability as ActivatedAbility);
  }
  const effects = selectModeEffects(base, modes, data.modes, count, { room, playerId });

  if (!effects) {
    return reject('Select valid modes');
  }

  // A numeric declaration that has not been answered yet needs its own prompt.
  if (announcement.missing) {
    return prompt({
      id: '',
      playerId,
      kind: 'number',
      prompt: 'Choose ' + announcement.missing.name,
      range: {
        min: announcement.missing.min,
        max: announcement.missing.max,
      },
      continuation: {
        ...continuation('numericBindings'),
        bindingName: announcement.missing.name,
      },
    });
  }

  // An unanswered cost route needs a prompt listing the base and alternative costs.
  if (announcement.missingCostRoute) {
    const description = (selected: typeof definition.cost) => {
      try {
        return describeActionCost(
          composeActionCosts([
            materializeAnnouncementCost(selected, announcement.bindings),
            materializeAnnouncementCost(definition.additionalCost, announcement.bindings),
          ]),
        );
      } catch (error) {
        // An unavailable route must not prevent another route from being used.
        // Selecting it still follows the ordinary announcement rejection path.
        const reason = (error as Error).message;

        return 'Unavailable: ' + reason;
      }
    };

    // The route is checked above; this assertion keeps the JSON definition narrowed here.
    const alternativeCosts = definition.alternativeCosts!;
    const options = [
      {
        id: 'base',
        label: 'Pay base cost — ' + description(definition.cost),
        value: { kind: 'base' },
      },
      ...alternativeCosts.map((route) => ({
        id: 'alternative:' + route.id,
        label: route.label + ' — ' + description(route.cost),
        value: { kind: 'alternative', id: route.id },
      })),
    ];

    return request({
      kind: 'options',
      prompt: 'Choose how to pay',
      min: 1,
      max: 1,
      options,
      continuation: continuation('costRoute'),
    });
  }

  if (actionId !== 'tapForMana' && data.targets === undefined && (data.targetGroups === undefined || continuing)) {
    const groups = describeTargetGroups(effects);

    // Target groups come from action data and are narrowed after the array check.
    const selected = Array.isArray(data.targetGroups) ? (data.targetGroups as { id: string }[]) : [];
    const missing = groups.find((group) => !selected.some((entry) => entry.id === group.id));

    if (missing) {
      return request({
        kind: 'targets',
        prompt: 'Choose targets: ' + missing.id,
        options: targetOptions(room, playerId, card, missing.targeting),
        min: missing.targeting.minTargets ?? (missing.targeting.required ? 1 : 0),
        max: missing.targeting.maxTargets ?? 1,
        continuation: continuation('targetGroups', missing.id),
      });
    }
  }

  if (actionId !== 'tapForMana') {
    const planned = planTargetGroups(room, playerId, card, buildStackEffects(effects, playerId, card), data);

    if (!planned.success) {
      return reject(planned.reason);
    }

    // A distribution effect needs one prompt per effect that has no allocation yet.
    for (let index = 0; index < planned.effects.length; index++) {
      const effect = planned.effects[index];

      if (effect.choice?.kind !== 'distribution' || !isExplicitTargeting(effect.targeting)) {
        continue;
      }

      const id = `effect-${index}`;
      const hasDistribution =
        data.distributions &&
        typeof data.distributions === 'object' &&
        Object.prototype.hasOwnProperty.call(data.distributions, id);

      if (hasDistribution) {
        continue;
      }

      const options = effect.targets.map((target) => ({
        id: targetKey(target),
        label: targetLabel(target),
        value: target,
      }));

      return request({
        kind: 'distribution',
        prompt: 'Divide the effect among targets',
        options,
        min: 0,
        max: effect.targets.length,
        total: effect.choice.total,
        minimumPerOption: 1,
        continuation: continuation('distributions', id),
      });
    }
  }

  // Mana activations are prepared one at a time against the evolving room.
  let working = room;

  if (data.manaActivations !== undefined) {
    if (!Array.isArray(data.manaActivations)) {
      return reject('manaActivations must be an array');
    }

    for (let index = 0; index < data.manaActivations.length; index++) {
      const selection = data.manaActivations[index];

      // Guard: each selection must be a plain object without nested activations.
      if (
        !selection ||
        typeof selection !== 'object' ||
        Array.isArray(selection) ||
        selection.manaActivations !== undefined
      ) {
        return reject('Invalid mana activation selection');
      }

      const prepared = prepareActionChoice(working, playerId, 'tapForMana', selection);

      if (prepared.kind === 'reject') {
        return prepared;
      }

      if (prepared.kind === 'prompt') {
      const nested = prepared.choice as Exclude<PendingChoice, { kind: 'number' }> & {
        continuation: ActionContinuation;
      };

        // A spell cannot discard itself to pay for its own mana.
        const options = nested.options.filter(
          (option) => actionId !== 'cast_spell' || nested.kind !== 'discard' || option.id !== card.uuid,
        );

        return request({
          ...nested,
          options,
          continuation: {
            ...continuation(nested.continuation.field),
            manaActivationIndex: index,
            counterCostIndex: nested.continuation.counterCostIndex,
          },
        });
      }

      const planned = planManaActivation(
        working,
        playerId,
        selection,
        actionId === 'cast_spell' ? card.uuid : undefined,
      );

      if (!planned.success) {
        return reject(planned.reason);
      }

      working = planned.mutations.reduce(gameReducer, working);
    }
  }

  if (cost?.destroyMaterials && data.materialPayments === undefined) {
    const materials = cost.destroyMaterials;
    const options = materialPaymentOptions(working, playerId, materials);
    const available = options.reduce((sum, option) => sum + option.weight, 0);
    if (available <= materials.manaValueGreaterThan) return reject('Not enough eligible ritual materials');

    return request({
      kind: 'selection',
      prompt: `Choose materials with total mana value greater than ${materials.manaValueGreaterThan}`,
      options,
      min: 1,
      max: options.length,
      weightGreaterThan: materials.manaValueGreaterThan,
      continuation: continuation('materialPayments'),
    });
  }

  if (cost?.destroyMaterials) {
    const payment = planMaterialPayment(working, playerId, cost.destroyMaterials, data.materialPayments);
    if (!payment.success) return reject(payment.reason);
  }

  const counterPlan = planCounterCosts(working, playerId, card, cost?.removeCounters, data.counterPayments, true);
  if (!counterPlan.success) return reject(counterPlan.reason);
  const suppliedCounters = (data.counterPayments ?? {}) as Record<string, unknown>;
  const counterCostIndex = cost?.removeCounters?.findIndex(
    (entry, index) => entry.from === 'battlefield' && !Object.prototype.hasOwnProperty.call(suppliedCounters, index),
  );
  if (counterCostIndex !== undefined && counterCostIndex >= 0) {
    const entry = cost!.removeCounters![counterCostIndex];
    return request({
      kind: 'distribution',
      prompt: `Remove ${entry.amount} ${entry.counterType} counters to pay the cost`,
      options: counterPaymentOptions(working, playerId, card, entry, {
        costs: cost!.removeCounters!,
        payments: data.counterPayments,
        index: counterCostIndex,
      }),
      total: entry.amount,
      min: 0,
      max: working.battlefield.length,
      minimumPerOption: 0,
      continuation: { ...continuation('counterPayments'), counterCostIndex },
    });
  }

  // A discard cost needs the player to choose which cards to discard.
  if (cost?.discard && data.discardUuids === undefined) {
    const options = working.players[playerId].hand
      .filter((candidate) => candidate.uuid !== card.uuid)
      .map((candidate) => ({
        id: candidate.uuid,
        label: candidate.blueprint.name,
        value: candidate.uuid,
      }));

    return request({
      kind: 'discard',
      prompt: 'Choose cards to discard',
      options,
      min: cost.discard,
      max: cost.discard,
      continuation: continuation('discardUuids'),
    });
  }

  // A payment choice needs the player to allocate mana by colour.
  if (data.choosePayment && data.payment === undefined) {
    const options = MANA_COLORS.filter((color) => working.players[playerId].mana[color] > 0).map((color) => ({
      id: color,
      label: color,
      value: color,
      limit: working.players[playerId].mana[color],
    }));
    const total = Object.values(cost?.mana ?? {}).reduce((sum, value) => sum + (value ?? 0), 0);

    return request({
      kind: 'payment',
      prompt: 'Allocate mana payment — ' + describeActionCost({ mana: cost?.mana }),
      options,
      min: 0,
      max: MANA_COLORS.length,
      total,
      continuation: continuation('payment'),
    });
  }

  // Every prompt this action needs has been answered.
  return NO_CHOICE;
}

/** Fold a player's answer back into the action data that will be re-validated. */
export function applyActionChoice(continuation: ActionContinuation, answer: ChoiceAnswer): ActionData {
  if (continuation.field === 'counterPayments') {
    const update = (data: ActionData): ActionData => ({
      ...data,
      counterPayments: {
        ...(data.counterPayments as Record<string, unknown> | undefined),
        [continuation.counterCostIndex!]: counterPaymentAnswer(answer),
      },
    });
    if (continuation.manaActivationIndex !== undefined) {
      const activations = continuation.data.manaActivations as ActionData[];
      return {
        ...continuation.data,
        manaActivations: activations.map((entry, index) =>
          index === continuation.manaActivationIndex ? update(entry) : entry,
        ),
      };
    }
    return update(continuation.data);
  }

  if (continuation.field === 'costRoute') {
    return { ...continuation.data, costRoute: answer.values[0] };
  }

  if (continuation.field === 'numericBindings') {
    // The continuation guarantees a binding name for numeric declarations.
    const bindingName = continuation.bindingName!;
    const numericBindings = continuation.data.numericBindings as Record<string, number>;

    return {
      ...continuation.data,
      numericBindings: {
        ...numericBindings,
        [bindingName]: answer.number,
      },
    };
  }

  // Nested mana choices are stored as action data at the selected index.
  if (continuation.manaActivationIndex !== undefined) {
    const manaActivations = continuation.data.manaActivations as ActionData[];

    return {
      ...continuation.data,
      manaActivations: manaActivations.map((selection, index) =>
        index === continuation.manaActivationIndex
          ? {
              ...selection,
              [continuation.field]: continuation.field === 'payment' ? answer.allocations : answer.values,
            }
          : selection,
      ),
    };
  }

  if (continuation.field === 'distributions') {
    // A distribution continuation always identifies its effect group.
    const groupId = continuation.groupId!;
    const distributions = continuation.data.distributions as Record<string, unknown>;

    return {
      ...continuation.data,
      distributions: {
        ...distributions,
        [groupId]: answer.allocations,
      },
    };
  }

  if (continuation.field === 'targetGroups') {
    const targetGroups = (continuation.data.targetGroups as unknown[] | undefined) ?? [];

    return {
      ...continuation.data,
      targetGroups: [...targetGroups, { id: continuation.groupId, targets: answer.values }],
    };
  }

  return {
    ...continuation.data,
    [continuation.field]: continuation.field === 'payment' ? answer.allocations : answer.values,
  };
}
