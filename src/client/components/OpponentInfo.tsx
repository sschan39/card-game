import { useGameStore, selectOpponentId, selectOpponentHandCount } from '../store/gameStore';

export default function OpponentInfo() {
  const opponentId = useGameStore(selectOpponentId);
  const handCount = useGameStore(selectOpponentHandCount);
  const opponent = useGameStore((s) => (s.room && opponentId ? s.room.players[opponentId] : null));

  if (!opponent) return <div className="opponent-info">Opponent</div>;

  return (
    <div className="opponent-info">
      <h3>Opponent</h3>
      <p>Life: {opponent.life}</p>
      <p>Hand: {handCount} cards</p>
      <p>Deck: {opponent.deck.length}</p>
      <p>Graveyard: {opponent.graveyard.length}</p>
    </div>
  );
}