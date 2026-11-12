import { isLegalTarget } from '../targeting';
import { useGameStore, selectOpponentId, selectOpponentHandCount, selectTargeting } from '../store/gameStore';
import { seatAnchor } from '../presentation/board-anchors';

export default function OpponentInfo() {
  const opponentId = useGameStore(selectOpponentId);
  const handCount = useGameStore(selectOpponentHandCount);
  const targeting = useGameStore(selectTargeting);
  const toggleTarget = useGameStore((s) => s.toggleTarget);
  const opponent = useGameStore((s) => (s.room && opponentId ? s.room.players[opponentId] : null));

  // Spell targeting: the opponent is a legal player target unless restricted to self.
  const isTargetable = isLegalTarget(targeting, { targetType: 'player', playerId: opponentId ?? undefined });

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
      <div className="seat-head">
        <div className="life-seal" data-board-anchor={seatAnchor('life', opponent.id)}>
          <span className="life-value">{opponent.life}<span className="sr-only"> life</span></span>
          <h3 className="life-label">Opponent</h3>
        </div>
        {handCount > 0 && <div className="opponent-hand" aria-hidden="true">
          {Array.from({ length: Math.min(handCount, 7) }, (_, index) => <span key={index} />)}
        </div>}
      </div>
      <div className="seat-body">
        <dl className="seat-stats">
          <div className="seat-zone">
            <dt>Hand</dt>
            <dd>{handCount} cards</dd>
          </div>
          <div className="seat-zone" data-board-anchor={seatAnchor('deck', opponent.id)}>
            <dt>Deck</dt>
            <dd>{opponent.deckCount}</dd>
          </div>
          <div className="seat-zone" data-board-anchor={seatAnchor('graveyard', opponent.id)}>
            <dt>Graveyard</dt>
            <dd>{opponent.graveyard.length}</dd>
          </div>
          {opponent.exile.length > 0 && <div className="seat-zone" data-board-anchor={seatAnchor('exile', opponent.id)}>
            <dt>Exile</dt>
            <dd>{opponent.exile.length}</dd>
          </div>}
        </dl>
      </div>
    </div>
  );
}
