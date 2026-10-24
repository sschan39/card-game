import type { CardInstance } from '../types/card.types';
import type { GameRoom } from '../types/game.room.types';
import { CardCharacteristicService } from '../engine/card-characteristic-service';

/** Protection's source qualities are shared by targeting, damage and attachments. */
export function protectionApplies(room: GameRoom, protectedCard: CardInstance, source: CardInstance): boolean {
  const value = CardCharacteristicService.resolve(room, source);
  const qualities = [...value.colors, ...value.cardTypes, ...value.subTypes,
    ...value.cardTypes.map(type => type + 's'), ...value.subTypes.map(type => type + 's'),
    value.colors.length === 0 ? 'colorless' : value.colors.length === 1 ? 'monocolored' : 'multicolored'].map(s => s.toLowerCase());
  return CardCharacteristicService.resolveKeywords(room, protectedCard).some(keyword => {
    const normalized = keyword.toLowerCase();
    return normalized === 'protection from everything' || qualities.some(quality => normalized === `protection from ${quality}`);
  });
}
