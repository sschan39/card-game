import { useEffect, useRef, useState } from 'react';
import { CardSurface } from './CardSurface';

/**
 * Everything the inspector can print. The catalogue can fill every field; a card on
 * the table only knows what the view carries, so the extra rows simply drop out.
 */
export interface CardDetailData {
  name: string;
  manaCost: string;
  cardTypes: readonly string[];
  subTypes?: readonly string[];
  rulesText: string;
  power?: number;
  toughness?: number;
  /** Catalogue id, when the caller has one. */
  id?: string;
  colors?: readonly string[];
  deckLegal?: boolean;
  copyLimit?: number | null;
}

export interface CardDetailProps {
  card: CardDetailData;
  /** Bundled illustration for this card, when one exists. */
  art?: string;
  /** Screen rect the panel grows out of and shrinks back into. */
  origin: DOMRect;
  onClose: () => void;
}

/**
 * Read-only card inspector.
 *
 * The deck catalogue clamps rules text to three lines and the table shows even less,
 * so a card with a long ability can never be read where it sits. This panel shows the
 * whole card once: picture on the left, every known field on the right. It grows out
 * of the element it came from and shrinks back into it.
 */
export function CardDetail({ card, art, origin, onClose }: CardDetailProps) {
  const panel = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);

  const flight = () => {
    const element = panel.current;
    if (!element) return null;
    const target = element.getBoundingClientRect();
    if (!target.width || !target.height) return null;
    return {
      element,
      dx: origin.left + origin.width / 2 - (target.left + target.width / 2),
      dy: origin.top + origin.height / 2 - (target.top + target.height / 2),
      scale: Math.max(0.05, Math.min(1, origin.width / target.width)),
    };
  };

  /* Grow out of the source element: place it there first, then release. */
  useEffect(() => {
    const start = flight();
    if (!start) return;
    const { element, dx, dy, scale } = start;
    element.style.transition = 'none';
    element.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
    element.style.opacity = '0';
    void element.offsetWidth;
    element.style.transition = 'transform 260ms cubic-bezier(0.2, 0.8, 0.3, 1), opacity 180ms ease-out';
    element.style.transform = 'none';
    element.style.opacity = '1';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setClosing(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  /* Shrink back into the source before unmounting. */
  useEffect(() => {
    if (!closing) return;
    const end = flight();
    if (!end) {
      onClose();
      return;
    }
    const { element, dx, dy, scale } = end;
    element.style.transition = 'transform 220ms cubic-bezier(0.4, 0, 1, 1), opacity 200ms ease-in';
    element.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
    element.style.opacity = '0';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      onClose();
    };
    element.addEventListener('transitionend', finish, { once: true });
    const timer = window.setTimeout(finish, 320);
    return () => {
      element.removeEventListener('transitionend', finish);
      window.clearTimeout(timer);
    };
  }, [closing, onClose]);

  const typeLine = [...card.cardTypes, ...(card.subTypes ?? [])].join(' ') || '—';

  return (
    <div className="card-detail" role="dialog" aria-modal="true" aria-label={`${card.name} details`} onClick={() => setClosing(true)}>
      <div className="card-detail-panel" ref={panel} onClick={(event) => event.stopPropagation()}>
        <div className="card-detail-art">
          <CardSurface card={card} art={art} />
        </div>
        <div className="card-detail-info">
          <header>
            <h2>{card.name}</h2>
            {card.id && <p className="card-detail-id">{card.id}</p>}
          </header>
          <dl className="card-detail-facts">
            <div><dt>Cost</dt><dd>{card.manaCost || '—'}</dd></div>
            <div><dt>Type</dt><dd>{typeLine}</dd></div>
            {card.colors && <div><dt>Colour</dt><dd>{card.colors.length ? card.colors.join(', ') : 'colourless'}</dd></div>}
            <div><dt>Power / Toughness</dt><dd>{card.power ?? '—'} / {card.toughness ?? '—'}</dd></div>
            {card.deckLegal !== undefined && <div><dt>Deck legal</dt><dd>{card.deckLegal ? 'Yes' : 'No'}</dd></div>}
            {card.copyLimit !== undefined && <div><dt>Copy limit</dt><dd>{card.copyLimit === null ? 'Unlimited' : card.copyLimit}</dd></div>}
          </dl>
          <section className="card-detail-rules">
            <h3>Rules</h3>
            <p>{card.rulesText || 'No rules text.'}</p>
          </section>
        </div>
      </div>
    </div>
  );
}
