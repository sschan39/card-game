import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { Phase } from '../types/game.state.types';

export function isMainPhase(phase: Phase): boolean {
  return phase === 'stateMainPhase' || phase === 'postcombatMainPhase';
}

/** Turn-based declaration owner; independent of priority for responses afterward. */
export function declarationPlayer(room: GameRoom): PlayerId | null {
  if (room.phase === 'declareAttackersStep' && !room.combatDeclarations?.attackers) return room.activeTurnPlayerId;
  if (room.phase === 'declareBlockersStep' && !room.combatDeclarations?.blockers) {
    return room.activeTurnPlayerId === room.player1Id ? room.player2Id ?? null : room.player1Id;
  }
  return null;
}
