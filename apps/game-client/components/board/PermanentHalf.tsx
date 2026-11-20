import { useMemo, useState, type HTMLAttributes } from 'react';
import type { CardView } from '@card-game/protocol';
import CardComponent from '../CardComponent';
import { CATEGORY_LABELS, groupPermanents, groupIdenticalPermanents, type PermanentGroupView } from '../../layout/grouping';
import type { PreviewRequest } from './CardPreview';
import { cardAnchor } from '../../presentation/board-anchors';
import { PermanentStatus } from './PermanentStatus';
import { permanentBadges } from '../../presentation/permanent-statuses';
import { useGameStore } from '../../store/gameStore';
import { ACTION_IDS } from '@card-game/protocol';
import { useGameActions } from '../../hooks/useGameActions';
import { battlefieldCardLabel } from '../../card-label';
import { isLegalTarget } from '../../targeting';
import { PermanentStackPicker } from './PermanentStackPicker';

interface Slot {
  cards: CardView[];
  stackKey?: string;
}

interface PermanentHalfProps {
  cards: CardView[];
  side: 'you' | 'opponent';
  attachments?: ReadonlyMap<string, readonly CardView[]>;
  tucked?: ReadonlySet<string>;
  onPreview: (request: PreviewRequest | null) => void;
}

