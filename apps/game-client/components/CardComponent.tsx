import type { CardView } from '@card-game/protocol';
import { CardSurface } from '@card-game/ui';
import '@card-game/ui/style.css';
import { useGameActions } from '../hooks/useGameActions';
import { useGameStore, selectTargeting, selectMyPlayerId, selectIsMyTurn } from '../store/gameStore';
import { ACTION_IDS } from '@card-game/protocol';
import { createTargetingState } from '../targeting';
import { isLegalTarget } from '../targeting';
import { battlefieldCardLabel } from '../card-label';

interface CardComponentProps {
  card: CardView;
  zone: 'hand' | 'battlefield';
}

export default function CardComponent({ card, zone }: CardComponentProps) {
  const { getOptions, playerAction } = useGameActions();
  const showContextMenu = useGameStore((s) => s.showContextMenu);
  const beginTargeting = useGameStore((s) => s.beginTargeting);
  const status = useGameStore((s) => s.room?.status ?? null);
  const targeting = useGameStore(selectTargeting);
  const myPlayerId = useGameStore(selectMyPlayerId);
  const toggleTarget = useGameStore((s) => s.toggleTarget);
  const room = useGameStore((s) => s.room);

  // Combat selection (Task 6/7): attacker/blocker click-to-select
  const combatSelection = useGameStore((s) => s.combatSelection);
  const toggleAttacker = useGameStore((s) => s.toggleAttacker);
  const selectBlocker = useGameStore((s) => s.selectBlocker);
  const phase = useGameStore((s) => s.room?.phase ?? null);
  const isMyTurn = useGameStore(selectIsMyTurn);

  const hasStats = card.cardTypes.includes('Creature');

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

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    // Request options from server; the response triggers showContextMenu
    getOptions(card.uuid, zone, { x: e.clientX, y: e.clientY });
  };

  const handleClick = (e: React.MouseEvent) => {
    // Targeting mode: tap a battlefield card to select/deselect it
    if (isTargetable) {
      toggleTarget({ targetType: cardTargetType!, cardUuid: card.uuid });
      return;
    }

    const declarations = useGameStore.getState().room?.combatDeclarations;
    const stackOpen = (useGameStore.getState().room?.stack.length ?? 0) > 0;
    // Attacker selection mode (declareAttackersStep, my turn)
    if (zone === 'battlefield' && card.state.controllerId === myPlayerId && phase === 'declareAttackersStep' && isMyTurn && !declarations?.attackers && !stackOpen) {
      const isCreature = hasStats;
      // Draft candidates are validated by the engine on confirmation. A rejected
      // candidate stays selected so it can be removed or replaced explicitly.
      if (isCreature) {
        toggleAttacker(card.uuid);
        return;
      }
    }

    // Blocker selection mode (declareBlockersStep, not my turn)
    if (zone === 'battlefield' && card.state.controllerId === myPlayerId && phase === 'declareBlockersStep' && !isMyTurn && !declarations?.blockers && !stackOpen) {
      const isCreature = hasStats;
      if (isCreature) {
        selectBlocker(card.uuid);
        return;
      }
    }

    // Simple click: if in hand, play the card
    if (zone === 'hand') {
      if (status === 'RPS') {
        playerAction(ACTION_IDS.rpsPlay, card.uuid);
      } else if (card.cardTypes.includes('Land')) {
        playerAction(ACTION_IDS.playLand, card.uuid, undefined, { zoneRevision: card.state.zoneRevision ?? 0 });
      } else {
        const targetingState = createTargetingState(card, zone, ACTION_IDS.castSpell, undefined, room ?? undefined);
        if (targetingState) {
          // Enter targeting mode instead of casting immediately
          beginTargeting(targetingState);
        } else {
          playerAction(ACTION_IDS.castSpell, card.uuid);
        }
      }
    }
  };

  return (
    <CardSurface
      card={card}
      label={room && zone === 'battlefield' ? battlefieldCardLabel(room, card) : card.name}
      className={`${card.state.isTapped ? 'tapped' : ''} ${isTargetable ? 'targetable' : ''} ${isSelected ? 'selected' : ''} ${isCombatSelected ? 'combat-selected' : ''} ${isPendingBlocker ? 'pending-blocker' : ''} ${zone === 'battlefield' && hasStats && card.state.summoningSickness ? 'summoning-sick' : ''}`}
      onContextMenu={handleContextMenu}
      onClick={handleClick}
      title={card.rulesText}
    />
  );
}
