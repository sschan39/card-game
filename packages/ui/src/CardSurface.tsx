import type { HTMLAttributes } from 'react';

/** Printed fields only: no engine, auth, store, or game action dependency. */
export interface CardSurfaceData {
  name: string;
  manaCost: string;
  cardTypes: readonly string[];
  rulesText: string;
  power?: number;
  toughness?: number;
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
    {card.cardTypes.length > 0 && <div className="card-type">{card.cardTypes.join(' ')}</div>}
    {card.cardTypes.includes('Creature') && <div className="card-stats">{card.power}/{card.toughness}</div>}
  </div>;
}
