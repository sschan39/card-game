import type { GameRoom } from '../types/game.room.types';
import type { GameMutation } from '../types/game-mutation.types';
import { withCharacteristicCache } from './card-characteristic-service';
import { planStateBasedActions } from './state-based-planner';

/** The checkpoint applies a complete batch, or persists a decision before any of it. */
export function checkStateBasedActions(room: GameRoom, pending: GameMutation[] = []): GameMutation[] {
  const plan = withCharacteristicCache(room, () => planStateBasedActions(room, pending));

  // A pending choice must be recorded before any mutation lands, so the engine
  // parks itself in the state-based-actions state and waits for the answer.
  if (plan.pendingChoice) {
    return [
      { type: 'SET_PENDING_CHOICE', choice: plan.pendingChoice },
      { type: 'SET_PRIORITY', playerId: null },
      { type: 'SET_ENGINE_STATE', state: 'state_based_actions' },
    ];
  }

  // No decision needed: the whole batch can be applied atomically.
  return plan.mutations;
}
