import type { CardInstance, CardSnapshot } from '../types/card.types';
import type { GameRoom } from '../types/game.room.types';
import type { StackObject } from '../types/effect.types';
import { CardCharacteristicService } from './card-characteristic-service';

export function captureSourceInformation(room: GameRoom, card: CardInstance): CardSnapshot {
  return { card: structuredClone(card), power: CardCharacteristicService.resolvePower(room, card), toughness: CardCharacteristicService.resolveToughness(room, card) };
}

export function retainDepartingSource(object: StackObject, snapshot: CardSnapshot): StackObject {
  const source = object.source;
  return object.type !== 'spell' && source.uuid === snapshot.card.uuid && source.state.zone === snapshot.card.state.zone &&
    (source.state.zoneRevision ?? 0) === (snapshot.card.state.zoneRevision ?? 0) ? { ...object, sourceInfo: snapshot } : object;
}

/** Persistent UUIDs locate cards; zone/revision locate the original rules object. */
export function resolveSourceInformation(room: GameRoom, object: StackObject): CardSnapshot {
  const expected = object.source;
  const live = [...room.battlefield, ...room.stack.filter(item => item.type === 'spell').map(item => item.source),
    ...Object.values(room.players).flatMap(player => [...player.hand, ...player.graveyard, ...player.deck])]
    .find(card => card.uuid === expected.uuid && card.state.zone === expected.state.zone && (card.state.zoneRevision ?? 0) === (expected.state.zoneRevision ?? 0));
  if (live) return captureSourceInformation(room, live);
  const current = room.stack.find(item => item.uuid === object.uuid);
  const departure = object.type === 'triggered' && ['PERMANENT_LEFT', 'PERMANENT_DIED'].includes(object.triggeringEvent?.eventId ?? '')
    ? object.triggeringEvent?.payload.snapshot as CardSnapshot | undefined : undefined;
  return current?.sourceInfo ?? object.sourceInfo ?? (departure?.card.uuid === expected.uuid ? departure : undefined) ?? captureSourceInformation(room, expected);
}
