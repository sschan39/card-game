import type { Phase } from '@card-game/engine/types/game.state.types';
import type { TargetPointer } from '@card-game/engine/types/effect.types';
import type { PlayerView } from './views/player-view';
export const PHASE_LABELS: Record<Phase, string> = {
  stateTurnStart: 'Untap Step', upkeepStep: 'Upkeep Step', stateDrawPhase: 'Draw Step',
  stateMainPhase: 'Precombat Main', postcombatMainPhase: 'Postcombat Main',
  beginCombatStep: 'Beginning of Combat', declareAttackersStep: 'Declare Attackers',
  declareBlockersStep: 'Declare Blockers', combatDamageStep: 'Combat Damage',
  endCombatStep: 'End of Combat', stateEndPhase: 'End Step', cleanupStep: 'Cleanup Step',
};
export const targetKey = (target: TargetPointer) => [target.targetType, target.targetType === 'player' ? target.playerId : target.targetType === 'stack' || target.targetType === 'spell' ? target.stackUuid : target.cardUuid].join(':');
export const declarationPlayer = (view: Pick<PlayerView, 'declarationPlayerId'>) => view.declarationPlayerId;
