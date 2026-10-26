import { isLegalTarget } from '../targeting';
import { useGameStore, selectMyPlayerId, selectIsMyTurn, selectTargeting } from '../store/gameStore';

export default function PlayerInfo() {
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

  if (!player) return <div className="player-info">You</div>;

  return (
    <div
      className={`player-info ${isTargetable ? 'targetable' : ''} ${isSelected ? 'selected' : ''}`}
      onClick={handleClick}
    >
      <h3>You {isMyTurn ? '(your turn)' : ''}</h3>
      <p>Life: {player.life}</p>
      <p>
        Mana:{' '}
        {Object.entries(player.mana)
          .filter(([, v]) => v > 0)
          .map(([color, v]) => `${color}:${v}`)
          .join(' ') || 'none'}
      </p>
      <p>Deck: {player.deckCount}</p>
      <p>Graveyard: {player.graveyard.length}</p>
      {room?.status === 'playing' && <p>Land plays: {room.turnHistory?.landPlays?.[myPlayerId!] ?? 0}/{room.landPlayLimit}</p>}
    </div>
  );
}
