import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { CardDetail, cardArt } from '@card-game/ui';
import type { CardView } from '@card-game/protocol';
import { useGameStore, selectHasPriority, selectMyHand } from '../store/gameStore';
import CardComponent from './CardComponent';
import { cardAnchor } from '../presentation/board-anchors';

/** Hold this long to open the inspector; drift further than the tolerance to cancel. */
const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE = 8;

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
  const [detail, setDetail] = useState<{ card: CardView; rect: DOMRect } | null>(null);
  const [glowOff, setGlowOff] = useState(false);

  /* The halo means "the table is waiting on you". It switches off the moment a card
     is picked and only re-arms when priority comes back around. */
  useEffect(() => {
    if (!hasPriority) setGlowOff(false);
  }, [hasPriority]);
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  const suppressClick = useRef(false);

  const cancelPress = () => {
    if (!press.current) return;
    window.clearTimeout(press.current.timer);
    press.current = null;
  };

  /* Press and hold to read a card: the hand only shows a clamped card face, so the
     full text has to come from somewhere. Right-click is left alone — that is still
     the play menu. */
  const startPress = (event: ReactPointerEvent<HTMLDivElement>, card: CardView) => {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    suppressClick.current = false;
    cancelPress();
    press.current = {
      x: event.clientX,
      y: event.clientY,
      timer: window.setTimeout(() => {
        press.current = null;
        suppressClick.current = true;
        setDetail({ card, rect });
      }, LONG_PRESS_MS),
    };
  };

  const movePress = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = press.current;
    if (!active) return;
    if (Math.abs(event.clientX - active.x) > MOVE_TOLERANCE || Math.abs(event.clientY - active.y) > MOVE_TOLERANCE) {
      cancelPress();
    }
  };

  return (
    <div className="hand">
      <h3>Your Hand ({hand.length})</h3>
      <div className="hand-cards">
        {hand.map((card, index) => (
          <div className={'hand-card' + (hasPriority && !glowOff ? ' is-actionable' : '')} key={card.uuid} style={fanStyle(index, hand.length)}
            data-board-anchor={cardAnchor('hand', card)} role="button" tabIndex={0} aria-label={card.name}
            onPointerDown={event => startPress(event, card)}
            onPointerMove={movePress}
            onPointerUp={cancelPress}
            onPointerLeave={cancelPress}
            onPointerCancel={cancelPress}
            onClickCapture={event => {
              if (!suppressClick.current) {
                setGlowOff(true);
                return;
              }
              suppressClick.current = false;
              event.preventDefault();
              event.stopPropagation();
            }}
            onKeyDown={event => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              event.currentTarget.querySelector<HTMLElement>('.card')?.click();
            }}>
            <CardComponent card={card} zone="hand" />
          </div>
        ))}
      </div>
      {detail && <CardDetail card={detail.card} art={cardArt(detail.card.definitionId)} origin={detail.rect} onClose={() => setDetail(null)} />}
    </div>
  );
}
