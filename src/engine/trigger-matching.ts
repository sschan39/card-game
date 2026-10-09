import type { CardInstance, TriggerFilter } from '../types/card.types';
import type { GameEvent } from '../types/game-event.types';
import type { GameRoom } from '../types/game.room.types';
import { CardCharacteristicService } from './card-characteristic-service';

/** Card events default to this object; player/step events default to its controller. */
export function triggerMatches(event: GameEvent, source: CardInstance, filter: TriggerFilter = {}, controllerId = source.state.controllerId, room?: GameRoom): boolean {
  const card = event.payload.card as CardInstance | undefined;
  const personalEvent = ['CARD_DRAWN', 'CARD_DISCARDED', 'SPELL_CAST'].includes(event.eventId);
  const subject = filter.subject ?? ((card && !personalEvent) || event.eventId === 'DAMAGE_DEALT' ? 'self' : 'any');
  const sameObject = !!card && card.uuid === source.uuid && card.state.zone === source.state.zone &&
    (card.state.zoneRevision ?? 0) === (source.state.zoneRevision ?? 0);
  if (subject === 'self' && !sameObject) return false;
  if (subject === 'another' && (!card || sameObject)) return false;
  const controller = filter.controller ?? (card && !personalEvent ? 'any' : 'self');
  const player = event.payload.controllerId ?? event.payload.playerId ?? event.payload.currentPlayer;
  if (controller !== 'any' && (typeof player !== 'string' || (controller === 'self' ? player !== controllerId : player === controllerId))) return false;
  if (filter.cardTypes?.length && (!card || !filter.cardTypes.some(type => (room ? CardCharacteristicService.resolveTypes(room, card) : card.blueprint.cardTypes).includes(type)))) return false;
  if (filter.subTypes?.length && (!card || !filter.subTypes.some(type => (room ? CardCharacteristicService.resolveSubTypes(room, card) : card.blueprint.subTypes ?? []).includes(type)))) return false;
  return true;
}
