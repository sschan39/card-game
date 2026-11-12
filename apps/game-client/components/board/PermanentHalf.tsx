import { useMemo, useState } from 'react';
import type { CardView } from '@card-game/protocol';
import CardComponent from '../CardComponent';
import { useElementSize } from '../../hooks/useElementSize';
import { boardCardWidth, planDensity } from '../../layout/density';
import { CATEGORY_LABELS, groupPermanents, groupTokens, type PermanentCategory } from '../../layout/grouping';
import type { PreviewRequest } from './CardPreview';
import { cardAnchor } from '../../presentation/board-anchors';
import { PermanentStatus } from './PermanentStatus';

interface Slot {
  key: string;
  cards: CardView[];
}

interface PermanentHalfProps {
  cards: CardView[];
  side: 'you' | 'opponent';
  onPreview: (request: PreviewRequest | null) => void;
}

/**
 * One player's half of the battlefield.
 *
 * Measures itself, asks the density engine how wide a card should be, then
 * renders one band per permanent category. Identical tokens collapse into a
 * counted stack that expands on click — the stack is a view over the same
 * cards, never a replacement for them.
 */
export default function PermanentHalf({ cards, side, onPreview }: PermanentHalfProps) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const bands = useMemo(() => groupPermanents(cards), [cards]);

  // Every band shares the half's height, so the card is sized against the
  // height one band actually gets. Without this a half showing creatures and
  // lands sizes both rows as if each owned the whole half and the lower band
  // is clipped.
  const cardWidth = boardCardWidth({
    width: size.width,
    height: size.height,
    bands: Math.max(1, bands.length),
  });
  const availableWidth = Math.max(0, size.width - 20);

  const toggleStack = (key: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const slotsFor = (category: PermanentCategory, bandCards: CardView[]): Slot[] =>
    groupTokens(bandCards).flatMap((group) =>
      group.cards.length > 1 && !expanded.has(group.key)
        ? [{ key: group.key, cards: group.cards }]
        : group.cards.map((card) => ({ key: card.uuid, cards: [card] })),
    );

  const preview = (event: React.MouseEvent<HTMLDivElement>, card: CardView) =>
    onPreview({ card, rect: event.currentTarget.getBoundingClientRect() });

  return (
    <div className={`board-half board-half-${side}`} ref={ref}>
      {bands.length === 0 && (
        <p className="board-half-empty">
          {side === 'you' ? 'Your Permanents' : "Opponent's Permanents"} — empty
        </p>
      )}
      {bands.map((band) => {
        const slots = slotsFor(band.category, band.cards);
        const plan = planDensity({ count: slots.length, availableWidth, cardWidth });
        return (
          <section className={`permanent-band permanent-band-${band.category}`} key={band.category}>
            <h4 className="permanent-band-caption">
              {CATEGORY_LABELS[band.category]}
              <span className="permanent-band-count">{band.cards.length}</span>
            </h4>
            <div
              className={`permanent-row permanent-row-${plan.mode}${plan.scroll ? ' is-scroll' : ''}`}
              style={{ ['--card-w' as string]: `${cardWidth}px` }}
            >
              {plan.rows.map((rowPlan) => (
                <div
                  className="permanent-line"
                  key={rowPlan.start}
                  style={{ ['--step' as string]: `${rowPlan.step}px` }}
                >
                  {slots.slice(rowPlan.start, rowPlan.start + rowPlan.count).map((slot) => {
                    const card = slot.cards[0];
                    const stacked = slot.cards.length > 1;
                    return (
                      <div
                        className={`permanent-slot${stacked ? ' is-stack' : ''}`}
                        key={slot.key}
                        data-board-anchor={cardAnchor('battlefield', card)}
                        tabIndex={0}
                        onMouseEnter={(event) => preview(event, card)}
                        onMouseLeave={() => onPreview(null)}
                        onFocus={(event) => onPreview({ card, rect: event.currentTarget.getBoundingClientRect() })}
                        onBlur={() => onPreview(null)}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return;
                          event.preventDefault();
                          if (stacked) toggleStack(slot.key);
                          else (event.currentTarget.firstElementChild as HTMLElement | null)?.click();
                        }}
                      >
                        <CardComponent card={card} zone="battlefield" />
                        <PermanentStatus counters={card.state.counters} />
                        {stacked && (
                          <button
                            type="button"
                            className="stack-badge"
                            aria-label={`${slot.cards.length} identical permanents, expand`}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleStack(slot.key);
                            }}
                          >
                            ×{slot.cards.length}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
