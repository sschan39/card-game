import type { HTMLAttributes } from 'react';
import { cardColorFromMana } from './card-colors';
import { ManaCost } from './ManaCost';

/** `?card=original` puts the pre-redesign face back: no artwork, no colour tint and a
 *  plain text cost — the card exactly as it looked before this pass touched it. */
function legacyFace(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.cardFace === 'legacy';
}

export function applyCardFaceFromUrl(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.cardFace =
    new URLSearchParams(window.location.search).get('card') === 'original' ? 'legacy' : 'current';
}

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
  /**
   * Illustration for this card. It sits in its own frame above the rules box, so the
   * card keeps both the picture and the text — artwork with baked-in text would fight
   * the card copy, so the game's own name, cost and stats stay as type.
   */
  art?: string;
}
export function CardSurface({ card, label, art, className = '', ...props }: CardSurfaceProps) {
  const legacy = legacyFace();
  const name = label ?? card.name;
  /* Tint follows the card's own mana symbols, so the face reads as the colour the
     player already associates with it. */
  const color = cardColorFromMana(card.manaCost);
  const tint = legacy ? {} : { 'data-color': color };
  const illustration = legacy ? undefined : art;
  const showStats = card.cardTypes.includes('Creature');
  const status = card.isToken ? 'Token' : card.cardTypes[0];

  return <div className={`card ${className}`.trim()} {...tint} title={card.rulesText} {...props}>
    <div className="card-top">
      <span className="card-name">{name}</span>
      {card.manaCost !== '' && <span className="card-mana-row">
        {legacy ? <span className="card-mana">{card.manaCost}</span> : <ManaCost cost={card.manaCost} />}
      </span>}
    </div>
    {status && <span className="card-status">{status}</span>}
    <div className="card-art-frame">
      {illustration
        ? <img className="card-text-art" src={illustration} alt="" loading="lazy" draggable={false} />
        : <span className="card-art-empty" aria-hidden="true" />}
    </div>
    <div className="card-text">
      {card.rulesText
        ? <p className="card-rules">{card.rulesText}</p>
        : <p className="card-rules is-empty">No rules text.</p>}
    </div>
    {showStats && <div className="card-stats">{card.power}/{card.toughness}</div>}
  </div>;
}
