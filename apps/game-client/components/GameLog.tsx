import { useShallow } from 'zustand/react/shallow';
import { useGameStore } from '../store/gameStore';
import { ACTION_ID_LABELS } from '@card-game/protocol';

const EMPTY_LOG: never[] = [];

export default function GameLog() {
  const log = useGameStore(useShallow((s) => s.log ?? EMPTY_LOG));
  const room = useGameStore(s => s.room);

  return (
    <div className="game-log" id="match-log">
      <h3>Game Log</h3>
      <div className="log-entries" tabIndex={0} role="region" aria-label="Game events">
        {log.length === 0 && <p>No events yet.</p>}
        {log.map((entry, i) => (
          <div key={i} className="log-entry" title={entry.commandId ? 'Command: ' + entry.commandId : undefined}>
            <span className="log-seq">#{entry.seq}</span>
            <span className="log-action">
              {entry.action ? ACTION_ID_LABELS[entry.action as keyof typeof ACTION_ID_LABELS] ?? entry.action : 'snapshot'}
            </span>
            {entry.playerId && <span className="log-player">{entry.playerId === room?.viewerId ? ' · You'
              : entry.playerId === room?.player1Id || entry.playerId === room?.player2Id ? ' · Opponent' : ''}</span>}
            {entry.summary && <div className="log-summary">{entry.summary}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
