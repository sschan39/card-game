import type { GameRoom } from '../types/game.room.types';
import type { CardInstance, CardBlueprint } from '../types/card.types';
import { resolveCharacteristics } from './characteristic-layers';

/** Shared read-only facade. Printed blueprints and card state remain unchanged. */
export const CardCharacteristicService = {
  resolveBlueprint: (room: GameRoom, card: CardInstance): CardBlueprint => ({ ...card.blueprint, ...resolveCharacteristics(room, card) }),
  resolveCopiableBlueprint: (room: GameRoom, card: CardInstance): CardBlueprint => ({ ...card.blueprint, ...resolveCharacteristics(room, card, 1) }),
  resolve: resolveCharacteristics,
  resolvePower: (room: GameRoom, card: CardInstance) => resolveCharacteristics(room, card).power,
  resolveToughness: (room: GameRoom, card: CardInstance) => resolveCharacteristics(room, card).toughness,
  resolveKeywords: (room: GameRoom, card: CardInstance) => resolveCharacteristics(room, card).keywords,
  resolveTypes: (room: GameRoom, card: CardInstance) => resolveCharacteristics(room, card).cardTypes,
  resolveSubTypes: (room: GameRoom, card: CardInstance) => resolveCharacteristics(room, card).subTypes,
  resolveColors: (room: GameRoom, card: CardInstance) => resolveCharacteristics(room, card).colors,
  resolveAbilities: (room: GameRoom, card: CardInstance) => resolveCharacteristics(room, card).abilities,
  resolveController: (room: GameRoom, card: CardInstance) => resolveCharacteristics(room, card).controllerId,
};
