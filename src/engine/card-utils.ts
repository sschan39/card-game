// src/engine/card-utils.ts
import type { CardInstance } from '../types/card.types';

/**
 * Check if a card has a specific keyword (e.g. 'Flying', 'Trample').
 * Keywords are stored on the card's blueprint.
 */
export function hasKeyword(card: CardInstance, keyword: string): boolean {
  return card.blueprint.keywords?.includes(keyword) ?? false;
}