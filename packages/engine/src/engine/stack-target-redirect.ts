import type { GameRoom } from '../types/game.room.types';
import type { StackObject, TargetPointer } from '../types/effect.types';
import type { GameMutation } from '../types/game-mutation.types';
import { structuralTargetLegal, targetKey } from '../shared/target-legality';
import { sameCardObject } from '../shared/card-identity';
import { PermissionRegistry } from './permission-registry';
import { resolveSourceInformation } from './source-information';

type Redirect = Extract<GameMutation, { type: 'RETARGET_STACK' }>;

function sameTarget(left: TargetPointer, right: TargetPointer): boolean {
  return targetKey(left) === targetKey(right) && left.zone === right.zone && left.zoneRevision === right.zoneRevision;
}

/** Redirect the exact announced group and preserve its other targets and their associated instructions. */
export function replaceStackTarget(object: StackObject, redirect: Redirect): StackObject {
  if (object.uuid !== redirect.stackUuid || object.countered) return object;
  const group = object.targetGroups?.find(value => value.id === redirect.groupId);
  if (!group?.targets.some(target => sameTarget(target, redirect.from))) return object;
  if (group.targets.some(target => targetKey(target) === targetKey(redirect.to))) return object;

  const replace = (target: TargetPointer) => sameTarget(target, redirect.from) ? redirect.to : target;
  return {
    ...object,
    targetGroups: object.targetGroups?.map(value => value === group ? { ...value, targets: value.targets.map(replace) } : value),
    effects: object.effects.map(effect => effect.targetGroup === group.id
      ? { ...effect, targets: effect.targets.map(replace) }
      : effect),
  };
}

/** A target-triggered instruction may redirect only the target event it observed, to its own live source. */
export function planStackTargetRedirect(room: GameRoom, object: StackObject): Redirect | undefined {
  if (object.type !== 'triggered' || object.triggeringEvent?.eventId !== 'PERMANENT_TARGETED') return;
  const { stackUuid, groupId, target } = object.triggeringEvent.payload;
  if (typeof stackUuid !== 'string' || typeof groupId !== 'string' || !target || typeof target !== 'object') return;
  const from = target as TargetPointer;
  const pending = room.stack.find(item => item.uuid === stackUuid && !item.countered);
  const source = room.battlefield.find(card => sameCardObject(card, object.source));
  const group = pending?.targetGroups?.find(value => value.id === groupId);
  if (!pending || !source || !group) return;

  const to = { targetType: from.targetType, cardUuid: source.uuid, zone: source.state.zone, zoneRevision: source.state.zoneRevision ?? 0 };
  if (!structuralTargetLegal(room, pending.controllerId, to, group.targeting)) return;
  const sourceInfo = resolveSourceInformation(room, pending);
  if (!PermissionRegistry.canTarget(room, pending.controllerId, sourceInfo.card, [to])) return;

  const redirect: Redirect = { type: 'RETARGET_STACK', stackUuid, groupId, from, to };
  return replaceStackTarget(pending, redirect) !== pending ? redirect : undefined;
}
