import { useShallow } from 'zustand/react/shallow';
import { useGameStore, selectMyHand } from '../store/gameStore';
import CardComponent from './CardComponent';
import { cardAnchor } from '../presentation/board-anchors';

/**
 * Cards fan out from the centre; the arc tightens as the hand grows and the
 * overlap deepens, so a twelve-card hand still fits the bottom edge without
 * shrinking the cards themselves.
 */
function fanStyle(index: number, count: number) {
  const middle = (count - 1) / 2;
  const offset = index - middle;
  const spread = count > 1 ? Math.min(6, 34 / count) : 0;
  const overlap = count > 9 ? '-4.2rem' : count > 7 ? '-3.2rem' : count > 5 ? '-1.8rem' : '-0.5rem';
  return {
    '--rot': `${offset * spread}deg`,
    '--pivot': offset < 0 ? '0%' : '100%',
    '--lift': `${Math.min(8, Math.max(0, middle - Math.abs(offset)) * 3)}px`,
    '--overlap': overlap,
    zIndex: index + 1,
  } as React.CSSProperties;
}

export default function Hand() {
  const hand = useGameStore(useShallow(selectMyHand));

  return (
    <div className="hand">
      <h3>Your Hand ({hand.length})</h3>
      <div className="hand-cards">
        {hand.map((card, index) => (
          <div className="hand-card" key={card.uuid} style={fanStyle(index, hand.length)}
            data-board-anchor={cardAnchor('hand', card)} role="button" tabIndex={0} aria-label={card.name}
            onKeyDown={event => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              event.currentTarget.querySelector<HTMLElement>('.card')?.click();
            }}>
            <CardComponent card={card} zone="hand" />
          </div>
        ))}
      </div>
    </div>
  );
}
