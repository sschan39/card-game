import { useShallow } from 'zustand/react/shallow';
import { useGameStore } from '../store/gameStore';
import { ACTION_ID_LABELS } from '../../types/action.ids';

const EMPTY_LOG: never[] = [];

export default function GameLog() {
  const log = useGameStore(useShallow((s) => s.log ?? EMPTY_LOG));

  return (
    <div className="game-log">
      <h3>Game Log</h3>
      <div className="log-entries">
        {log.length === 0 && <p>No events yet.</p>}
        {log.map((entry, i) => (
          <div key={i} className="log-entry">
            <span className="log-seq">#{entry.seq}</span>
            <span className="log-action">
              {entry.action ? ACTION_ID_LABELS[entry.action as keyof typeof ACTION_ID_LABELS] ?? entry.action : 'snapshot'}
            </span>
            <span className="log-player">{entry.playerId ? ` by ${entry.playerId.slice(0, 8)}` : ''}</span>
            <span className="log-changes">({entry.changes} changes)</span>
          </div>
        ))}
      </div>
    </div>
  );
}