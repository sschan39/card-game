// src/engine/state-based-actions.ts
// State-Based Actions (SBA) — checked after every mutation batch.
// Hearthstone-style: creatures die when damageTaken >= toughness.
// Players lose when life <= 0.
//
// MTG CR 704.3: SBAs are checked whenever a player would receive priority.
// We check them after each mutation batch in GameEngine.applyMutations().

import { CardCharacteristicService } from './card-characteristic-service';
import type { GameMutation } from '../types/game-mutation.types';
import type { GameRoom, PlayerLoss } from '../types/game.room.types';

/**
 * Check all state-based actions and return mutations to apply.
 * Pure function — does not mutate the room.
 *
 * Player losses end the game before further creature/trigger processing.
 * Otherwise, creatures with lethal damage move to their owners' graveyards.
 */
export function checkStateBasedActions(room: GameRoom): GameMutation[] {
  if (room.status === 'gameOver' || room.outcome) return [];
  const players = Object.values(room.players);
  const losses: PlayerLoss[] = players
    .filter(player => player.life <= 0)
    .map(player => ({ playerId: player.id, reason: 'life_total' }));
  if (losses.length > 0) {
    const survivors = players.filter(player => player.life > 0);
    return [{
      type: 'END_GAME',
      outcome: survivors.length === 1
        ? { type: 'win', winnerId: survivors[0].id, losses }
        : { type: 'draw', losses },
    }];
  }
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

  return mutations;
}
