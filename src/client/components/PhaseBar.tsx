import { useGameStore, selectCurrentPhase, selectIsMyTurn, selectHasPriority, selectRpsWaitingForOpponent } from '../store/gameStore';
import { useGameActions } from '../hooks/useGameActions';
import { ACTION_IDS } from '../../types/action.ids';
import type { GameStateName } from '../../types/game.state.types';

const PHASE_LABELS: Record<GameStateName, string> = {
  waiting: 'Waiting for opponent',
  RPS: 'Rock-Paper-Scissors',
  stateTurnStart: 'Untap Step',
  stateDrawPhase: 'Draw Step',
  stateMainPhase: 'Main Phase',
  stateBattlePhase: 'Battle Phase',
  endCombat: 'End of Combat',
  stateEndPhase: 'End Step',
  cleanupStep: 'Cleanup Step',
  Stack: 'Resolving Stack',
  gameOver: 'Game Over',
};

export default function PhaseBar() {
  const phase = useGameStore(selectCurrentPhase);
  const isMyTurn = useGameStore(selectIsMyTurn);
  const hasPriority = useGameStore(selectHasPriority);
  const waitingForOpponent = useGameStore(selectRpsWaitingForOpponent);
  const { playerAction } = useGameActions();

  const phaseLabel = phase ? PHASE_LABELS[phase] ?? phase : '—';

  return (
    <div className="phase-bar">
      <p>Phase: <strong>{phaseLabel}</strong></p>
      {waitingForOpponent && <p className="rps-waiting">Waiting for opponent…</p>}
      {phase !== 'RPS' && (
        <div className="phase-actions">
          {/* End Turn: only the turn player can end their turn */}
          {isMyTurn && (
            <button onClick={() => playerAction(ACTION_IDS.endTurn)}>End Turn</button>
          )}
          {/* Pass Priority: whoever has priority can pass (MTG 116.3d) */}
          {hasPriority && (
            <button onClick={() => playerAction(ACTION_IDS.passPriority)}>Pass Priority</button>
          )}
          {/* Resolve Stack: whoever has priority can resolve (MTG 116.4) */}
          {hasPriority && phase === 'Stack' && (
            <button onClick={() => playerAction(ACTION_IDS.resolveStack)}>Resolve Stack</button>
          )}
        </div>
      )}
    </div>
  );
}