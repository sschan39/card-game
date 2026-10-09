import type { CardInstance } from '../types/card.types';
import type { GameRoom } from '../types/game.room.types';
import type { CardCharacteristics, ContinuousEffectEntry, EffectScope } from '../types/continuous-effect.types';
import { CardCharacteristicService } from './card-characteristic-service';

export function nextEffectTimestamp(room: GameRoom): number {
  return Math.max(room.effectTimestamp ?? 0, ...room.continuousEffectPool.map(e => e.timestamp ?? 0), ...roomCards(room).map(c => c.state.characteristicTimestamp ?? 0)) + 1;
}
export function nextEffectSequence(room: GameRoom): number {
  let sequence = (room.effectSequence ?? 0) + 1;
  while (room.continuousEffectPool.some(e => e.id === `effect:${room.roomId}:${sequence}`)) sequence++;
  return sequence;
}
/** Broad characteristic scopes default to the battlefield; object/zone scopes are explicit. */
export function characteristicScope(scope: EffectScope): EffectScope {
  return !scope.zones && !scope.cardUuid && !scope.objects && !scope.self ? { ...scope, zones: ['battlefield'] } : scope;
}

/** Capture creation identity and freeze the affected set of resolved characteristics. */
export function normalizeContinuousEntry(room: GameRoom, entry: ContinuousEffectEntry): ContinuousEffectEntry {
  const cards = roomCards(room);
  const source = cards.find(c => c.uuid === entry.source && (entry.sourceRevision === undefined || (c.state.zoneRevision ?? 0) === entry.sourceRevision));
  const origin = entry.origin ?? (entry.requiredZone === null ? 'resolved' : 'static');
  const timestamp = entry.timestamp ?? nextEffectTimestamp(room);
  const sequence = nextEffectSequence(room);
  const controller = entry.sourceControllerId ?? (source ? CardCharacteristicService.resolveController(room, source) : undefined);
  const scope = origin === 'resolved' && entry.effect.type !== 'PERMISSION' && !entry.scope.objects ? {
    objects: cards.filter(c => scopeMatches(characteristicScope(entry.scope), c, CardCharacteristicService.resolve(room, c), source, controller))
      .map(c => ({ cardUuid: c.uuid, zoneRevision: c.state.zoneRevision ?? 0 })),
  } : entry.scope;
  let effect = structuredClone(entry.effect);
  if (origin === 'resolved' && (effect.type === 'SET_STATS' || effect.type === 'STAT_DELTA')) {
    const resolveNumber = (value: import('../types/continuous-effect.types').CharacteristicNumber | undefined) => typeof value !== 'object' || !value ? value :
      cards.filter(c => scopeMatches({ zones: ['battlefield'], ...value.count }, c, CardCharacteristicService.resolve(room, c), source, controller)).length * (value.multiply ?? 1) + (value.add ?? 0);
    if (effect.type === 'SET_STATS') effect = { ...effect, power: resolveNumber(effect.power)!, toughness: resolveNumber(effect.toughness)! };
    else effect = { ...effect, power: resolveNumber(effect.power), toughness: resolveNumber(effect.toughness) };
  }
  return { ...structuredClone(entry), effect, id: entry.id ?? `effect:${room.roomId}:${sequence}`, timestamp, origin, scope,
    requiredZone: entry.requiredZone === undefined && origin === 'resolved' ? null : entry.requiredZone,
    sourceRevision: entry.sourceRevision ?? source?.state.zoneRevision ?? (source ? 0 : undefined), sourceControllerId: controller };
}

export function roomCards(room: GameRoom): CardInstance[] {
  const cards = [...room.battlefield, ...room.stack.filter(s => s.type === 'spell').map(s => s.source),
    ...Object.values(room.players).flatMap(p => [...p.hand, ...p.graveyard, ...p.deck, ...p.exile ?? []])];
  return [...new Map(cards.map(c => [c.uuid, c])).values()];
}
export function effectSource(cards: CardInstance[], entry: ContinuousEffectEntry): CardInstance | undefined {
  return cards.find(c => c.uuid === entry.source && (entry.sourceRevision === undefined || (c.state.zoneRevision ?? 0) === entry.sourceRevision) &&
    (entry.requiredZone == null || c.state.zone === entry.requiredZone));
}
export function effectIsActive(cards: CardInstance[], entry: ContinuousEffectEntry): boolean {
  const sourceDuration = entry.duration === 'WHILE_ON_BATTLEFIELD' || entry.duration === 'WHILE_ATTACHED';
  if (sourceDuration) {
    const source = effectSource(cards, { ...entry, requiredZone: 'battlefield' });
    return !!source && (entry.duration !== 'WHILE_ATTACHED' || !!source.state.attachedTo);
  }
  if (entry.requiredZone === null || (entry.origin === 'resolved' && entry.requiredZone === undefined) || entry.source === 'global' || entry.source === 'emblem') return true;
  const source = effectSource(cards, { ...entry, requiredZone: entry.requiredZone ?? 'battlefield' });
  if (!source) return false;
  return true;
}
export function scopeMatches(scope: EffectScope, card: CardInstance, value: CardCharacteristics,
  source: CardInstance | undefined, controller: string | undefined): boolean {
  if (scope.self && card.uuid !== source?.uuid) return false;
  if (scope.cardUuid && card.uuid !== scope.cardUuid) return false;
  if (scope.zoneRevision !== undefined && (card.state.zoneRevision ?? 0) !== scope.zoneRevision) return false;
  if (scope.objects && !scope.objects.some(o => o.cardUuid === card.uuid && o.zoneRevision === (card.state.zoneRevision ?? 0))) return false;
  if (scope.zones?.length && !scope.zones.includes(card.state.zone)) return false;
  if (scope.cardTypes?.length && !scope.cardTypes.some(t => value.cardTypes.includes(t))) return false;
  if (scope.subTypes?.length && !scope.subTypes.some(t => value.subTypes.includes(t))) return false;
  if (scope.colors?.length && !scope.colors.some(t => value.colors.includes(t))) return false;
  if (scope.controller === 'self' && value.controllerId !== controller) return false;
  if (scope.controller === 'opponent' && (!controller || value.controllerId === controller)) return false;
  return true;
}
