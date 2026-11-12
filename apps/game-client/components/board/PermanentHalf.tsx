import { useMemo, useState } from 'react';
import type { CardView } from '@card-game/protocol';
import CardComponent from '../CardComponent';
import { useElementSize } from '../../hooks/useElementSize';
import { boardCardWidth, planDensity } from '../../layout/density';
import { CATEGORY_LABELS, groupPermanents, groupTokens, type PermanentGroupView } from '../../layout/grouping';
import type { PreviewRequest } from './CardPreview';
import { cardAnchor } from '../../presentation/board-anchors';
import { PermanentStatus } from './PermanentStatus';
import { permanentBadges } from '../../presentation/permanent-statuses';
import { useGameStore } from '../../store/gameStore';

interface Slot {
  cards: CardView[];
  toggle?: { key: string; size: number; open: boolean };
}

const LAND_CARD_WIDTH = 68;

interface PermanentHalfProps {
  cards: CardView[];
  side: 'you' | 'opponent';
  attachments?: ReadonlyMap<string, readonly CardView[]>;
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
export default function PermanentHalf({ cards, side, attachments, onPreview }: PermanentHalfProps) {
  const [frontRef, front] = useElementSize<HTMLDivElement>();
  const [landsRef, lands] = useElementSize<HTMLDivElement>();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const room = useGameStore(state => state.room);
  const targeting = useGameStore(state => state.targeting);
  const candidates = [
    ...targeting?.groups?.[targeting.groupIndex ?? 0]?.legalTargets ?? [],
    ...targeting?.completedGroups?.flatMap(group => group.targets) ?? [],
    ...targeting?.collected ?? [],
  ];
  const combatants = new Set(room?.combat.flatMap(group =>
    [group.attacker, ...group.blockers].map(card => cardAnchor('battlefield', card))));
  const draftingCombat = side === 'you' && room?.status === 'playing' && room.stack.length === 0 &&
    ((room.phase === 'declareAttackersStep' && room.activeTurnPlayerId === room.viewerId && !room.combatDeclarations?.attackers) ||
      (room.phase === 'declareBlockersStep' && room.activeTurnPlayerId !== room.viewerId && !room.combatDeclarations?.blockers));
  const needsIndividualSlot = (card: CardView) => combatants.has(cardAnchor('battlefield', card)) ||
    (draftingCombat && card.cardTypes.includes('Creature')) ||
    (targeting?.zone === 'battlefield' && targeting.cardUuid === card.uuid) ||
    candidates.some(target => (target.targetType === 'card' || target.targetType === 'permanent') &&
      target.cardUuid === card.uuid && (target.zoneRevision === undefined || target.zoneRevision === (card.state.zoneRevision ?? 0)));

  const bands = useMemo(() => groupPermanents(cards), [cards]);
  const frontBands = bands.filter(band => band.category !== 'land');
  const landBand = bands.find(band => band.category === 'land');
  // The land lane has its own height budget, so lands do not shrink creatures.
  const cardWidth = boardCardWidth({
    width: front.width,
    height: front.height - 10,
    bands: Math.max(1, frontBands.length),
    columns: 6,
    max: 132,
  });

  const toggleStack = (key: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const slotsFor = (bandCards: CardView[]): Slot[] =>
    groupTokens(bandCards, attachments).flatMap(group => {
      const size = group.cards.length;
      if (size === 1) return [{ cards: group.cards }];
      if (group.cards.some(needsIndividualSlot)) return group.cards.map(card => ({ cards: [card] }));
      const open = expanded.has(group.key);
      const toggle = { key: group.key, size, open };
      return open
        ? group.cards.map((card, index) => ({ cards: [card], toggle: index === 0 ? toggle : undefined }))
        : [{ cards: group.cards, toggle }];
    });

  const preview = (element: HTMLElement, card: CardView) =>
    onPreview({ anchor: cardAnchor('battlefield', card), rect: element.getBoundingClientRect() });

  const renderBand = (band: PermanentGroupView, width: number, availableWidth: number) => {
    const slots = slotsFor(band.cards);
    const plan = planDensity({ count: slots.length, availableWidth: Math.max(0, availableWidth - 18),
      cardWidth: width, maxRows: band.category === 'land' ? 1 : 2 });
    return (
      <section className={`permanent-band permanent-band-${band.category}`} key={band.category}>
        <h4 className="permanent-band-caption">
          {CATEGORY_LABELS[band.category]}
          <span className="permanent-band-count">{band.cards.length}</span>
        </h4>
        <div
          className={`permanent-row permanent-row-${plan.mode}${plan.scroll ? ' is-scroll' : ''}`}
          style={{ ['--card-w' as string]: `${width}px` }}
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
                const anchor = cardAnchor('battlefield', card);
                const attached = attachments?.get(anchor);
                const toggle = slot.toggle;
                return (
                  <div
                    className={`permanent-slot${stacked ? ' is-stack' : ''}`}
                    key={anchor}
                    data-board-anchor={anchor}
                    data-board-token-members={stacked ? slot.cards.slice(1).map(member => cardAnchor('battlefield', member)).join(' ') : undefined}
                    tabIndex={0}
                    onMouseEnter={(event) => preview(event.currentTarget, card)}
                    onMouseLeave={() => onPreview(null)}
                    onFocus={(event) => { if (event.target === event.currentTarget) preview(event.currentTarget, card); }}
                    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) onPreview(null); }}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
                      event.preventDefault();
                      if (stacked && toggle) toggleStack(toggle.key);
                      else (event.currentTarget.firstElementChild as HTMLElement | null)?.click();
                    }}
                    onClickCapture={(event) => {
                      if (!stacked || !toggle || !(event.target as Element).closest('.card')) return;
                      event.stopPropagation();
                      toggleStack(toggle.key);
                    }}
                    onContextMenuCapture={(event) => {
                      if (!stacked || !toggle) return;
                      event.preventDefault();
                      event.stopPropagation();
                      toggleStack(toggle.key);
                    }}
                  >
                    <CardComponent card={card} zone="battlefield" />
                    <PermanentStatus badges={permanentBadges(card)} />
                    {attached && <div className="permanent-attachments" role="group" aria-label="Attachments"
                      onMouseLeave={event => {
                        const host = event.currentTarget.parentElement;
                        if (host) preview(host, card);
                      }}>
                      {attached.map(source => (
                        <button type="button" key={cardAnchor('battlefield', source)}
                          aria-label={`Inspect attached ${source.name}`} title={source.name}
                          onMouseEnter={event => preview(event.currentTarget, source)}
                          onFocus={event => preview(event.currentTarget, source)}
                          onClick={event => preview(event.currentTarget, source)}>
                          {source.name}
                        </button>
                      ))}
                    </div>}
                    {toggle && (
                      <button
                        type="button"
                        className="stack-badge"
                        aria-expanded={toggle.open}
                        aria-label={`${toggle.size} identical permanents, ${toggle.open ? 'collapse' : 'expand'}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleStack(toggle.key);
                        }}
                      >
                        {toggle.open ? 'Group' : `×${toggle.size}`}
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
  };

  return (
    <div className={`board-half board-half-${side}`}>
      <div className="permanent-lane permanent-lands" ref={landsRef}>
        {landBand && renderBand(landBand, LAND_CARD_WIDTH, lands.width)}
      </div>
      <div className="permanent-lane permanent-front" ref={frontRef}>
        {bands.length === 0 && (
          <p className="board-half-empty">
            {side === 'you' ? 'Your Permanents' : "Opponent's Permanents"} — empty
          </p>
        )}
        {frontBands.map(band => renderBand(band, cardWidth, front.width))}
      </div>
    </div>
  );
}
