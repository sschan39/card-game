import { useGameStore } from '../store/gameStore';
import { useGameActions } from '../hooks/useGameActions';
import { needsTargets } from '../targeting';
import { ACTION_IDS } from '../../types/action.ids';
import type { ActionOption } from '../../engine/option-service';
import type { CardInstance } from '../../types/card.types';

export default function ContextMenu() {
  const contextMenu = useGameStore((s) => s.contextMenu);
  const hideContextMenu = useGameStore((s) => s.hideContextMenu);
  const beginTargeting = useGameStore((s) => s.beginTargeting);
  const room = useGameStore((s) => s.room);
  const { playerAction } = useGameActions();

  // Find a card by uuid across hand and battlefield (for needsTargets lookup)
  const findCard = (cardUuid: string): CardInstance | undefined => {
    if (!room) return undefined;
    for (const player of Object.values(room.players)) {
      const inHand = player.hand.find((c) => c.uuid === cardUuid);
      if (inHand) return inHand;
    }
    return room.battlefield.find((c) => c.uuid === cardUuid);
  };

  if (!contextMenu) return null;

  // Only render actionable options: skip hidden (redundant) and disabled ones.
  const visibleOptions = contextMenu.options.filter((opt) => !opt.hidden && !opt.disabled);

  const handleAction = (option: ActionOption) => {
    const actionId = option.actionId;
    if (actionId === ACTION_IDS.castSpell || actionId === ACTION_IDS.activateAbility) {
      const card = findCard(contextMenu.cardUuid);
      const ability = card?.blueprint.abilities.find(a => a.id === option.data?.abilityId);
      const abilityTargeting = ability?.effect.targeting;
      const targetingDef = actionId === ACTION_IDS.castSpell ? (card ? needsTargets(card) : null)
        : abilityTargeting && abilityTargeting.type !== 'self' && !abilityTargeting.all ? abilityTargeting : null;
      if (targetingDef) {
        beginTargeting({
          cardUuid: contextMenu.cardUuid,
          zone: contextMenu.zone,
          actionId,
          data: option.data,
          targeting: targetingDef,
          collected: [],
        });
        hideContextMenu();
        return;
      }
    }
    playerAction(actionId, contextMenu.cardUuid, undefined, option.data);
    hideContextMenu();
  };

  return (
    <div
      className="context-menu-overlay"
      onClick={hideContextMenu}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className="context-menu"
        style={{ left: contextMenu.x, top: contextMenu.y }}
        onClick={(e) => e.stopPropagation()}
      >
        {visibleOptions.map((opt) => (
          <button
            key={opt.actionId + JSON.stringify(opt.data ?? {})}
            onClick={() => handleAction(opt)}
            title={opt.description}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
