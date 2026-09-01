import type { CardInstance } from '../../types/card.types';
import { useGameActions } from '../hooks/useGameActions';
import { useGameStore, selectCurrentPhase } from '../store/gameStore';
// import { getEffectivePower, getEffectiveToughness } from '../../engine/stat-resolver';
// Deferred: client-side characteristic resolution. For now, read blueprint directly.

interface CardComponentProps {
  card: CardInstance;
  zone: 'hand' | 'battlefield';
}

export default function CardComponent({ card, zone }: CardComponentProps) {
  const { getOptions, playerAction } = useGameActions();
  const showContextMenu = useGameStore((s) => s.showContextMenu);
  const phase = useGameStore(selectCurrentPhase);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    // Request options from server; the response triggers showContextMenu
    getOptions(card.uuid, zone);
  };

  const handleClick = (e: React.MouseEvent) => {
    // Simple click: if in hand, play the card
    if (zone === 'hand') {
      if (phase === 'RPS') {
        playerAction('rpsPlay', card.uuid);
      } else {
        playerAction('cast_spell', card.uuid);
      }
    }
  };

  return (
    <div
      className={`card ${card.state.isTapped ? 'tapped' : ''}`}
      onContextMenu={handleContextMenu}
      onClick={handleClick}
      title={card.blueprint.rulesText}
    >
      <div className="card-name">{card.blueprint.name}</div>
      {card.blueprint.power !== undefined && (
        <div className="card-stats">
          {card.blueprint.power}/{card.blueprint.toughness}
        </div>
      )}
    </div>
  );
}