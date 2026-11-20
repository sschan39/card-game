import { colorLabel, useT } from '@card-game/ui';
import { isLegalTarget } from '../targeting';
import { useGameStore, selectMyPlayerId, selectIsMyTurn, selectTargeting } from '../store/gameStore';
import { seatAnchor } from '../presentation/board-anchors';

export default function PlayerInfo() {
  const t = useT();
  const myPlayerId = useGameStore(selectMyPlayerId);
  const isMyTurn = useGameStore(selectIsMyTurn);
  const targeting = useGameStore(selectTargeting);
  const toggleTarget = useGameStore((s) => s.toggleTarget);
  const player = useGameStore((s) => (s.room && myPlayerId ? s.room.players[myPlayerId] : null));
  const room = useGameStore((s) => s.room);

  // Targeting mode: is this player a legal target?
  const isTargetable = isLegalTarget(targeting, { targetType: 'player', playerId: myPlayerId ?? undefined });

  const isSelected =
    isTargetable &&
    targeting!.collected.some((t) => t.playerId === myPlayerId);

  const handleClick = () => {
    if (isTargetable && myPlayerId) {
      toggleTarget({ targetType: 'player', playerId: myPlayerId });
    }
  };

  if (!player) return <div className="player-info">{t('board.you')}</div>;

  const mana = Object.entries(player.mana).filter(([, v]) => v > 0);

  return (
    <div
      className={`player-info ${isTargetable ? 'targetable' : ''} ${isSelected ? 'selected' : ''}`}
      onClick={handleClick}
    >
      <div className="seat-head">
        <div className="life-seal" data-board-anchor={seatAnchor('life', player.id)}>
          <span className="life-value">{player.life}<span className="sr-only"> life</span></span>
          <h3 className="life-label">{t('board.you')}</h3>
        </div>
        {room?.status === 'playing' && isMyTurn && <span className="seat-turn">{t('board.yourTurn')}</span>}
      </div>
      <div className="seat-body">
        <dl className="seat-stats">
          <div className="seat-zone" data-board-anchor={seatAnchor('deck', player.id)}>
            <dt>{t('board.deck')}</dt>
            <dd>{player.deckCount}</dd>
          </div>
          <div className="seat-zone" data-board-anchor={seatAnchor('graveyard', player.id)}>
            <dt>{t('board.graveyard')}</dt>
            <dd>{player.graveyard.length}</dd>
          </div>
          {player.exile.length > 0 && <div className="seat-zone" data-board-anchor={seatAnchor('exile', player.id)}>
            <dt>{t('board.exile')}</dt>
            <dd>{player.exile.length}</dd>
          </div>}
          {room?.status === 'playing' && (
            <div>
              <dt>{t('board.landPlays')}</dt>
              <dd>{room.turnHistory?.landPlays?.[myPlayerId!] ?? 0}/{room.landPlayLimit}</dd>
            </div>
          )}
        </dl>
      </div>
      <div className="mana-pool">
        {mana.length > 0 ? (
          mana.map(([color, value]) => (
            <span
              key={color}
              className={`mana-pip mana-${color}`}
              title={t('board.mana', { value, color: colorLabel(color, t) })}
              aria-label={t('board.mana', { value, color: colorLabel(color, t) })}
            >
              {value}
            </span>
          ))
        ) : (
          <span className="mana-empty">{t('board.noMana')}</span>
        )}
      </div>
    </div>
  );
}
