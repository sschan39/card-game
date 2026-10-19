import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { Phase } from '../types/game.state.types';
import type { ActionSpeed } from '../types/effect.types';

/** The phase bar and recent-action summaries share the same display names. */
export const PHASE_LABELS: Record<Phase, string> = {
  stateTurnStart: 'Untap Step', upkeepStep: 'Upkeep Step', stateDrawPhase: 'Draw Step',
  stateMainPhase: 'Precombat Main', postcombatMainPhase: 'Postcombat Main',
  beginCombatStep: 'Beginning of Combat', declareAttackersStep: 'Declare Attackers',
  declareBlockersStep: 'Declare Blockers', combatDamageStep: 'Combat Damage',
  endCombatStep: 'End of Combat', stateEndPhase: 'End Step', cleanupStep: 'Cleanup Step',
};

export function isMainPhase(phase: Phase): boolean {
  return phase === 'stateMainPhase' || phase === 'postcombatMainPhase';
}

/** Timing only; priority and action permissions are checked by the action validator. */
export function isActionTimingAllowed(room: GameRoom, playerId: PlayerId, speed: ActionSpeed = 'instant'): boolean {
  return speed === 'instant' || (room.stack.length === 0 && isMainPhase(room.phase) && room.activeTurnPlayerId === playerId);
}

/** Turn-based declaration owner; independent of priority for responses afterward. */
export function declarationPlayer(room: GameRoom): PlayerId | null {
  if (room.phase === 'declareAttackersStep' && !room.combatDeclarations?.attackers) return room.activeTurnPlayerId;
  if (room.phase === 'declareBlockersStep' && !room.combatDeclarations?.blockers) {
    return room.activeTurnPlayerId === room.player1Id ? room.player2Id ?? null : room.player1Id;
  }
  return null;
}
