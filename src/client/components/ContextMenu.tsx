import { useGameStore } from '../store/gameStore';
import { useGameActions } from '../hooks/useGameActions';
import { createTargetingState } from '../targeting';
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

  const visibleOptions = contextMenu.options.filter((opt) => !opt.hidden);

  const handleAction = (option: ActionOption) => {
    if (option.disabled) return;
    const actionId = option.actionId;
    const data = contextMenu.choosePayment && (actionId === ACTION_IDS.castSpell || actionId === ACTION_IDS.activateAbility)
      ? { ...option.data, choosePayment: true } : option.data;
    if (actionId === ACTION_IDS.castSpell || actionId === ACTION_IDS.activateAbility) {
      const card = findCard(contextMenu.cardUuid);
      const targetingState = card ? createTargetingState(card, contextMenu.zone, actionId, data, room ?? undefined) : null;
      if (targetingState) {
        beginTargeting(targetingState);
        hideContextMenu();
        return;
      }
    }
    playerAction(actionId, contextMenu.cardUuid, undefined, data);
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
        {visibleOptions.some(option => option.actionId === ACTION_IDS.castSpell || option.actionId === ACTION_IDS.activateAbility) && (
          <label><input type="checkbox" checked={contextMenu.choosePayment ?? false}
            onChange={event => useGameStore.setState({ contextMenu: { ...contextMenu, choosePayment: event.target.checked } })} />Choose mana payment</label>
        )}
        {visibleOptions.map((opt) => (
          <button
            key={opt.actionId + JSON.stringify(opt.data ?? {})}
            onClick={() => handleAction(opt)}
            disabled={opt.disabled}
            title={opt.description}
          >
            {opt.label}
            {opt.disabledReason && <small>{opt.disabledReason}</small>}
          </button>
        ))}
      </div>
    </div>
  );
}
