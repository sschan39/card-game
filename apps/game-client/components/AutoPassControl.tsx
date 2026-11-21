import { useGameStore } from '../store/gameStore';
import { useGameActions } from '../hooks/useGameActions';

export default function AutoPassControl() {
  const { enabled, untilTurn } = useGameStore(state => state.autoPass);
  const turnNumber = useGameStore(state => state.room?.turnNumber);
  const canSetMode = useGameStore(state => state.roomSync === 'live');
  const targeting = useGameStore(state => state.targeting);
  const { setAutoPass } = useGameActions();
  const passing = untilTurn !== undefined && untilTurn === turnNumber;

  return <div className="auto-pass-control" role="group" aria-label="Priority controls">
    <div className="priority-modes">
      <button type="button" aria-pressed={enabled && !passing} disabled={!canSetMode}
        title="Automatically pass when you have no legal plays or abilities."
        onClick={() => setAutoPass(true)}>Auto</button>
      <button type="button" aria-pressed={!enabled && !passing} disabled={!canSetMode}
        title="Stop whenever you get priority, even with no legal plays."
        onClick={() => setAutoPass(false)}>Full Control</button>
    </div>
    <button type="button" className="turn-pass" aria-pressed={passing}
      disabled={!canSetMode || (!passing && (!!targeting || turnNumber === undefined))}
      title={passing ? 'Return to your previous priority mode.' : 'Skip optional plays for the rest of this turn. Combat declarations and required choices still stop play.'}
      onClick={() => setAutoPass(enabled, passing ? undefined : turnNumber)}>
      {passing ? 'Stop passing' : 'Pass for this turn'}
    </button>
  </div>;
}
