import { useMemo, useState } from 'react';
import type { CardView } from '@card-game/protocol';
import CardComponent from '../CardComponent';
import { useElementSize } from '../../hooks/useElementSize';
import { boardCardWidth, planDensity } from '../../layout/density';
import { CATEGORY_LABELS, groupPermanents, groupIdenticalPermanents, type PermanentGroupView } from '../../layout/grouping';
import { CardSurface, cardArt } from '@card-game/ui';
import type { PreviewRequest } from './CardPreview';
import { cardAnchor } from '../../presentation/board-anchors';
import { PermanentStatus } from './PermanentStatus';
import { permanentBadges } from '../../presentation/permanent-statuses';
import { useGameStore } from '../../store/gameStore';
import { ACTION_IDS } from '@card-game/protocol';
import { useGameActions } from '../../hooks/useGameActions';
import { battlefieldCardLabel } from '../../card-label';

interface Slot {
  cards: CardView[];
  toggle?: { key: string; size: number; open: boolean };
}

const LAND_CARD_WIDTH = 84;

interface PermanentHalfProps {
  cards: CardView[];
  side: 'you' | 'opponent';
  attachments?: ReadonlyMap<string, readonly CardView[]>;
  tucked?: ReadonlySet<string>;
  onPreview: (request: PreviewRequest | null) => void;
}

/**
 * One player's half of the battlefield.
 *
 * Measures itself, asks the density engine how wide a card should be, then
 * renders one band per permanent category. Identical cards collapse into a
 * counted stack that expands on click — the stack is a view over the same
 * cards, never a replacement for them.
 */
