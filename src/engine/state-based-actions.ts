import type { GameRoom } from '../types/game.room.types';
import type { GameMutation } from '../types/game-mutation.types';
import { planStateBasedActions } from './state-based-planner';

/** The checkpoint applies a complete batch, or persists a decision before any of it. */
export function checkStateBasedActions(room: GameRoom, pending: GameMutation[] = []): GameMutation[] {
  const plan = planStateBasedActions(room, pending);
  return plan.pendingChoice ? [{ type: 'SET_PENDING_CHOICE', choice: plan.pendingChoice }, { type: 'SET_PRIORITY', playerId: null }, { type: 'SET_ENGINE_STATE', state: 'state_based_actions' }] : plan.mutations;
}
