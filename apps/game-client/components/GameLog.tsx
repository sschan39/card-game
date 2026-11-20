import { useShallow } from 'zustand/react/shallow';
import { useGameStore } from '../store/gameStore';
import { CATALOGS, useT, type MessageKey } from '@card-game/ui';
import { actionLabel } from '../display-labels';

const EMPTY_LOG: never[] = [];

export default function GameLog() {
  const t = useT();
  const log = useGameStore(useShallow((s) => s.log ?? EMPTY_LOG));

  return (
    <div className="game-log">
      <h3>{t('board.gameLog')}</h3>
      <div className="log-entries">
        {log.length === 0 && <p>{t('board.logEmpty')}</p>}
        {log.map((entry, i) => (
          <div key={i} className="log-entry" title={entry.commandId ? t('board.logCommand', { commandId: entry.commandId }) : undefined}>
            <span className="log-seq">#{entry.seq}</span>
            <span className="log-action">
              {entry.action ? actionLabel(entry.action, t) : t('board.logSnapshot')}
            </span>
            <span className="log-player">{entry.playerId ? ` ${t('board.logBy', { player: entry.playerId.slice(0, 8) })}` : ''}</span>
            <span className="log-changes">({t('board.logChanges', { count: entry.changes })})</span>
            {entry.summary && <div className="log-summary">{entry.summaryKey && CATALOGS.en[`log.${entry.summaryKey}` as MessageKey] ? t(`log.${entry.summaryKey}` as MessageKey, entry.summaryParams) : entry.summary}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
