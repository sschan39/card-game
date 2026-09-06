import type { CardInstance, ManaCost } from '../../types/card.types';
import { useGameActions } from '../hooks/useGameActions';
import { useGameStore, selectCurrentPhase, selectTargeting, selectMyPlayerId } from '../store/gameStore';
import { ACTION_IDS } from '../../types/action.ids';
import { needsTargets } from '../targeting';
import { matchesTargetFilter } from '../../shared/target-utils';
import { CardCharacteristicService } from '../../engine/card-characteristic-service';

interface CardComponentProps {
  card: CardInstance;
  zone: 'hand' | 'battlefield';
}

// Render a ManaCost record as MTG-style symbols, e.g. {4}{R}{R}
function renderManaCost(mana: ManaCost | undefined): string {
  if (!mana) return '';
  const symbols: string[] = [];
  const order: Array<keyof ManaCost> = ['white', 'blue', 'black', 'red', 'green', 'colorless'];
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
  const phase = useGameStore(selectCurrentPhase);
  const targeting = useGameStore(selectTargeting);
  const myPlayerId = useGameStore(selectMyPlayerId);
  const toggleTarget = useGameStore((s) => s.toggleTarget);
  const room = useGameStore((s) => s.room);

  const manaCost = card.blueprint.castRequirements?.cost?.mana;
  const manaStr = renderManaCost(manaCost);
  const typeLine = card.blueprint.cardTypes.join(' ');

  // Resolve P/T through the continuous effect pool + counters (MTG layer 7).
  // Only battlefield permanents have modifiers applied; hand cards show base stats.
  const isBattlefield = zone === 'battlefield';
  const power = isBattlefield && room
    ? CardCharacteristicService.resolvePower(room, card)
    : card.blueprint.power;
  const toughness = isBattlefield && room
    ? CardCharacteristicService.resolveToughness(room, card)
    : card.blueprint.toughness;

  // Targeting mode: is this battlefield card a legal target?
  // - Spell targeting: matches the TargetingDefinition filter.
  // - Attack targeting: only opponent creatures are valid targets (you can't
  //   attack your own creatures). The opponent player is handled by OpponentInfo.
  const isAttackTargeting = targeting !== null && targeting.actionId === 'attack';
  const isTargetable =
    targeting !== null &&
    zone === 'battlefield' &&
    (targeting.targeting.type === 'permanent' || targeting.targeting.type === 'card') &&
    (isAttackTargeting
      ? card.state.controllerId !== myPlayerId &&
        card.blueprint.cardTypes.includes('Creature')
      : matchesTargetFilter(card, targeting.targeting, myPlayerId ?? ''));

  const isSelected =
    isTargetable &&
    targeting!.collected.some((t) => t.cardUuid === card.uuid);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    // Request options from server; the response triggers showContextMenu
    getOptions(card.uuid, zone);
  };

  const handleClick = (e: React.MouseEvent) => {
    // Targeting mode: tap a battlefield card to select/deselect it
    if (isTargetable) {
      toggleTarget({ targetType: 'permanent', cardUuid: card.uuid });
      return;
    }

    // Simple click: if in hand, play the card
    if (zone === 'hand') {
      if (phase === 'RPS') {
        playerAction(ACTION_IDS.rpsPlay, card.uuid);
      } else {
        const targetingDef = needsTargets(card);
        if (targetingDef) {
          // Enter targeting mode instead of casting immediately
          beginTargeting({
            cardUuid: card.uuid,
            zone,
            actionId: ACTION_IDS.castSpell,
            targeting: targetingDef,
            collected: [],
          });
        } else {
          playerAction(ACTION_IDS.castSpell, card.uuid);
        }
      }
    }
  };

  return (
    <div
      className={`card ${card.state.isTapped ? 'tapped' : ''} ${isTargetable ? 'targetable' : ''} ${isSelected ? 'selected' : ''}`}
      onContextMenu={handleContextMenu}
      onClick={handleClick}
      title={card.blueprint.rulesText}
    >
      <div className="card-top">
        <div className="card-name">{card.blueprint.name}</div>
        {manaStr && <div className="card-mana">{manaStr}</div>}
      </div>
      {typeLine && <div className="card-type">{typeLine}</div>}
      {power !== undefined && (
        <div className="card-stats">
          {power}/{toughness}
        </div>
      )}
    </div>
  );
}