import { useGameStore, selectCurrentPhase, selectIsMyTurn, selectRpsWaitingForOpponent } from '../store/gameStore';
import { useGameActions } from '../hooks/useGameActions';

export default function PhaseBar() {
  const phase = useGameStore(selectCurrentPhase);
  const isMyTurn = useGameStore(selectIsMyTurn);
  const waitingForOpponent = useGameStore(selectRpsWaitingForOpponent);
  const { playerAction } = useGameActions();

  return (
    <div className="phase-bar">
      <p>Phase: <strong>{phase ?? '—'}</strong></p>
      {waitingForOpponent && <p className="rps-waiting">Waiting for opponent…</p>}
      {isMyTurn && phase !== 'RPS' && (
        <div className="phase-actions">
          <button onClick={() => playerAction('end_turn')}>End Turn</button>
          <button onClick={() => playerAction('pass_priority')}>Pass Priority</button>
          <button onClick={() => playerAction('resolve_stack')}>Resolve Stack</button>
        </div>
      )}
    </div>
  );
}