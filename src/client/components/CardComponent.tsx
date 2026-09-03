import type { CardInstance, ManaCost } from '../../types/card.types';
import { useGameActions } from '../hooks/useGameActions';
import { useGameStore, selectCurrentPhase } from '../store/gameStore';
// Deferred: client-side characteristic resolution. For now, read blueprint directly.

interface CardComponentProps {
  card: CardInstance;
  zone: 'hand' | 'battlefield';
}

// Render a ManaCost record as MTG-style symbols, e.g. {4}{R}{R}
function renderManaCost(mana: ManaCost | undefined): string {
  if (!mana) return '';
  const symbols: string[] = [];
  const order: Array<keyof ManaCost> = ['white', 'blue', 'black', 'red', 'green', 'colorless'];
  const glyph: Record<string, string> = {
    white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G', colorless: 'C',
  };
  for (const color of order) {
    const n = mana[color] ?? 0;
    for (let i = 0; i < n; i++) {
      symbols.push(`{${glyph[color]}}`);
    }
  }
  return symbols.join('');
}

export default function CardComponent({ card, zone }: CardComponentProps) {
  const { getOptions, playerAction } = useGameActions();
  const showContextMenu = useGameStore((s) => s.showContextMenu);
  const phase = useGameStore(selectCurrentPhase);

  const manaCost = card.blueprint.castRequirements?.cost?.mana;
  const manaStr = renderManaCost(manaCost);
  const typeLine = card.blueprint.cardTypes.join(' ');

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
      <div className="card-top">
        <div className="card-name">{card.blueprint.name}</div>
        {manaStr && <div className="card-mana">{manaStr}</div>}
      </div>
      {typeLine && <div className="card-type">{typeLine}</div>}
      {card.blueprint.power !== undefined && (
        <div className="card-stats">
          {card.blueprint.power}/{card.blueprint.toughness}
        </div>
      )}
    </div>
  );
}