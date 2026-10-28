import { CardCharacteristicService } from './card-characteristic-service';
import { abilityEffects } from './ability-effects';
import { findActivationSource } from './activation-source';
import type { GameRoom } from '../types/game.room.types';
import type { ActionData } from './action-registry';
import type { PendingChoice, ListedChoice, ActionContinuation, ChoiceAnswer } from '../types/choice.types';
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
import { buildStackEffects } from './effect-resolver';
import { abilityLimitReached } from './turn-history';
import { prepareAnnouncement, spellAnnouncementDefinition, abilityAnnouncementDefinition, materializeAnnouncementCost } from './announcement-values';
import { composeActionCosts } from './cost-composition';
import { describeActionCost } from '../shared/action-cost-description';

/** Missing selections open prompts; supplied invalid selections still reject normally. */
export function prepareActionChoice(
  room: GameRoom,
  playerId: string,
  actionId: string,
  data: ActionData,
  continuing = false,
): { choice?: PendingChoice; error?: string } {
  const supportedActions = ['cast_spell', 'activate_ability', 'tapForMana'];
  if (!supportedActions.includes(actionId)) {
    // These commands have no announcement choices; their own handler validates them.
    return {};
  }

  const card =
    actionId === 'cast_spell'
      ? room.players[playerId].hand.find((candidate) => candidate.uuid === data.cardUuid)
      : findActivationSource(room, playerId, data.cardUuid);
  if (!card) {
    return {error : 'card object not found'};
  }

  const isLandSpell =
    actionId === 'cast_spell' &&
    CardCharacteristicService.resolveTypes(room, card).includes('Land');
  if (isLandSpell) {
    return { error: 'Lands are played directly, not cast as spells' };
  }

  const candidates = manaAbilities(card, room);
  let ability = undefined;

  if (actionId === 'activate_ability') {
    ability = CardCharacteristicService.resolveAbilities(room, card).find(
      (candidate) => candidate.id === data.abilityId,
    );
  } else if (actionId === 'tapForMana') {
    const selectedManaAbility =
      data.abilityId !== undefined
        ? candidates.find((candidate) => candidate.ability.id === data.abilityId)
        : data.abilityIndex !== undefined
          ? candidates.find((candidate) => candidate.abilityIndex === data.abilityIndex)
          : candidates.length === 1
            ? candidates[0]
            : undefined;
    ability = selectedManaAbility?.ability;
  }

  if (actionId !== 'cast_spell' && (!ability || ability.type !== 'activated')) {
    return {};
  }
  if (ability?.type === 'activated' && abilityLimitReached(room, card, ability)) {
    return { error: 'Ability use limit reached for this turn' };
  }

  const blueprint = CardCharacteristicService.resolveBlueprint(room, card);
  const definition =
    ability?.type === 'activated'
      ? abilityAnnouncementDefinition(ability)
      : spellAnnouncementDefinition(blueprint);

  if (actionId === 'tapForMana' && definition.numericDeclarations?.length) {
    return { error: 'Mana abilities cannot declare numeric bindings' };
  }
  const hasCostRoute =
    definition.alternativeCosts !== undefined ||
    definition.additionalCost !== undefined ||
    data.costRoute !== undefined;
  if (actionId === 'tapForMana' && hasCostRoute) {
    return { error: 'Mana abilities do not support cost routes' };
  }

  const announcement = prepareAnnouncement(card, definition, data);
  if (!announcement.success) {
    return { error: announcement.reason };
  }
  const cost = announcement.cost;
  if (cost) {
    const costError = actionCostError(cost);
    if (costError) {
      return { error: costError };
    }
  }

  const needsAnnouncementData =
    Boolean(definition.numericDeclarations?.length) ||
    definition.alternativeCosts !== undefined ||
    definition.additionalCost !== undefined;
  const savedData = needsAnnouncementData
    ? {
        ...data,
        announcement: announcement.snapshot,
        numericBindings: announcement.bindings,
      }
    : data;

  const req =
    actionId === 'cast_spell'
      ? blueprint.castRequirements
      : {
          allowedZones:
            ability?.type === 'activated'
              ? ability.allowedZones ?? (['battlefield'] as const)
              : (['battlefield'] as const),
          speed: ability?.type === 'activated' ? ability.castSpeed : ('sorcery' as const),
        };
  const timing = ActionValidator.canActivate(
    room,
    playerId,
    card,
    { ...req, allowedZones: [...req.allowedZones], cost: undefined },
    actionId === 'cast_spell' ? 'cast' : 'activate',
    ability?.id,
  );
  if (!timing.valid) {
    return { error: timing.reason };
  }

  const modes =
    ability?.type === 'activated' ? ability.modes : blueprint.modes;
  const count =
    (ability?.type === 'activated' ? ability.modeCount : blueprint.modeCount) ??
    { min: 1, max: 1 };
  const continuation = (
    field: ActionContinuation['field'],
    groupId?: string,
  ): ActionContinuation => ({
    type: 'action',
    actionId,
    data: savedData,
    field,
    groupId,
  });
  const request = (choice: Omit<ListedChoice, 'id' | 'playerId'>) => {
    if (!choiceCanComplete(choice)) {
      return { error: 'No legal choices can complete this action' };
    }
    return { choice: { ...choice, id: '', playerId } };
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

  const base =
    actionId === 'cast_spell'
      ? blueprint.onCastEffects ?? []
      : ability?.type === 'activated'
        ? abilityEffects(ability)
        : [];
  const effects = selectModeEffects(base, modes, data.modes, count, { room, playerId });
  if (!effects) {
    return { error: 'Select valid modes' };
  }
  if (announcement.missing) {
    return {
      choice: {
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
      },
    };
  }
  if (announcement.missingCostRoute) {
    const description = (selected: typeof definition.cost) => {
      try {
        return describeActionCost(composeActionCosts([
          materializeAnnouncementCost(selected, announcement.bindings),
          materializeAnnouncementCost(definition.additionalCost, announcement.bindings),
        ]));
      } catch (error) {
        // An unavailable route must not prevent another route from being used.
        // Selecting it still follows the ordinary announcement rejection path.
        const reason = error instanceof Error ? error.message : 'Invalid combined cost';
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
    const selected = Array.isArray(data.targetGroups)
      ? (data.targetGroups as { id: string }[])
      : [];
    const missing = groups.find(
      (group) => !selected.some((entry) => entry.id === group.id),
    );
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
      return { error: planned.reason };
    }
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
        label: target.playerId ?? target.cardUuid ?? target.stackUuid ?? 'target',
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

  let working = room;
  if (data.manaActivations !== undefined) {
    if (!Array.isArray(data.manaActivations)) {
      return { error: 'manaActivations must be an array' };
    }
    for (let index = 0; index < data.manaActivations.length; index++) {
      const selection = data.manaActivations[index];
      if (
        !selection ||
        typeof selection !== 'object' ||
        Array.isArray(selection) ||
        selection.manaActivations !== undefined
      ) {
        return { error: 'Invalid mana activation selection' };
      }
      const prepared = prepareActionChoice(working, playerId, 'tapForMana', selection);
      if (prepared.error) {
        return prepared;
      }
      if (prepared.choice) {
        const nested = prepared.choice;
        if (nested.kind === 'number') {
          return { error: 'Mana abilities cannot declare numeric bindings' };
        }
        if (nested.continuation.type !== 'action') {
          return { error: 'Invalid mana choice' };
        }
        const options = nested.options.filter(
          (option) =>
            actionId !== 'cast_spell' ||
            nested.kind !== 'discard' ||
            option.id !== card.uuid,
        );
        return request({
          ...nested,
          options,
          continuation: {
            ...continuation(nested.continuation.field),
            manaActivationIndex: index,
          },
        });
      }
      const planned = planManaActivation(working, playerId, selection, actionId === 'cast_spell' ? card.uuid : undefined);
      if (!planned.success) {
        return { error: planned.reason };
      }
      working = planned.mutations.reduce(gameReducer, working);
    }
  }

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

  if (data.choosePayment && data.payment === undefined) {
    const options = MANA_COLORS
      .filter((color) => working.players[playerId].mana[color] > 0)
      .map((color) => ({
        id: color,
        label: color,
        value: color,
        limit: working.players[playerId].mana[color],
      }));
    const total = Object.values(cost?.mana ?? {}).reduce(
      (sum, value) => sum + (value ?? 0),
      0,
    );
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

  return {};
}

export function applyActionChoice(continuation: ActionContinuation, answer: ChoiceAnswer): ActionData {
  if (continuation.field === 'costRoute') {
    return { ...continuation.data, costRoute: answer.values[0] };
  }

  if (continuation.field === 'numericBindings') {
    // The continuation guarantees a binding name for numeric declarations.
    const bindingName = continuation.bindingName!;
    const numericBindings =
      continuation.data.numericBindings as Record<string, number>;
    return {
      ...continuation.data,
      numericBindings: {
        ...numericBindings,
        [bindingName]: answer.number,
      },
    };
  }

  if (continuation.manaActivationIndex !== undefined) {
    // Nested mana choices are stored as action data at the selected index.
    const manaActivations =
      continuation.data.manaActivations as ActionData[];
    return {
      ...continuation.data,
      manaActivations: manaActivations.map((selection, index) =>
        index === continuation.manaActivationIndex
          ? {
              ...selection,
              [continuation.field]:
                continuation.field === 'payment'
                  ? answer.allocations
                  : answer.values,
            }
          : selection,
      ),
    };
  }

  if (continuation.field === 'distributions') {
    // A distribution continuation always identifies its effect group.
    const groupId = continuation.groupId!;
    const distributions =
      continuation.data.distributions as Record<string, unknown>;
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
      targetGroups: [
        ...targetGroups,
        { id: continuation.groupId, targets: answer.values },
      ],
    };
  }

  return {
    ...continuation.data,
    [continuation.field]:
      continuation.field === 'payment' ? answer.allocations : answer.values,
  };
}
