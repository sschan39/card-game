import type { HTMLAttributes } from 'react';

/** Printed fields only: no engine, auth, store, or game action dependency. */
export interface CardSurfaceData {
  name: string;
  manaCost: string;
  cardTypes: readonly string[];
  rulesText: string;
  power?: number;
  toughness?: number;
  isToken?: boolean;
}
export interface CardSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  card: CardSurfaceData;
  label?: string;
}
export function CardSurface({ card, label, className = '', ...props }: CardSurfaceProps) {
  return <div className={`card ${className}`.trim()} title={card.rulesText} {...props}>
    <div className="card-top">
      <div className="card-name">{label ?? card.name}</div>
      {card.manaCost && <div className="card-mana">{card.manaCost}</div>}
    </div>
    {(card.isToken || card.cardTypes.length > 0) && <div className="card-type">
      {card.isToken && <span className="card-token">Token </span>}{card.cardTypes.join(' ')}
    </div>}
    {card.rulesText && <div className="card-text">{card.rulesText}</div>}
    {card.cardTypes.includes('Creature') && <div className="card-stats">{card.power}/{card.toughness}</div>}
  </div>;
}