export default function PermanentHalf({ cards, side, attachments, tucked, onPreview }: PermanentHalfProps) {
  const { getOptions, playerAction } = useGameActions();
  const [activeStack, setActiveStack] = useState<string | null>(null);
  const room = useGameStore(state => state.room);
  const viewerId = useGameStore(state => state.myPlayerId);
  const targeting = useGameStore(state => state.targeting);
  const pendingBlocker = useGameStore(state => state.combatSelection.pendingBlocker);
  const declaration = room?.legalActions?.combat;
  const eligible = (card: CardView) => {
    if (targeting) {
      const type = targeting.targeting.type === 'any' ? 'permanent' : targeting.targeting.type;
      return (type === 'card' || type === 'permanent') &&
        isLegalTarget(targeting, { targetType: type, cardUuid: card.uuid });
    }
    if (declaration?.actionId === ACTION_IDS.declareAttackers) return declaration.attackerUuids.includes(card.uuid);
    if (declaration?.actionId === ACTION_IDS.declareBlockers) {
      return declaration.blockerUuids.includes(card.uuid) ||
        (pendingBlocker !== null && declaration.attackerUuids.includes(card.uuid));
    }
    return false;
  };

  const bands = useMemo(() => groupPermanents(cards.filter(card => !tucked?.has(cardAnchor('battlefield', card)))), [cards, tucked]);
  const frontBands = bands.filter(band => band.category !== 'land');
  const landBand = bands.find(band => band.category === 'land');
  const toggleStack = (key: string) => {
    onPreview(null);
    setActiveStack(previous => previous === key ? null : key);
  };

  const slotsFor = (bandCards: CardView[]): Slot[] =>
    groupIdenticalPermanents(bandCards, attachments).map(group => ({
      cards: group.cards,
      stackKey: group.cards.length > 1 ? cardAnchor('battlefield', group.cards[0]) : undefined,
    }));

  const preview = (element: HTMLElement, card: CardView) => {
    if (!activeStack) onPreview({ anchor: cardAnchor('battlefield', card), rect: element.getBoundingClientRect() });
  };

  const stackMembers = (slot: Slot) =>
    slot.cards.length > 1 ? slot.cards.slice(1).map(card => cardAnchor('battlefield', card)).join(' ') : undefined;

  const renderStackToggle = (key: string, size: number, label: string) => (
    <button type="button" className="stack-badge" aria-expanded={activeStack === key}
      aria-label={`${size} identical ${label}, ${activeStack === key ? 'close stack picker' : 'open stack picker'}`}
      onClick={event => {
        event.stopPropagation();
        toggleStack(key);
      }}>
      ×{size}
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

  const renderStackPicker = (slot: Slot) => slot.stackKey && slot.stackKey === activeStack && (
    <PermanentStackPicker cards={slot.cards} eligible={eligible} triggerKey={slot.stackKey}
      label={card => room ? battlefieldCardLabel(room, card) : card.name}
      onClose={() => setActiveStack(null)} renderAction={renderAction} />
  );

  const slotInteractions = (stackKey?: string): HTMLAttributes<HTMLDivElement> => ({
    onKeyDown: event => {
      if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      if (stackKey) toggleStack(stackKey);
      else (event.currentTarget.firstElementChild as HTMLElement | null)?.click();
    },
    onClickCapture: event => {
      if (!stackKey || !(event.target instanceof Element) ||
          !event.currentTarget.contains(event.target) || !event.target.closest('.card')) return;
      event.stopPropagation();
      toggleStack(stackKey);
    },
    onContextMenuCapture: event => {
      if (!stackKey || !event.currentTarget.contains(event.target as Node)) return;
      event.preventDefault();
      event.stopPropagation();
      toggleStack(stackKey);
    },
  });

  const renderAttachments = (host: CardView, anchor: string) => {
    const attached = attachments?.get(anchor)?.filter(source => tucked?.has(cardAnchor('battlefield', source)));
    if (!attached?.length) return null;
    return <div className="permanent-attachments" role="group" aria-label={`Attachments on ${host.name}`}
      onMouseLeave={event => {
        const slot = event.currentTarget.parentElement;
        if (slot) preview(slot, host);
      }}>
      {slotsFor(attached).map(slot => {
        const source = slot.cards[0];
        const sourceAnchor = cardAnchor('battlefield', source);
        const { stackKey } = slot;
        const stacked = !!stackKey;
        const label = room ? battlefieldCardLabel(room, source) : source.name;
        return <div className={`permanent-attachment${stacked ? ' is-stack' : ''}${stacked && slot.cards.some(eligible) ? ' is-selectable-stack' : ''}`} key={sourceAnchor}
          data-board-anchor={sourceAnchor}
          data-board-token-members={stackMembers(slot)}
          data-stack-picker-trigger={stackKey}
          data-tapped={source.state.isTapped || undefined}
          tabIndex={0} aria-label={`Attached ${label}`}
          onMouseEnter={event => preview(event.currentTarget, source)}
          onFocus={event => { if (event.target === event.currentTarget) preview(event.currentTarget, source); }}
          {...slotInteractions(stackKey)}>
          <CardComponent card={source} zone="battlefield" />
          {stackKey && renderStackToggle(stackKey, slot.cards.length, 'attachments')}
          {!stacked && renderAction(source)}
          {renderStackPicker(slot)}
        </div>;
      })}
    </div>;
  };

  const renderBand = (band: PermanentGroupView, slots: Slot[]) => {
    return (
      <section className={`permanent-band permanent-band-${band.category}`} key={band.category}>
        <h4 className="permanent-band-caption">
          {CATEGORY_LABELS[band.category]}
          <span className="permanent-band-count">{band.cards.length}</span>
        </h4>
        <div className="permanent-line">
          {slots.map((slot) => {
            const card = slot.cards[0];
            const stacked = slot.cards.length > 1;
            const anchor = cardAnchor('battlefield', card);
            const { stackKey } = slot;
            return (
              <div
                className={`permanent-slot${stacked ? ' is-stack' : ''}${stacked && slot.cards.some(eligible) ? ' is-selectable-stack' : ''}`}
                key={anchor}
                data-board-anchor={anchor}
                data-board-token-members={stackMembers(slot)}
                data-stack-picker-trigger={stackKey}
                tabIndex={0}
                onMouseEnter={(event) => preview(event.currentTarget, card)}
                onMouseLeave={() => onPreview(null)}
                onFocus={(event) => { if (event.target === event.currentTarget) preview(event.currentTarget, card); }}
                onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) onPreview(null); }}
                {...slotInteractions(stackKey)}
              >
                <CardComponent card={card} zone="battlefield" />
                {slot.cards.slice(1, 3).map((copy, index) => (
                  <div className="permanent-stack-layer" aria-hidden="true" key={copy.uuid}
                    data-tapped={copy.state.isTapped || undefined}
                    style={{ '--layer': index + 1 } as React.CSSProperties} />
                ))}
                <PermanentStatus badges={permanentBadges(card)} />
                {renderAction(card, stacked)}
                {renderAttachments(card, anchor)}
                {stackKey && renderStackToggle(stackKey, slot.cards.length, 'permanents')}
                {renderStackPicker(slot)}
              </div>
            );
          })}
        </div>
      </section>
    );
  };

  const landSlots = landBand ? slotsFor(landBand.cards) : [];
  const frontRows = frontBands.map(band => ({ band, slots: slotsFor(band.cards) }));
  const crowded = frontRows.reduce((total, { slots }) => total + slots.length, 0) > 6;
  return (
    <div className={`board-half board-half-${side}${landSlots.length > 2 ? ' board-half-many-lands' : ''}`}>
      <div className="permanent-lane permanent-lands">
        {landBand && renderBand(landBand, landSlots)}
      </div>
      <div className="permanent-lane permanent-front" data-crowded={crowded || undefined}>
        {bands.length === 0 && (
          <p className="board-half-empty">
            {side === 'you' ? 'Your Permanents' : "Opponent's Permanents"} — empty
          </p>
        )}
        {frontRows.map(({ band, slots }) => renderBand(band, slots))}
      </div>
    </div>
  );
}
