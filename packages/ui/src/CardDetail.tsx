import { useEffect, useReducer, useRef } from 'react';
import { CardSurface } from './CardSurface';
import { reduce, type TransitionTable } from './machine';
import { useT } from './i18n/context';
import { cardTypeLine, colorLine } from './i18n/vocabulary';

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

/* ───────────────────────────────────────────────────────────────────────────
   The panel used to carry a single `closing` boolean. Callers mount it without a
   `key`, so React reuses the instance when another card is opened — and the new card
   inherited `closing: true`, shrinking away before it could be read. The state is a
   table now, and `closing` can be reversed: a card opened mid-shrink grows straight
   back from wherever it is, which is what a CSS transition does when its target flips.

     closed ──OPEN──▶ opening ──OPENED──▶ open
                          ▲                 │
                          │   OPEN          │ CLOSE
                          └── closing ◀─────┘
                                 │
                              CLOSED ──▶ closed
   ─────────────────────────────────────────────────────────────────────────── */

type DetailState = 'closed' | 'opening' | 'open' | 'closing';
type DetailEvent = 'OPEN' | 'OPENED' | 'CLOSE' | 'CLOSED';

const detailStates: TransitionTable<DetailState, DetailEvent> = {
  closed: { OPEN: 'opening' },
  opening: { OPENED: 'open', CLOSE: 'closing' },
  open: { CLOSE: 'closing' },
  closing: { CLOSED: 'closed', OPEN: 'opening' },
};

const GROW_MS = 260;
const SHRINK_MS = 220;
/** Safety net for a browser that never fires `transitionend`. */
const FALLBACK_MS = 320;

/**
 * Read-only card inspector.
 *
 * The deck catalogue clamps rules text to a few lines and the table shows even less,
 * so a card with a long ability can never be read where it sits. This panel shows the
 * whole card once: picture on the left, every known field on the right. It grows out
 * of the element it came from and shrinks back into it.
 */
export function CardDetail({ card, art, origin, onClose }: CardDetailProps) {
  const t = useT();
  const panel = useRef<HTMLDivElement>(null);
  const [state, dispatch] = useReducer(
    (current: DetailState, event: DetailEvent) => reduce(detailStates, current, event),
    'closed',
  );

  /* `origin` is a fresh object on every render, so it is read through a ref: effects
     below must depend on the state, never on a rect identity. */
  const originRef = useRef(origin);
  originRef.current = origin;

  /** The first grow jumps to the source rect; later ones animate from wherever it is. */
  const placed = useRef(false);
  /** `closed` is also the initial state, so only a close that follows an open unmounts. */
  const everOpened = useRef(false);

  const flight = () => {
    const element = panel.current;
    if (!element) return null;
    const target = element.getBoundingClientRect();
    if (!target.width || !target.height) return null;
    const from = originRef.current;
    return {
      element,
      dx: from.left + from.width / 2 - (target.left + target.width / 2),
      dy: from.top + from.height / 2 - (target.top + target.height / 2),
      scale: Math.max(0.05, Math.min(1, from.width / target.width)),
    };
  };

  /* Mount: open. */
  useEffect(() => {
    dispatch('OPEN');
  }, []);

  /* A different card arriving must grow back, never inherit a shrink already in flight. */
  const cardKey = card.id ?? card.name;
  const previousKey = useRef(cardKey);
  useEffect(() => {
    if (previousKey.current === cardKey) return;
    previousKey.current = cardKey;
    placed.current = false;
    dispatch('OPEN');
  }, [cardKey]);

  /* Paint the transform for the current state. */
  useEffect(() => {
    const element = panel.current;
    if (!element) return;

    if (state === 'opening') {
      if (!placed.current) {
        const start = flight();
        if (!start) {
          dispatch('OPENED');
          return;
        }
        element.style.transition = 'none';
        element.style.transform = `translate(${start.dx}px, ${start.dy}px) scale(${start.scale})`;
        element.style.opacity = '0';
        void element.offsetWidth;
        placed.current = true;
      }
      element.style.transition = `transform ${GROW_MS}ms cubic-bezier(0.2, 0.8, 0.3, 1), opacity 180ms ease-out`;
      element.style.transform = 'none';
      element.style.opacity = '1';
      return;
    }

    if (state === 'closing') {
      const end = flight();
      if (!end) {
        dispatch('CLOSED');
        return;
      }
      element.style.transition = `transform ${SHRINK_MS}ms cubic-bezier(0.4, 0, 1, 1), opacity 200ms ease-in`;
      element.style.transform = `translate(${end.dx}px, ${end.dy}px) scale(${end.scale})`;
      element.style.opacity = '0';
    }
  }, [state]);

  /* Only the transform settles a transition: opacity finishes 20ms earlier and would
     otherwise report the shrink complete while the panel is still on its way back. */
  useEffect(() => {
    if (state !== 'opening' && state !== 'closing') return;
    const element = panel.current;
    const settle = state === 'opening' ? 'OPENED' : 'CLOSED';
    if (state === 'opening') everOpened.current = true;

    const onTransitionEnd = (event: TransitionEvent) => {
      if (event.propertyName === 'transform') dispatch(settle);
    };
    element?.addEventListener('transitionend', onTransitionEnd);
    const timer = window.setTimeout(() => dispatch(settle), FALLBACK_MS);
    return () => {
      element?.removeEventListener('transitionend', onTransitionEnd);
      window.clearTimeout(timer);
    };
  }, [state]);

  /* Reaching `closed` after an open is the caller's cue to unmount. */
  useEffect(() => {
    if (state === 'closed' && everOpened.current) onClose();
  }, [state, onClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dispatch('CLOSE');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const typeLine = cardTypeLine(card.cardTypes, card.subTypes, t);

  return (
    <div className="card-detail" role="dialog" aria-modal="true" aria-label={`${card.name} details`} onClick={() => dispatch('CLOSE')}>
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
            {card.colors && <div><dt>Colour</dt><dd>{colorLine(card.colors, t)}</dd></div>}
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
