import type { ReactNode } from 'react';
import { CardSurface, cardArt } from '@card-game/ui';
import type { CardFaceView } from '@card-game/protocol';

export function CardTray({ label, items }: {
  label: string;
  items: { id: string; content: ReactNode }[];
}) {
  return <div className="card-tray-scroll" role="region" aria-label={label} tabIndex={0}
    onKeyDown={event => {
      const scroll = event.currentTarget;
      if (event.target !== scroll || scroll.scrollWidth <= scroll.clientWidth) return;
      const page = scroll.clientWidth * 0.8;
      switch (event.key) {
        case 'ArrowLeft': scroll.scrollBy({ left: -page }); break;
        case 'ArrowRight': scroll.scrollBy({ left: page }); break;
        case 'Home': scroll.scrollTo({ left: 0 }); break;
        case 'End': scroll.scrollTo({ left: scroll.scrollWidth }); break;
        default: return;
      }
      event.preventDefault();
    }}>
    <ul className="card-tray">
      {items.map(({ id, content }) => <li key={id} className="card-tray-item">{content}</li>)}
    </ul>
  </div>;
}

export function TrayCardFace({ card, label }: { card: CardFaceView; label?: string }) {
  return <CardSurface card={{ ...card, manaCost: card.manaCost ?? '' }}
    art={cardArt(card.definitionId)} label={label} />;
}
