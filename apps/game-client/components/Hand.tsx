import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useGameStore, selectHasPriority, selectMyHand } from '../store/gameStore';
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
  const hasPriority = useGameStore(selectHasPriority);
  const [glowOff, setGlowOff] = useState(false);

  /* The halo means "the table is waiting on you". It switches off the moment a card
     is picked and only re-arms when priority comes back around. */
  useEffect(() => {
    if (!hasPriority) setGlowOff(false);
  }, [hasPriority]);
  return (
    <div className="hand">
      <h3>Your Hand ({hand.length})</h3>
      <div className="hand-cards">
        {hand.map((card, index) => {
          const option = card.actions.find(action => action.actionId === card.defaultActionId);
          const reason = option?.disabled ? option.disabledReason : undefined;
          return (
          <div className={'hand-card' + (hasPriority && !glowOff ? ' is-actionable' : '')} key={card.uuid} style={fanStyle(index, hand.length)}
            data-board-anchor={cardAnchor('hand', card)}>
            <CardComponent card={card} zone="hand" onPlayIntent={() => setGlowOff(true)} />
            {reason && <span className="hand-action-reason">{reason}</span>}
          </div>
        ); })}
      </div>
    </div>
  );
}