export default function PermanentHalf({ cards, side, attachments, tucked, onPreview }: PermanentHalfProps) {
  const { getOptions, playerAction } = useGameActions();
  const [frontRef, front] = useElementSize<HTMLDivElement>();
  const [landsRef, lands] = useElementSize<HTMLDivElement>();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const room = useGameStore(state => state.room);
  const viewerId = useGameStore(state => state.myPlayerId);
  const targeting = useGameStore(state => state.targeting);
  const candidates = [
    ...targeting?.groups?.[targeting.groupIndex ?? 0]?.legalTargets ?? [],
    ...targeting?.completedGroups?.flatMap(group => group.targets) ?? [],
    ...targeting?.collected ?? [],
  ];
  const combatants = new Set(room?.combat.flatMap(group =>
    [group.attacker, ...group.blockers].map(card => cardAnchor('battlefield', card))));
  const declaration = room?.legalActions?.combat;
  const combatCandidates = new Set(declaration?.actionId === 'declare_attackers' ? declaration.attackerUuids : declaration?.blockerUuids);
  const needsIndividualSlot = (card: CardView) => combatants.has(cardAnchor('battlefield', card)) ||
    (side === 'you' && combatCandidates.has(card.uuid)) ||
    (targeting?.zone === 'battlefield' && targeting.cardUuid === card.uuid) ||
    candidates.some(target => (target.targetType === 'card' || target.targetType === 'permanent') &&
      target.cardUuid === card.uuid && (target.zoneRevision === undefined || target.zoneRevision === (card.state.zoneRevision ?? 0)));

  const bands = useMemo(() => groupPermanents(cards.filter(card => !tucked?.has(cardAnchor('battlefield', card)))), [cards, tucked]);
  const frontBands = bands.filter(band => band.category !== 'land');
  const landBand = bands.find(band => band.category === 'land');
  // The land lane has its own height budget, so lands do not shrink creatures.
  const cardWidth = boardCardWidth({
    width: front.width,
    height: front.height - 10,
    bands: Math.max(1, frontBands.length),
    columns: 6,
    min: 104,
    max: 132,
  });

  const toggleStack = (key: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const slotsFor = (bandCards: CardView[], scope = 'board'): Slot[] =>
    groupIdenticalPermanents(bandCards, attachments).flatMap(group => {
      const size = group.cards.length;
      if (size === 1) return [{ cards: group.cards }];
      if (group.cards.some(needsIndividualSlot)) return group.cards.map(card => ({ cards: [card] }));
      const key = `${scope}:${group.key}`;
      const open = expanded.has(key);
      const toggle = { key, size, open };
      return open
        ? group.cards.map((card, index) => ({ cards: [card], toggle: index === 0 ? toggle : undefined }))
        : [{ cards: group.cards, toggle }];
    });

  const preview = (element: HTMLElement, card: CardView) =>
    onPreview({ anchor: cardAnchor('battlefield', card), rect: element.getBoundingClientRect() });

  const stackMembers = (slot: Slot) =>
    slot.cards.length > 1 ? slot.cards.slice(1).map(card => cardAnchor('battlefield', card)).join(' ') : undefined;

  const renderStackToggle = ({ key, size, open }: NonNullable<Slot['toggle']>, label: string) => (
    <button type="button" className="stack-badge" aria-expanded={open}
      aria-label={`${size} identical ${label}, ${open ? 'collapse' : 'expand'}`}
      onClick={event => {
        event.stopPropagation();
        toggleStack(key);
      }}>
      {open ? 'Group' : `×${size}`}
    </button>
  );

  const renderAction = (card: CardView, manaOnly = false) => {
    if (card.state.controllerId !== viewerId || targeting || room?.legalActions?.combat) return null;
    const options = card.actions.filter(option => !option.hidden && !option.disabled);
    if (options.length === 0) return null;
    const mana = options.length === 1 && options[0].actionId === ACTION_IDS.tapForMana ? options[0] : undefined;
    if (manaOnly && !mana) return null;
    return <button className="permanent-action" type="button"
      aria-label={`${mana ? mana.label : 'Actions'} for ${card.name}`}
      title={mana?.label ?? 'Card abilities'}
      onClick={event => {
        if (mana) { playerAction(mana.actionId, card.uuid, undefined, mana.data); return; }
        const { left, top } = event.currentTarget.getBoundingClientRect();
        getOptions(card.uuid, 'battlefield', { x: left, y: top });
      }}>
      {mana ? 'Mana' : 'Abilities'}
    </button>;
  };

  const renderAttachments = (host: CardView, anchor: string) => {
    const attached = attachments?.get(anchor)?.filter(source => tucked?.has(cardAnchor('battlefield', source)));
    if (!attached?.length) return null;
    return <div className="permanent-attachments" role="group" aria-label={`Attachments on ${host.name}`}
      onMouseLeave={event => {
        const slot = event.currentTarget.parentElement;
        if (slot) preview(slot, host);
      }}>
      {slotsFor(attached, anchor).map(slot => {
        const source = slot.cards[0];
        const sourceAnchor = cardAnchor('battlefield', source);
        const stacked = slot.cards.length > 1;
        const label = room ? battlefieldCardLabel(room, source) : source.name;
        return <div className={`permanent-attachment${stacked ? ' is-stack' : ''}`} key={sourceAnchor}
          data-board-anchor={sourceAnchor}
          data-board-token-members={stackMembers(slot)}
          data-tapped={source.state.isTapped || undefined}
          tabIndex={0} aria-label={`Attached ${label}`}
          onMouseEnter={event => preview(event.currentTarget, source)}
          onFocus={event => { if (event.target === event.currentTarget) preview(event.currentTarget, source); }}
          onKeyDown={event => {
            if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
            event.preventDefault();
            if (stacked && slot.toggle) toggleStack(slot.toggle.key);
            else (event.currentTarget.firstElementChild as HTMLElement | null)?.click();
          }}
          onClickCapture={event => {
            if (!stacked || !slot.toggle || !(event.target as Element).closest('.card')) return;
            event.stopPropagation();
            toggleStack(slot.toggle.key);
          }}
          onContextMenuCapture={event => {
            if (!stacked || !slot.toggle) return;
            event.preventDefault();
            event.stopPropagation();
            toggleStack(slot.toggle.key);
          }}>
          <CardComponent card={source} zone="battlefield" />
          {slot.toggle && renderStackToggle(slot.toggle, 'attachments')}
          {!stacked && renderAction(source)}
        </div>;
      })}
    </div>;
  };

  const renderBand = (band: PermanentGroupView, slots: Slot[], width: number, availableWidth: number) => {
    const plan = planDensity({ count: slots.length, availableWidth: Math.max(0, availableWidth - 18),
      cardWidth: width, maxRows: band.category === 'land' ? 1 : 2 });
    return (
      <section className={`permanent-band permanent-band-${band.category}`} key={band.category}>
        <h4 className="permanent-band-caption">
          {CATEGORY_LABELS[band.category]}
          <span className="permanent-band-count">{band.cards.length}</span>
        </h4>
        <div
          className={`permanent-row permanent-row-${plan.mode}`}
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
                const toggle = slot.toggle;
                return (
                  <div
                    className={`permanent-slot${stacked ? ' is-stack' : ''}`}
                    key={anchor}
                    data-board-anchor={anchor}
                    data-board-token-members={stackMembers(slot)}
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
                    {slot.cards.slice(1, 3).map((copy, index) => (
                      <div className="permanent-stack-layer" aria-hidden="true" key={copy.uuid}
                        style={{ '--layer': index + 1 } as React.CSSProperties}>
                        <CardSurface card={copy} art={cardArt(copy.definitionId)} className={copy.state.isTapped ? 'tapped' : ''} />
                      </div>
                    ))}
                    <PermanentStatus badges={permanentBadges(card)} />
                    {renderAction(card, stacked)}
                    {renderAttachments(card, anchor)}
                    {toggle && renderStackToggle(toggle, 'permanents')}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </section>
    );
  };

  const landSlots = landBand ? slotsFor(landBand.cards) : [];
  return (
    <div className={`board-half board-half-${side}${landSlots.length > 2 ? ' board-half-many-lands' : ''}`}>
      <div className="permanent-lane permanent-lands" ref={landsRef}>
        {landBand && renderBand(landBand, landSlots, LAND_CARD_WIDTH, lands.width)}
      </div>
      <div className="permanent-lane permanent-front" ref={frontRef}>
        {bands.length === 0 && (
          <p className="board-half-empty">
            {side === 'you' ? 'Your Permanents' : "Opponent's Permanents"} — empty
          </p>
        )}
        {frontBands.map(band => renderBand(band, slotsFor(band.cards), cardWidth, front.width))}
      </div>
    </div>
  );
}
