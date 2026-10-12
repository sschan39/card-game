import type { CardInstance } from '../types/card.types';
import type { GameRoom } from '../types/game.room.types';
import type { ContinuousEffectEntry } from '../types/continuous-effect.types';
import { CardCharacteristicService } from './card-characteristic-service';
import { characteristicScope, scopeMatches } from './effect-scopes';
import { createBoardNumericContext, requireCharacteristicNumber } from './numeric-characteristics';
import { assertContinuousNumericDefinition, assertNoNumericExpressions } from './numeric-definitions';
export { characteristicScope, scopeMatches } from './effect-scopes';

export function nextEffectTimestamp(room: GameRoom): number {
  return Math.max(room.effectTimestamp ?? 0, ...room.continuousEffectPool.map(e => e.timestamp ?? 0), ...roomCards(room).map(c => c.state.characteristicTimestamp ?? 0)) + 1;
}
export function nextEffectSequence(room: GameRoom): number {
  let sequence = (room.effectSequence ?? 0) + 1;
  while (room.continuousEffectPool.some(e => e.id === `effect:${room.roomId}:${sequence}`)) sequence++;
  return sequence;
}
/** Capture creation identity and freeze the affected set of resolved characteristics. */
export function normalizeContinuousEntry(room: GameRoom, entry: ContinuousEffectEntry): ContinuousEffectEntry {
  assertContinuousNumericDefinition(entry.effect);
  const { effect: _effect, ...entryFields } = entry;
  assertNoNumericExpressions(entryFields);
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
    const context = createBoardNumericContext({ cards, characteristics: card => CardCharacteristicService.resolve(room, card),
      source, controllerId: controller, fields: { controller: controller ? room.players[controller] : undefined }, defaultCountZones: ['battlefield'] });
    const resolveNumber = (value: import('../types/continuous-effect.types').CharacteristicNumber | undefined) => value === undefined ? undefined : requireCharacteristicNumber(value, context);
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
