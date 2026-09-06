// src/engine/state-based-actions.ts
// State-Based Actions (SBA) — checked after every mutation batch.
// Hearthstone-style: creatures die when damageTaken >= toughness.
// Players lose when life <= 0.
//
// MTG CR 704.3: SBAs are checked whenever a player would receive priority.
// We check them after each mutation batch in GameEngine.applyMutations().

import { CardCharacteristicService } from './card-characteristic-service';
import type { GameMutation } from '../types/game-mutation.types';
import type { GameRoom } from '../types/game.room.types';

/**
 * Check all state-based actions and return mutations to apply.
 * Pure function — does not mutate the room.
 *
 * Checks performed (in order):
 * 1. Creatures with damageTaken >= toughness → DESTROY (MOVE_CARD battlefield→graveyard)
 * 2. Players with life <= 0 → game over (SET_PHASE gameOver)
 */
export function checkStateBasedActions(room: GameRoom): GameMutation[] {
  const mutations: GameMutation[] = [];

  // 1. Destroy creatures with lethal damage
  for (const card of room.battlefield) {
    if (!card.blueprint.cardTypes.includes('Creature')) continue;

    const toughness = CardCharacteristicService.resolveToughness(room, card);
    if (card.state.damageTaken >= toughness) {
      mutations.push({
        type: 'MOVE_CARD',
        cardUuid: card.uuid,
        playerId: card.state.ownerId,
        from: 'battlefield',
        to: 'graveyard',
      });
    }
  }

  // 2. Check player death
  for (const player of Object.values(room.players)) {
    if (player.life <= 0) {
      mutations.push({ type: 'SET_PHASE', phase: 'gameOver' });
      break; // Game is over, no need to check further
    }
  }

  return mutations;
}