import type { CardInstance, ManaCost } from '../../types/card.types';
import type { AuthoredActionCost } from '../../types/effect.types';
import { useGameActions } from '../hooks/useGameActions';
import { useGameStore, selectTargeting, selectMyPlayerId, selectIsMyTurn } from '../store/gameStore';
import { ACTION_IDS } from '../../types/action.ids';
import { createTargetingState } from '../targeting';
import { structuralTargetLegal, targetPermissionsAllow, findTargetCard } from '../../shared/target-legality';
import { CardCharacteristicService } from '../../engine/card-characteristic-service';
import { battlefieldCardLabel } from '../card-label';

interface CardComponentProps {
  card: CardInstance;
  zone: 'hand' | 'battlefield';
}

// Render a ManaCost record as MTG-style symbols, e.g. {4}{R}{R}
function renderManaCost(mana: AuthoredActionCost['mana']): string {
  if (!mana) return '';
  const symbols: string[] = mana.generic !== undefined ? ['{' + (typeof mana.generic === 'number' ? mana.generic : mana.generic.numeric.kind === 'binding' ? mana.generic.numeric.name : 'Variable') + '}'] : [];
  const order: Array<Exclude<keyof ManaCost, 'generic'>> = ['white', 'blue', 'black', 'red', 'green', 'colorless'];
  const glyph: Record<string, string> = {
    white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G', colorless: 'C',
  };
  for (const color of order) {
    const n = mana[color] ?? 0;
    for (let i = 0; i < n; i++) {
      symbols.push(`{${glyph[color]}}`);
    }
  }
  return symbols.join('');
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

  const characteristics = room ? CardCharacteristicService.resolve(room, card) : undefined;
  const manaCost = (characteristics?.castRequirements ?? card.blueprint.castRequirements)?.cost?.mana;
  const manaStr = renderManaCost(manaCost);
  const typeLine = (characteristics?.cardTypes ?? card.blueprint.cardTypes).join(' ');

  // Deliberately scoped effects can modify characteristics in any zone.
  const power = characteristics?.power ?? card.blueprint.power;
  const toughness = characteristics?.toughness ?? card.blueprint.toughness;

  // Only creatures have a P/T characteristic. Non-creature permanents (e.g.
  // lands) must not render a bogus 0/0 — the resolver defaults missing stats
  // to 0, so gate on the card type rather than on `power !== undefined`.
  const hasStats = (characteristics?.cardTypes ?? card.blueprint.cardTypes).includes('Creature');

  // Spell targeting: is this battlefield card a legal target?
  const isTargetable =
    targeting !== null &&
    zone === 'battlefield' &&
    (targeting.targeting.type === 'permanent' || targeting.targeting.type === 'card') &&
    !!room && structuralTargetLegal(room, myPlayerId ?? '', { targetType: targeting.targeting.type, cardUuid: card.uuid }, targeting.targeting) &&
    targetPermissionsAllow(room, myPlayerId ?? '', findTargetCard(room, { targetType: 'card', cardUuid: targeting.cardUuid }), { targetType: targeting.targeting.type, cardUuid: card.uuid });

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
      toggleTarget({ targetType: targeting!.targeting.type, cardUuid: card.uuid });
      return;
    }

    const declarations = useGameStore.getState().room?.combatDeclarations;
    const stackOpen = (useGameStore.getState().room?.stack.length ?? 0) > 0;
    // Attacker selection mode (declareAttackersStep, my turn)
    if (zone === 'battlefield' && characteristics?.controllerId === myPlayerId && phase === 'declareAttackersStep' && isMyTurn && !declarations?.attackers && !stackOpen) {
      const isCreature = hasStats;
      // Draft candidates are validated by the engine on confirmation. A rejected
      // candidate stays selected so it can be removed or replaced explicitly.
      if (isCreature) {
        toggleAttacker(card.uuid);
        return;
      }
    }

    // Blocker selection mode (declareBlockersStep, not my turn)
    if (zone === 'battlefield' && characteristics?.controllerId === myPlayerId && phase === 'declareBlockersStep' && !isMyTurn && !declarations?.blockers && !stackOpen) {
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
      } else if ((characteristics?.cardTypes ?? card.blueprint.cardTypes).includes('Land')) {
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
    <div
      className={`card ${card.state.isTapped ? 'tapped' : ''} ${isTargetable ? 'targetable' : ''} ${isSelected ? 'selected' : ''} ${isCombatSelected ? 'combat-selected' : ''} ${isPendingBlocker ? 'pending-blocker' : ''} ${zone === 'battlefield' && hasStats && card.state.summoningSickness ? 'summoning-sick' : ''}`}
      onContextMenu={handleContextMenu}
      onClick={handleClick}
      title={characteristics?.rulesText ?? card.blueprint.rulesText}
    >
      <div className="card-top">
        <div className="card-name">{room && zone === 'battlefield' ? battlefieldCardLabel(room, card) : characteristics?.name ?? card.blueprint.name}</div>
        {manaStr && <div className="card-mana">{manaStr}</div>}
      </div>
      {typeLine && <div className="card-type">{typeLine}</div>}
      {hasStats && (
        <div className="card-stats">
          {power}/{toughness}
        </div>
      )}
    </div>
  );
}
