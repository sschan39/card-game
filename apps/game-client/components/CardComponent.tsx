import type { CardView } from '@card-game/protocol';
import '@card-game/ui/style.css';
import { useGameActions } from '../hooks/useGameActions';
import { useGameStore, selectTargeting } from '../store/gameStore';
import { ACTION_IDS } from '@card-game/protocol';
import { createTargetingState } from '../targeting';
import { isLegalTarget } from '../targeting';
import { battlefieldCardLabel } from '../card-label';
import { showsSummoningSickness } from '../presentation/card-status';
import { battlefieldAttachments, permanentBadges } from '../presentation/permanent-statuses';
import { cardAnchor } from '../presentation/board-anchors';
import { MatchCardFace } from './MatchCardFace';

interface CardComponentProps {
  card: CardView;
  zone: 'hand' | 'battlefield';
  onOpenStack?: () => void;
  onPlayIntent?: () => void;
}

export default function CardComponent({ card, zone, onOpenStack, onPlayIntent }: CardComponentProps) {
  const { getOptions, playerAction } = useGameActions();
  const beginTargeting = useGameStore((s) => s.beginTargeting);
  const status = useGameStore((s) => s.room?.status ?? null);
  const targeting = useGameStore(selectTargeting);
  const toggleTarget = useGameStore((s) => s.toggleTarget);
  const room = useGameStore((s) => s.room);

  // Combat selection (Task 6/7): attacker/blocker click-to-select
  const combatSelection = useGameStore((s) => s.combatSelection);
  const toggleAttacker = useGameStore((s) => s.toggleAttacker);
  const selectBlocker = useGameStore((s) => s.selectBlocker);
  const assignBlocker = useGameStore((s) => s.assignBlocker);

  // Spell targeting: is this battlefield card a legal target?
  const cardTargetType = targeting?.targeting.type === 'any' ? 'permanent' : targeting?.targeting.type;
  const isTargetable =
    targeting !== null &&
    zone === 'battlefield' &&
    (cardTargetType === 'permanent' || cardTargetType === 'card') &&
    isLegalTarget(targeting, { targetType: cardTargetType!, cardUuid: card.uuid });

  const isSelected =
    isTargetable &&
    targeting!.collected.some((t) => t.cardUuid === card.uuid);

  // Combat selection highlights
  const isCombatSelected = combatSelection.attackers.includes(card.uuid) || combatSelection.blockerPairs.some(pair => pair.blockerUuid === card.uuid);
  const isPendingBlocker = combatSelection.pendingBlocker === card.uuid;
  const combat = room?.legalActions?.combat;
  const isBlockTarget = zone === 'battlefield' && combat?.actionId === ACTION_IDS.declareBlockers &&
    combatSelection.pendingBlocker !== null && combat.attackerUuids.includes(card.uuid);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (onOpenStack) { onOpenStack(); return; }
    // Request the latest options before opening the context menu.
    getOptions(card.uuid, zone, { x: e.clientX, y: e.clientY });
  };

  const handleClick = () => {
    if (onOpenStack) { onOpenStack(); return; }
    // Targeting mode: tap a battlefield card to select/deselect it
    if (isTargetable) {
      toggleTarget({ targetType: cardTargetType!, cardUuid: card.uuid });
      return;
    }

    const declaration = room?.legalActions?.combat;
    if (zone === 'battlefield' && declaration?.actionId === ACTION_IDS.declareAttackers &&
        declaration.attackerUuids.includes(card.uuid)) {
      toggleAttacker(card.uuid);
      return;
    }
    if (zone === 'battlefield' && declaration?.actionId === ACTION_IDS.declareBlockers &&
        declaration.blockerUuids.includes(card.uuid)) {
      selectBlocker(card.uuid);
      return;
    }
    if (zone === 'battlefield' && declaration?.actionId === ACTION_IDS.declareBlockers && isBlockTarget) {
      assignBlocker(card.uuid);
      return;
    }

    // Simple click: if in hand, play the card
    if (zone === 'hand' && status === 'playing') {
      onPlayIntent?.();
      const option = card.actions.find(action => action.actionId === card.defaultActionId);
      if (!option) return;
      if (option.disabled) {
        useGameStore.getState().setError(option.disabledReason ?? 'This card is not available to play.');
        return;
      }
      if (option.actionId === ACTION_IDS.playLand) {
        playerAction(ACTION_IDS.playLand, card.uuid, undefined, { zoneRevision: card.state.zoneRevision ?? 0 });
      } else {
        const targetingState = option.nextInput === 'targets'
          ? createTargetingState(card, zone, ACTION_IDS.castSpell, option.data, room ?? undefined)
          : null;
        if (targetingState) {
          // Enter targeting mode instead of casting immediately
          beginTargeting(targetingState);
        } else {
          playerAction(ACTION_IDS.castSpell, card.uuid);
        }
      }
    }
  };

  const label = room && zone === 'battlefield' ? battlefieldCardLabel(room, card) : card.name;
  const disabledReason = zone === 'hand' ? card.actions.find(option => option.actionId === card.defaultActionId)?.disabledReason : undefined;
  const detailNotes = () => [
    ...card.keywords,
    ...(card.state.isTapped ? ['Tapped'] : []),
    ...(showsSummoningSickness(card) ? ['Summoning sick'] : []),
    ...permanentBadges(card).map(badge => badge.detail),
    ...(room && zone === 'battlefield' ? (battlefieldAttachments(room.battlefield).get(cardAnchor('battlefield', card)) ?? [])
      .map(source => `${source.name} attached`) : []),
  ];
  return (
    <MatchCardFace
      card={card}
      label={label}
      role="button"
      aria-label={label}
      aria-description={disabledReason}
      detailNotes={detailNotes}
      className={`${card.state.isTapped ? 'tapped' : ''} ${isTargetable || isBlockTarget ? 'targetable' : ''} ${isSelected ? 'selected' : ''} ${isCombatSelected ? 'combat-selected' : ''} ${isPendingBlocker ? 'pending-blocker' : ''} ${showsSummoningSickness(card) ? 'summoning-sick' : ''}`}
      onContextMenu={handleContextMenu}
      onClick={handleClick}
      title={disabledReason}
    />
  );
}
