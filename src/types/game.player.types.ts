/**
 * src/types/game.player.types.ts
 * Type-only definitions for player runtime state and resources.
 */

import type { CardInstance, ManaColor } from './card.types';

/**
 * Tracks active mana resources for a player.
 * Each ManaColor is stored as an exact number in the pool.
 */
export type ManaPool = Record<ManaColor, number>;

/**
 * Represents a single player's runtime data.
 */
export interface PlayerState {
    readonly id: string;
    health: number;
    mana: ManaPool;
    deck: CardInstance[];
    hand: CardInstance[];
    graveyard: CardInstance[];
}
