import type { GameRoom } from '../types/game.room.types';
import type { GameMutation } from '../types/game-mutation.types';
import { checkStateBasedActions } from './state-based-actions';

interface CheckpointBoundary {
  getRoom: () => GameRoom;
  apply: (mutations: GameMutation[], kind: 'state-based-action' | 'pending') => GameMutation[];
  takePending: () => GameMutation[];
  getPending?: () => GameMutation[];
  schedule?: () => GameMutation[];
}

/** Settle SBAs before scheduling discovered triggers; repeat until stable or terminal. */
export function runRulesCheckpoint(boundary: CheckpointBoundary): GameMutation[] {
  const applied: GameMutation[] = [];
  while (true) {
    const room = boundary.getRoom();
    if (room.pendingChoice) return applied;
    if (room.status === 'gameOver' || room.outcome) {
      boundary.takePending();
      return applied;
    }
    const stateBased = checkStateBasedActions(room, boundary.getPending?.());
    if (stateBased.length) {
      const changes = boundary.apply(stateBased, 'state-based-action');
      if (!changes.length) throw new Error('State-based actions made no progress');
      applied.push(...changes);
      continue;
    }
    const pending = boundary.takePending();
    if (!pending.length) {
      const scheduled = boundary.schedule?.() ?? [];
      if (!scheduled.length) return applied;
      applied.push(...scheduled);
      continue;
    }
    applied.push(...boundary.apply(pending, 'pending'));
  }
}
