import { useGameStore, selectOpponentId, selectOpponentHandCount, selectTargeting } from '../store/gameStore';

export default function OpponentInfo() {
  const opponentId = useGameStore(selectOpponentId);
  const handCount = useGameStore(selectOpponentHandCount);
  const targeting = useGameStore(selectTargeting);
  const toggleTarget = useGameStore((s) => s.toggleTarget);
  const opponent = useGameStore((s) => (s.room && opponentId ? s.room.players[opponentId] : null));

  // Targeting mode: is the opponent a legal target?
  const isTargetable =
    targeting !== null &&
    targeting.targeting.type === 'player' &&
    opponentId !== null &&
    (targeting.targeting.controller !== 'self'); // 'opponent' or 'any' allows targeting opponent

  const isSelected =
    isTargetable &&
    targeting!.collected.some((t) => t.playerId === opponentId);

  const handleClick = () => {
    if (isTargetable && opponentId) {
      toggleTarget({ targetType: 'player', playerId: opponentId });
    }
  };

  if (!opponent) return <div className="opponent-info">Opponent</div>;

  return (
    <div
      className={`opponent-info ${isTargetable ? 'targetable' : ''} ${isSelected ? 'selected' : ''}`}
      onClick={handleClick}
    >
      <h3>Opponent</h3>
      <p>Life: {opponent.life}</p>
      <p>Hand: {handCount} cards</p>
      <p>Deck: {opponent.deck.length}</p>
      <p>Graveyard: {opponent.graveyard.length}</p>
    </div>
  );
}