import type { GameRoom } from '../types/game.room.types';
import type { GameMutation } from '../types/game-mutation.types';
import type { ChoiceAnswer, PendingChoice } from '../types/choice.types';
import type { TriggerQueue } from '../types/trigger.types';
import type { StackTargetGroup } from '../types/effect.types';
import { choiceCanComplete, targetOptions } from './choices';
import { buildStackEffects } from './effect-resolver';
import { selectModeEffects } from '../shared/action-modes';
import { describeTargetGroups, isExplicitTargeting, targetKey } from '../shared/target-legality';
import { planTargetGroups } from './target-groups';
import { planAnnouncedDistributions } from './announced-distributions';
import { resolveSourceInformation } from './source-information';

/** One scheduling step. The checkpoint runs SBAs between committed steps. */
export function planTriggerScheduling(room: GameRoom): { mutations: GameMutation[]; choice?: PendingChoice } {
  const queue = room.triggerQueue;
  if (!queue) return { mutations: [] };
  if (!queue.entries.length) return { mutations: [{ type: 'SET_TRIGGER_QUEUE', queue: null }, { type: 'SET_PRIORITY', playerId: queue.resumePriority }, { type: 'SET_ENGINE_STATE', state: 'waiting_for_player' }, { type: 'SET_LAST_PASSED', playerId: null }] };
  const entries = [...queue.entries].sort((a, b) => Number(a.object.controllerId !== room.activeTurnPlayerId) - Number(b.object.controllerId !== room.activeTurnPlayerId));
  const first = entries[0], object = first.object, playerId = object.controllerId;
  const group = entries.filter(entry => entry.object.controllerId === playerId);
  const request = (choice: Omit<PendingChoice, 'id' | 'playerId'>) => ({ mutations: [] as GameMutation[], choice: { ...choice, id: '', playerId } });
  if (group.length > 1 && group.some(entry => !entry.ordered)) return request({ kind: 'ordering', prompt: 'Order triggered abilities from bottom to top', min: group.length, max: group.length,
    options: group.map(entry => ({ id: entry.object.uuid, label: entry.object.source.blueprint.name + ': ' + (entry.object.ability?.id ?? 'entry'), value: entry.object.uuid })), continuation: { type: 'trigger', field: 'order' } });
  const continuation = (field: 'modes' | 'targetGroups' | 'distributions', groupId?: string) => ({ type: 'trigger' as const, field, triggerUuid: object.uuid, groupId });
  const ability = object.ability, data = first.selections;
  const drop = () => ({ mutations: [{ type: 'SET_TRIGGER_QUEUE' as const, queue: { ...queue, entries: entries.slice(1) } }] });
  if (ability?.modes?.length && data.modes === undefined) {
    const count = ability.modeCount ?? { min: 1, max: 1 };
    const result = request({ kind: 'modes', prompt: 'Choose trigger modes', min: count.min, max: count.max,
      options: ability.modes.map(mode => ({ id: mode.id, label: mode.label, value: mode.id })), continuation: continuation('modes') });
    return choiceCanComplete(result.choice) ? result : drop();
  }
  const source = resolveSourceInformation(room, object).card;
  const selected = ability ? selectModeEffects([ability.effect], ability.modes, data.modes, ability.modeCount) : undefined;
  if (ability && !selected) return drop();
  const effects = ability ? buildStackEffects(selected!, playerId, object.source) : object.effects;
  const groups = describeTargetGroups(effects.map(effect => ({ ...effect, targeting: effect.targeting ?? { type: 'self', required: false } })));
  const selectedGroups = data.targetGroups as StackTargetGroup[] | undefined;
  const missing = groups.find(group => !selectedGroups?.some(selected => selected.id === group.id));
  if (missing) {
    const result = request({ kind: 'targets', prompt: 'Choose trigger targets: ' + missing.id, min: missing.targeting.minTargets ?? (missing.targeting.required ? 1 : 0), max: missing.targeting.maxTargets ?? 1,
      options: targetOptions(room, playerId, source, missing.targeting), continuation: continuation('targetGroups', missing.id) });
    return choiceCanComplete(result.choice) ? result : drop();
  }
  const targets = planTargetGroups(room, playerId, source, effects, data);
  if (!targets.success) return drop();
  for (let index = 0; index < targets.effects.length; index++) {
    const effect = targets.effects[index], id = 'effect-' + index;
    if (effect.choice?.kind !== 'distribution' || !isExplicitTargeting(effect.targeting) || (data.distributions as Record<string, unknown> | undefined)?.[id] !== undefined) continue;
    const result = request({ kind: 'distribution', prompt: 'Divide trigger effect among targets', min: 0, max: effect.targets.length, total: effect.choice.total, minimumPerOption: 1,
      options: effect.targets.map(target => ({ id: targetKey(target), label: target.playerId ?? target.cardUuid ?? target.stackUuid ?? 'target', value: target })), continuation: continuation('distributions', id) });
    return choiceCanComplete(result.choice) ? result : drop();
  }
  const distribution = planAnnouncedDistributions(targets.effects, data);
  if (!distribution.success) return drop();
  return { mutations: [{ type: 'PUSH_STACK', stackObject: { ...object, effects: distribution.effects, targetGroups: targets.groups } },
    { type: 'SET_TRIGGER_QUEUE', queue: { ...queue, entries: entries.slice(1) } }] };
}

export function applyTriggerChoice(room: GameRoom, choice: PendingChoice, answer: ChoiceAnswer): TriggerQueue {
  if (choice.continuation.type !== 'trigger' || !room.triggerQueue) throw new Error('Expected trigger scheduling choice');
  const continuation = choice.continuation, queue = room.triggerQueue;
  if (continuation.field === 'order') {
    const selected = answer.values as string[];
    return { ...queue, entries: [...selected.map(id => ({ ...queue.entries.find(entry => entry.object.uuid === id)!, ordered: true })), ...queue.entries.filter(entry => !selected.includes(entry.object.uuid))] };
  }
  return { ...queue, entries: queue.entries.map(entry => {
    if (entry.object.uuid !== continuation.triggerUuid) return entry;
    const data = entry.selections;
    return { ...entry, selections: continuation.field === 'targetGroups' ? { ...data, targetGroups: [...data.targetGroups as unknown[] ?? [], { id: continuation.groupId, targets: answer.values }] }
      : continuation.field === 'distributions' ? { ...data, distributions: { ...data.distributions as Record<string, unknown>, [continuation.groupId!]: answer.allocations } }
      : { ...data, modes: answer.values } };
  }) };
}
