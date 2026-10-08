import type { GameRoom } from '../types/game.room.types';
import type { ActionData } from './action-registry';
import type { PendingChoice, ActionContinuation, ChoiceAnswer } from '../types/choice.types';
import { ActionValidator } from './action-validator';
import { describeTargetGroups, isExplicitTargeting, targetKey } from '../shared/target-legality';
import { selectModeEffects } from '../shared/action-modes';
import { targetOptions, choiceCanComplete } from './choices';
import { MANA_COLORS } from '../types/card.types';
import { manaAbilities } from './mana-abilities';
import { actionCostError, planManaActivation } from './action-costs';
import { gameReducer } from './game-reducer';
import { planTargetGroups } from './target-groups';
import { buildStackEffects } from './effect-resolver';
import { abilityLimitReached } from './turn-history';

/** Missing selections open prompts; supplied invalid selections still reject normally. */
export function prepareActionChoice(room: GameRoom, playerId: string, actionId: string, data: ActionData, continuing = false): { choice?: PendingChoice; error?: string } {
  if (!['cast_spell', 'activate_ability', 'tapForMana'].includes(actionId)) return {};
  const card = actionId === 'cast_spell' ? room.players[playerId].hand.find(c => c.uuid === data.cardUuid)
    : room.battlefield.find(c => c.uuid === data.cardUuid && c.state.controllerId === playerId);
  if (!card) return {};
  const candidates = manaAbilities(card);
  const ability = actionId === 'activate_ability' ? card.blueprint.abilities.find(a => a.id === data.abilityId)
    : actionId === 'tapForMana' ? (data.abilityId !== undefined ? candidates.find(a => a.ability.id === data.abilityId)
      : data.abilityIndex !== undefined ? candidates.find(a => a.abilityIndex === data.abilityIndex) : candidates.length === 1 ? candidates[0] : undefined)?.ability : undefined;
  if (actionId !== 'cast_spell' && (!ability || ability.type !== 'activated')) return {};
  if (ability?.type === 'activated' && abilityLimitReached(room, card, ability)) return { error: 'Ability use limit reached for this turn' };
  const cost = actionId === 'cast_spell' ? card.blueprint.castRequirements.cost : ability!.type === 'activated' ? ability!.cost : undefined;
  const costError = actionCostError(cost ?? {});
  if (costError) return { error: costError };
  const req = actionId === 'cast_spell' ? card.blueprint.castRequirements : { allowedZones: ['battlefield'] as const, speed: ability!.castSpeed };
  const timing = ActionValidator.canActivate(room, playerId, card, { ...req, allowedZones: [...req.allowedZones], cost: undefined });
  if (!timing.valid) return { error: timing.reason };
  const modes = ability?.type === 'activated' ? ability.modes : card.blueprint.modes;
  const count = (ability?.type === 'activated' ? ability.modeCount : card.blueprint.modeCount) ?? { min: 1, max: 1 };
  const continuation = (field: ActionContinuation['field'], groupId?: string): ActionContinuation => ({ type: 'action', actionId, data, field, groupId });
  const request = (choice: Omit<PendingChoice, 'id' | 'playerId'>) => !choiceCanComplete(choice) ? { error: 'No legal choices can complete this action' }
    : { choice: { ...choice, id: '', playerId } };
  if (modes?.length && data.modes === undefined) return request({ kind: 'modes', prompt: 'Choose modes', options: modes.map(mode => ({ id: mode.id, label: mode.label, value: mode.id })), min: count.min, max: count.max, continuation: continuation('modes') });
  const base = actionId === 'cast_spell' ? card.blueprint.onCastEffects ?? [] : [ability!.effect];
  const effects = selectModeEffects(base, modes, data.modes, count);
  if (!effects) return { error: 'Select valid modes' };
  if (actionId !== 'tapForMana' && data.targets === undefined && (data.targetGroups === undefined || continuing)) {
    const groups = describeTargetGroups(effects);
    const selected = Array.isArray(data.targetGroups) ? data.targetGroups as { id: string }[] : [];
    const missing = groups.find(group => !selected.some(entry => entry.id === group.id));
    if (missing) return request({ kind: 'targets', prompt: 'Choose targets: ' + missing.id, options: targetOptions(room, playerId, card, missing.targeting),
      min: missing.targeting.minTargets ?? (missing.targeting.required ? 1 : 0), max: missing.targeting.maxTargets ?? 1, continuation: continuation('targetGroups', missing.id) });
  }
  if (actionId !== 'tapForMana') {
    const planned = planTargetGroups(room, playerId, card, buildStackEffects(effects, playerId, card), data);
    if (!planned.success) return { error: planned.reason };
    for (let index = 0; index < planned.effects.length; index++) {
      const effect = planned.effects[index];
      if (effect.choice?.kind !== 'distribution' || !isExplicitTargeting(effect.targeting)) continue;
      const id = `effect-${index}`;
      if (data.distributions && typeof data.distributions === 'object' && Object.prototype.hasOwnProperty.call(data.distributions, id)) continue;
      return request({ kind: 'distribution', prompt: 'Divide the effect among targets', options: effect.targets.map(target => ({ id: targetKey(target), label: target.playerId ?? target.cardUuid ?? target.stackUuid ?? 'target', value: target })),
        min: 0, max: effect.targets.length, total: effect.choice.total, minimumPerOption: 1, continuation: continuation('distributions', id) });
    }
  }
  let working = room;
  if (data.manaActivations !== undefined) {
    if (!Array.isArray(data.manaActivations)) return { error: 'manaActivations must be an array' };
    for (let index = 0; index < data.manaActivations.length; index++) {
      const selection = data.manaActivations[index];
      if (!selection || typeof selection !== 'object' || Array.isArray(selection) || selection.manaActivations !== undefined) return { error: 'Invalid mana activation selection' };
      const prepared = prepareActionChoice(working, playerId, 'tapForMana', selection);
      if (prepared.error) return prepared;
      if (prepared.choice) {
        const nested = prepared.choice;
        if (nested.continuation.type !== 'action') return { error: 'Invalid mana choice' };
        const options = nested.options.filter(option => actionId !== 'cast_spell' || nested.kind !== 'discard' || option.id !== card.uuid);
        return request({ ...nested, options, continuation: { ...continuation(nested.continuation.field), manaActivationIndex: index } });
      }
      const planned = planManaActivation(working, playerId, selection, actionId === 'cast_spell' ? card.uuid : undefined);
      if (!planned.success) return { error: planned.reason };
      working = planned.mutations.reduce(gameReducer, working);
    }
  }
  if (cost?.discard && data.discardUuids === undefined) return request({ kind: 'discard', prompt: 'Choose cards to discard', options: working.players[playerId].hand.filter(c => c.uuid !== card.uuid).map(c => ({ id: c.uuid, label: c.blueprint.name, value: c.uuid })), min: cost.discard, max: cost.discard, continuation: continuation('discardUuids') });
  if (data.choosePayment && data.payment === undefined) return request({ kind: 'payment', prompt: 'Allocate mana payment', options: MANA_COLORS.filter(color => working.players[playerId].mana[color] > 0).map(color => ({ id: color, label: color, value: color, limit: working.players[playerId].mana[color] })), min: 0, max: MANA_COLORS.length,
    total: Object.values(cost?.mana ?? {}).reduce((sum, value) => sum + (value ?? 0), 0), continuation: continuation('payment') });
  return {};
}

export function applyActionChoice(continuation: ActionContinuation, answer: ChoiceAnswer): ActionData {
  if (continuation.manaActivationIndex !== undefined) return { ...continuation.data,
    manaActivations: (continuation.data.manaActivations as ActionData[]).map((selection, index) => index === continuation.manaActivationIndex
      ? { ...selection, [continuation.field]: continuation.field === 'payment' ? answer.allocations : answer.values } : selection) };
  if (continuation.field === 'distributions') return { ...continuation.data, distributions: { ...continuation.data.distributions as Record<string, unknown>, [continuation.groupId!]: answer.allocations } };
  if (continuation.field === 'targetGroups') return { ...continuation.data, targetGroups: [...continuation.data.targetGroups as unknown[] ?? [], { id: continuation.groupId, targets: answer.values }] };
  return { ...continuation.data, [continuation.field]: continuation.field === 'payment' ? answer.allocations : answer.values };
}
