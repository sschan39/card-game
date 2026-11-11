import { abilityEffects } from './ability-effects';
import type { GameRoom } from '../types/game.room.types';
import type { GameMutation } from '../types/game-mutation.types';
import type { ChoiceAnswer, PendingChoice, ListedChoice } from '../types/choice.types';
import type { TriggerQueue } from '../types/trigger.types';
import type { StackTargetGroup, StackObject } from '../types/effect.types';
import { immediateAction, isImmediateAction } from './mechanics/immediate-actions';
import { choiceCanComplete, targetOptions } from './choices';
import { buildStackEffects } from './resolution-planning';
import { selectModeEffects } from '../shared/action-modes';
import { isExplicitTargeting, targetKey } from '../shared/target-legality';
import { planTargetGroups } from './target-groups';
import { planAnnouncedDistributions } from './announced-distributions';
import { canPrepareTrigger, availableTriggerModes, triggerTargetGroups } from './trigger-preparation';
import { resolveSourceInformation } from './source-information';

/** One scheduling step. The checkpoint runs SBAs between committed steps. */
export function planTriggerScheduling(room: GameRoom): {
  mutations: GameMutation[];
  choice?: PendingChoice;
  immediateObject?: StackObject;
} {
  const queue = room.triggerQueue;

  // Guard: nothing to schedule without a queue.
  if (!queue) return { mutations: [] };

  // Guard: an empty queue hands priority back and returns to the player.
  if (!queue.entries.length) {
    return {
      mutations: [
        { type: 'SET_TRIGGER_QUEUE', queue: null },
        { type: 'SET_PRIORITY', playerId: queue.resumePriority },
        { type: 'SET_ENGINE_STATE', state: 'waiting_for_player' },
        { type: 'SET_LAST_PASSED', playerId: null },
      ],
    };
  }

  // Recheck after intervening state-based actions. Discovery already refused
  // impossible triggers; a later state change may invalidate an accepted one.
  const viable = queue.entries.filter((entry) => canPrepareTrigger(room, entry.object, entry.selections.modes));
  if (viable.length !== queue.entries.length)
    return {
      mutations: [{ type: 'SET_TRIGGER_QUEUE', queue: { ...queue, entries: viable } }],
    };

  // Active player's triggers go on the stack first.
  const entries = [...queue.entries].sort(
    (a, b) =>
      Number(a.object.controllerId !== room.activeTurnPlayerId) -
      Number(b.object.controllerId !== room.activeTurnPlayerId),
  );
  const first = entries[0],
    object = first.object,
    playerId = object.controllerId;
  const group = entries.filter((entry) => entry.object.controllerId === playerId);

  const request = (choice: Omit<ListedChoice, 'id' | 'playerId'>) => ({
    mutations: [] as GameMutation[],
    choice: { ...choice, id: '', playerId },
  });

  // Multiple unordered triggers from one player must be ordered first.
  const distinct = !object.repeatGroupId || group.some(entry => entry.object.repeatGroupId !== object.repeatGroupId);
  if (distinct && group.length > 1 && group.some((entry) => !entry.ordered)) {
    return request({
      kind: 'ordering',
      prompt: 'Order triggered abilities from bottom to top',
      min: group.length,
      max: group.length,
      options: group.map((entry) => ({
        id: entry.object.uuid,
        label: entry.object.source.blueprint.name + ': ' + (entry.object.ability?.id ?? 'entry'),
        value: entry.object.uuid,
      })),
      continuation: { type: 'trigger', field: 'order' },
    });
  }

  const continuation = (field: 'modes' | 'targetGroups' | 'distributions', groupId?: string) => ({
    type: 'trigger' as const,
    field,
    triggerUuid: object.uuid,
    groupId,
  });
  const ability = object.ability,
    data = first.selections;

  // Dropping the entry is the fallback whenever a choice cannot be completed.
  const drop = () => ({
    mutations: [{ type: 'SET_TRIGGER_QUEUE' as const, queue: { ...queue, entries: entries.slice(1) } }],
  });

  // Step 1: mode selection.
  if (ability?.modes?.length && data.modes === undefined) {
    const count = ability.modeCount ?? { min: 1, max: 1 };
    const result = request({
      kind: 'modes',
      prompt: 'Choose trigger modes',
      min: count.min,
      max: count.max,
      options: availableTriggerModes(room, object).map((mode) => ({ id: mode.id, label: mode.label, value: mode.id })),
      continuation: continuation('modes'),
    });

    return choiceCanComplete(result.choice) ? result : drop();
  }

  const source = resolveSourceInformation(room, object).card;
  const selected = ability
    ? selectModeEffects(abilityEffects(ability), ability.modes, data.modes, ability.modeCount)
    : undefined;

  // Guard: an ability whose modes cannot be resolved is dropped.
  if (ability && !selected) return drop();

  const effects = ability ? buildStackEffects(selected!, playerId, object.source) : object.effects;
  const groups = triggerTargetGroups(effects);
  const selectedGroups = data.targetGroups as StackTargetGroup[] | undefined;
  const missing = groups.find((group) => !selectedGroups?.some((selected) => selected.id === group.id));

  // Step 2: target selection for each unresolved group.
  if (missing) {
    const result = request({
      kind: 'targets',
      prompt: 'Choose trigger targets: ' + missing.id,
      min: missing.targeting.minTargets ?? (missing.targeting.required ? 1 : 0),
      max: missing.targeting.maxTargets ?? 1,
      options: targetOptions(room, playerId, source, missing.targeting),
      continuation: continuation('targetGroups', missing.id),
    });

    return choiceCanComplete(result.choice) ? result : drop();
  }

  const targets = planTargetGroups(room, playerId, source, effects, data);

  // Guard: illegal targets drop the trigger.
  if (!targets.success) return drop();

  // Step 3: distribution of a divided effect among its targets.
  for (let index = 0; index < targets.effects.length; index++) {
    const effect = targets.effects[index],
      id = 'effect-' + index;

    if (
      effect.choice?.kind !== 'distribution' ||
      !isExplicitTargeting(effect.targeting) ||
      (data.distributions as Record<string, unknown> | undefined)?.[id] !== undefined
    )
      continue;

    const result = request({
      kind: 'distribution',
      prompt: 'Divide trigger effect among targets',
      min: 0,
      max: effect.targets.length,
      total: effect.choice.total,
      minimumPerOption: 1,
      options: effect.targets.map((target) => ({
        id: targetKey(target),
        label: target.playerId ?? target.cardUuid ?? target.stackUuid ?? 'target',
        value: target,
      })),
      continuation: continuation('distributions', id),
    });

    return choiceCanComplete(result.choice) ? result : drop();
  }

  const distribution = planAnnouncedDistributions(targets.effects, data);

  // Guard: an invalid distribution drops the trigger.
  if (!distribution.success) return drop();

  const prepared = { ...object, effects: distribution.effects, targetGroups: targets.groups };

  // Immediate actions resolve without touching the stack.
  if (isImmediateAction(room, prepared)) {
    return {
      immediateObject: immediateAction(room, prepared),
      mutations: [{ type: 'SET_TRIGGER_QUEUE', queue: { ...queue, entries: entries.slice(1) } }],
    };
  }

  return {
    mutations: [
      { type: 'PUSH_STACK', stackObject: prepared },
      { type: 'SET_TRIGGER_QUEUE', queue: { ...queue, entries: entries.slice(1) } },
    ],
  };
}

