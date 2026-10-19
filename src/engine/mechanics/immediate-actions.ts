import type { GameRoom } from '../../types/game.room.types';
import type { StackObject } from '../../types/effect.types';
import { CardCharacteristicService } from '../card-characteristic-service';
import { resolveSourceInformation } from '../source-information';

/** Battlefield protection applies when the action is announced, including hand abilities. */
export function isImmediateAction(room: GameRoom, object: StackObject): boolean {
  if (object.type !== 'spell' && object.ability?.immediate) return true;
  const source = resolveSourceInformation(room, object).card;
  return CardCharacteristicService.resolveTypes(room, source).includes('Creature') && room.battlefield.some(card =>
    CardCharacteristicService.resolveController(room, card) === object.controllerId &&
    CardCharacteristicService.resolveKeywords(room, card).includes('ImmediateFriendlyCreatures'));
}

/** The common resolution payload is retained without inserting it into the stack. */
export function immediateAction(room: GameRoom, object: StackObject): StackObject {
  if (object.type !== 'spell') return { ...object, immediate: true };
  const source = room.players[object.source.state.ownerId].hand.find(card => card.uuid === object.source.uuid) ?? object.source;
  return { ...object, source, immediate: true };
}
