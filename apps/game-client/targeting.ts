import { targetKey, type CardView, type ActionId, type PlayerView, type TargetPointer } from '@card-game/protocol';
import type { TargetingState } from './store/gameStore';
/** Candidates are resolved by the server against authoritative rules. */
export function createTargetingState(card: CardView, zone: 'hand' | 'battlefield', actionId: ActionId, data?: Record<string, unknown>, _room?: PlayerView): TargetingState | null {
  const key = actionId === 'activate_ability' ? actionId + ':' + data?.abilityId : actionId;
  const groups = card.targetGroups[key];
  return groups?.length ? { cardUuid: card.uuid, zone, actionId, data, groups, groupIndex: 0, completedGroups: [], targeting: groups[0].targeting, collected: [] } : null;
}
export function legalTarget(state: TargetingState | null, pointer: TargetPointer): TargetPointer | undefined {
  return state?.groups?.[state.groupIndex ?? 0]?.legalTargets.find(candidate => targetKey(candidate) === targetKey(pointer));
}
export function isLegalTarget(state: TargetingState | null, pointer: TargetPointer): boolean { return legalTarget(state, pointer) !== undefined; }
export function needsTargets(card: CardView) { return card.targetGroups.cast_spell?.[0]?.targeting ?? null; }

/** Rebase an unsent draft onto fresh server candidates without changing card incarnations. */
export function refreshTargeting(state: TargetingState | null, room: PlayerView): TargetingState | null {
  if (!state || room.pendingChoice || room.status !== 'playing') return null;
  const card = state.zone === 'hand' ? room.players[room.viewerId]?.hand.find(card => card.uuid === state.cardUuid)
    : room.battlefield.find(card => card.uuid === state.cardUuid);
  if (!card) return null;
  const fresh = createTargetingState(card, state.zone, state.actionId, state.data);
  if (!fresh?.groups || !state.groups || fresh.groups.map(group => group.id).join() !== state.groups.map(group => group.id).join()) return null;
  const canonical = (index: number, pointer: TargetPointer) => fresh.groups![index].legalTargets.find(candidate =>
    targetKey(candidate) === targetKey(pointer) && (pointer.zoneRevision === undefined || candidate.zoneRevision === pointer.zoneRevision));
  if (state.completedGroups?.some((group, index) => group.targets.some(pointer => !canonical(index, pointer)))) return fresh;
  const index = state.groupIndex ?? 0;
  return { ...state, groups: fresh.groups, targeting: fresh.groups[index].targeting,
    collected: state.collected.flatMap(pointer => { const next = canonical(index, pointer); return next ? [next] : []; }) };
}
