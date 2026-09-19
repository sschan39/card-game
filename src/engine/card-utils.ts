// src/engine/card-utils.ts
import type { CardInstance } from '../types/card.types';
import type { GameRoom } from '../types/game.room.types';
import { CardCharacteristicService } from './card-characteristic-service';

/**
 * Check if a card has a specific keyword (e.g. 'Flying', 'Trample').
 * Keywords are stored on the card's blueprint.
 */
export function hasKeyword(card: CardInstance, keyword: string): boolean {
  return card.blueprint.keywords?.includes(keyword) ?? false;
}

/**
 * Compute the lethal damage threshold for a creature (CR 510.1c).
 * Seam: deathtouch and damage prevention hook in here later.
 * Currently: toughness minus already-marked damage.
 */
export function lethalDamageFor(room: GameRoom, card: CardInstance): number {
  return Math.max(0,
    CardCharacteristicService.resolveToughness(room, card)
    - (card.state.damageTaken || 0)
  );
}