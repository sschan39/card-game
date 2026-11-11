import type { GameRoom } from '../../types/game.room.types';
import type { StackObject } from '../../types/effect.types';
import { CardCharacteristicService } from '../card-characteristic-service';
import { resolveSourceInformation } from '../source-information';

/** Battlefield protection applies when the action is announced, including hand abilities. */
export function isImmediateAction(room: GameRoom, object: StackObject): boolean {
  // Non-spell objects can opt in directly via their ability definition.
  if (object.type !== 'spell' && object.ability?.immediate) return true;

  // Spells qualify when their source is a creature and the controller owns a
  // permanent granting ImmediateFriendlyCreatures.
  const source = resolveSourceInformation(room, object).card;

  return CardCharacteristicService.resolveTypes(room, source).includes('Creature') && room.battlefield.some((card) =>
    CardCharacteristicService.resolveController(room, card) === object.controllerId &&
    CardCharacteristicService.resolveKeywords(room, card).includes('ImmediateFriendlyCreatures'));
}

/** The common resolution payload is retained without inserting it into the stack. */
export function immediateAction(room: GameRoom, object: StackObject): StackObject {
  // Non-spells keep their source as-is; only the immediate flag is added.
  if (object.type !== 'spell') return { ...object, immediate: true };

  // Spells resolve against the live hand copy when it is still there, so the
  // payload reflects the card's current state rather than a stale snapshot.
  const source = room.players[object.controllerId]?.hand.find((card) => card.uuid === object.source.uuid) ?? object.source;

  return { ...object, source, immediate: true };
}
