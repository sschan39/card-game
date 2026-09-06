import { useGameStore } from '../store/gameStore';
import { useGameActions } from '../hooks/useGameActions';
import { needsTargets } from '../targeting';
import { ACTION_IDS } from '../../types/action.ids';
import type { ActionIdOrAbility } from '../../types/action.ids';
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

  const handleAction = (actionId: ActionIdOrAbility) => {
    if (actionId === ACTION_IDS.castSpell) {
      const card = findCard(contextMenu.cardUuid);
      const targetingDef = card ? needsTargets(card) : null;
      if (targetingDef) {
        beginTargeting({
          cardUuid: contextMenu.cardUuid,
          zone: contextMenu.zone,
          actionId,
          targeting: targetingDef,
          collected: [],
        });
        hideContextMenu();
        return;
      }
    }
    playerAction(actionId, contextMenu.cardUuid);
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
            key={opt.actionId}
            onClick={() => handleAction(opt.actionId)}
            title={opt.description}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}