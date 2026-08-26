import { useGameStore, selectMyPlayerId, selectIsMyTurn } from '../store/gameStore';

export default function PlayerInfo() {
  const myPlayerId = useGameStore(selectMyPlayerId);
  const isMyTurn = useGameStore(selectIsMyTurn);
  const player = useGameStore((s) => (s.room && myPlayerId ? s.room.players[myPlayerId] : null));

  if (!player) return <div className="player-info">You</div>;

  return (
    <div className="player-info">
      <h3>You {isMyTurn ? '(your turn)' : ''}</h3>
      <p>Life: {player.life}</p>
      <p>
        Mana:{' '}
        {Object.entries(player.mana)
          .filter(([, v]) => v > 0)
          .map(([color, v]) => `${color}:${v}`)
          .join(' ') || 'none'}
      </p>
    </div>
  );
}