/** Fold a trigger scheduling answer back into the queue. */
export function applyTriggerChoice(
  room: GameRoom,
  choice: PendingChoice,
  answer: ChoiceAnswer,
): TriggerQueue | undefined {
  // Guard: only trigger continuations belong here, and a queue must exist.
  if (choice.continuation.type !== 'trigger' || !room.triggerQueue)
    throw new Error('Expected trigger scheduling choice');

  const continuation = choice.continuation,
    queue = room.triggerQueue;
  if (continuation.field === 'modes') {
    const entry = queue.entries.find((item) => item.object.uuid === continuation.triggerUuid);
    if (!entry || !canPrepareTrigger(room, entry.object, answer.values)) return;
  }

  // Ordering moves the chosen entries to the front and marks them ordered.
  if (continuation.field === 'order') {
    const selected = answer.values as string[];

    return {
      ...queue,
      entries: [
        ...selected.map((id) => ({ ...queue.entries.find((entry) => entry.object.uuid === id)!, ordered: true })),
        ...queue.entries.filter((entry) => !selected.includes(entry.object.uuid)),
      ],
    };
  }

  return {
    ...queue,
    entries: queue.entries.map((entry) => {
      if (entry.object.uuid !== continuation.triggerUuid) return entry;

      const data = entry.selections;

      return {
        ...entry,
        selections:
          continuation.field === 'targetGroups'
            ? {
                ...data,
                targetGroups: [
                  ...((data.targetGroups as unknown[]) ?? []),
                  { id: continuation.groupId, targets: answer.values },
                ],
              }
            : continuation.field === 'distributions'
              ? {
                  ...data,
                  distributions: {
                    ...(data.distributions as Record<string, unknown>),
                    [continuation.groupId!]: answer.allocations,
                  },
                }
              : { ...data, modes: answer.values },
      };
    }),
  };
}
