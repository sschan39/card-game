import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CardDetail, CardSurface, cardArt } from '@card-game/ui';
import type { ComponentProps } from 'react';
import type { CardFaceView } from '@card-game/protocol';

type Props = Omit<ComponentProps<typeof CardSurface>, 'card' | 'art' | 'showRules'> & {
  card: CardFaceView & { subTypes?: readonly string[] };
  detailNotes?: () => string[];
};

const HOLD_MS = 500;
const MOVE_TOLERANCE = 8;

export function MatchCardFace({
  card, className, detailNotes, onClick, onContextMenu, onKeyDown, tabIndex = 0, ...props
}: Props) {
  const [detail, setDetail] = useState<{ origin: DOMRect; notes?: string[] } | null>(null);
  const press = useRef<{ timer: number; x: number; y: number; id: number; touch: boolean } | null>(null);
  const suppressClick = useRef(false);
  const cancelPress = useCallback(() => {
    if (!press.current) return;
    window.clearTimeout(press.current.timer);
    press.current = null;
  }, []);
  const close = useCallback(() => setDetail(null), []);
  useEffect(() => cancelPress, [cancelPress]);

  const inspect = (element: HTMLElement) => {
    setDetail({ origin: element.getBoundingClientRect(), notes: detailNotes?.() });
  };
  const face = { ...card, manaCost: card.manaCost ?? '' };
  const art = cardArt(card.definitionId);
  return <>
    <CardSurface {...props} card={face} art={art} showRules={false}
      className={`match-card-face ${className ?? ''}`.trim()} tabIndex={tabIndex}
      aria-label={props['aria-label'] ?? card.name}
      aria-keyshortcuts="I"
      onPointerDown={event => {
        if (!event.isPrimary || press.current) return;
        if (event.button !== 0) {
          suppressClick.current = false;
          return;
        }
        suppressClick.current = false;
        const element = event.currentTarget;
        const { clientX: x, clientY: y, pointerId: id, pointerType } = event;
        press.current = { x, y, id, touch: pointerType === 'touch', timer: window.setTimeout(() => {
          press.current = null;
          suppressClick.current = true;
          element.setPointerCapture(id);
          inspect(element);
        }, HOLD_MS) };
      }}
      onPointerMove={event => {
        const active = press.current;
        if (active?.id === event.pointerId &&
            Math.hypot(event.clientX - active.x, event.clientY - active.y) > MOVE_TOLERANCE) cancelPress();
      }}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onPointerCancel={cancelPress}
      onContextMenu={event => {
        if (press.current?.touch || suppressClick.current) {
          event.preventDefault();
          event.stopPropagation();
        } else onContextMenu?.(event);
      }}
      onClick={event => {
        if (suppressClick.current && event.detail !== 0) {
          suppressClick.current = false;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        onClick?.(event);
      }}
      onKeyDown={event => {
        if (event.key.toLowerCase() === 'i' && !event.altKey && !event.ctrlKey && !event.metaKey) {
          event.preventDefault();
          event.stopPropagation();
          if (!event.repeat) inspect(event.currentTarget);
        } else if (props.role === 'button' && onClick && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          if (!event.repeat) event.currentTarget.click();
        } else onKeyDown?.(event);
      }} />
    {detail && createPortal(
      <div onClick={event => event.stopPropagation()} onContextMenu={event => event.stopPropagation()}>
        <CardDetail card={face} art={art} origin={detail.origin} notes={detail.notes} showCloseButton onClose={close} />
      </div>, document.body)}
  </>;
}
