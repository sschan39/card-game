import type { ActionData } from './action-registry';
import type { GameRoom } from '../types/game.room.types';
import type { CardInstance } from '../types/card.types';
import type { StackEffect, StackTargetGroup, TargetPointer } from '../types/effect.types';
import { describeTargetGroups, findTargetCard, isExplicitTargeting, structuralTargetLegal, targetKey } from '../shared/target-legality';
import { ModifierRegistry } from './modifier-registry';

type TargetPlan = { success: true; effects: StackEffect[]; groups: StackTargetGroup[] } | { success: false; reason: string };

export function planTargetGroups(room: GameRoom, playerId: string, source: CardInstance, effects: StackEffect[], action: ActionData): TargetPlan {
  const reject = (reason: string): TargetPlan => ({ success: false, reason });
  let definitions;
  try { definitions = describeTargetGroups(effects.map(e => ({ ...e, targeting: e.targeting ?? { type: 'self', required: false } }))); }
  catch (error) { return reject((error as Error).message); }
  let selections: { id: string; targets: TargetPointer[] }[];
  if (action.targetGroups !== undefined) {
    if (action.targets !== undefined || !Array.isArray(action.targetGroups)) return reject('Use one target selection format');
    selections = action.targetGroups as typeof selections;
    if (selections.some(group => !group || typeof group.id !== 'string' || !Array.isArray(group.targets))) return reject('Invalid target groups');
  } else {
    const flat = action.targets ?? [];
    if (!Array.isArray(flat)) return reject('Invalid targets');
    if (!definitions.length && flat.length) return reject('This action does not choose targets');
    let cursor = 0;
    selections = definitions.map(group => {
      const count = group.targeting.maxTargets ?? (definitions.length === 1 ? flat.length : -1);
      if (count < 0) return { id: group.id, targets: [] };
      const targets = flat.slice(cursor, cursor + count); cursor += targets.length;
      return { id: group.id, targets };
    });
    if (cursor !== flat.length || (definitions.length > 1 && definitions.some(group => group.targeting.maxTargets === undefined))) return reject('Select targets by group');
  }
  if (selections.length !== definitions.length || new Set(selections.map(group => group.id)).size !== selections.length ||
      selections.some(group => !definitions.some(def => def.id === group.id))) return reject('Missing, duplicate or unknown target group');
  const groups: StackTargetGroup[] = [];
  for (const definition of definitions) {
    const targets = selections.find(group => group.id === definition.id)!.targets;
    const min = definition.targeting.minTargets ?? (definition.targeting.required ? 1 : 0);
    if (targets.length < min || targets.length > (definition.targeting.maxTargets ?? Infinity) ||
        new Set(targets.map(targetKey)).size !== targets.length ||
        targets.some(target => !structuralTargetLegal(room, playerId, target, definition.targeting)) ||
        !ModifierRegistry.canTarget(room, playerId, source, targets)) return reject('Target is not legal');
    groups.push({ ...definition, targets: targets.map(target => {
      const card = findTargetCard(room, target);
      return card ? { targetType: target.targetType, cardUuid: card.uuid, zone: card.state.zone, zoneRevision: card.state.zoneRevision ?? 0 } : { targetType: target.targetType, ...(target.playerId ? { playerId: target.playerId } : {}), ...(target.stackUuid ? { stackUuid: target.stackUuid } : {}) };
    }) });
  }
  return { success: true, groups, effects: effects.map((effect, index) => isExplicitTargeting(effect.targeting)
    ? { ...effect, targetGroup: effect.targetGroup ?? `effect-${index}`, targets: groups.find(group => group.id === (effect.targetGroup ?? `effect-${index}`))!.targets }
    : effect) };
}
