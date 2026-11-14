import { useLayoutEffect, useRef, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { useGameActions } from '../hooks/useGameActions';
import { createTargetingState } from '../targeting';
import { ACTION_IDS } from '@card-game/protocol';
import type { ActionOption } from '@card-game/protocol';
import type { CardView } from '@card-game/protocol';

export default function ContextMenu() {
  const contextMenu = useGameStore((s) => s.contextMenu);
  const hideContextMenu = useGameStore((s) => s.hideContextMenu);
  const beginTargeting = useGameStore((s) => s.beginTargeting);
  const room = useGameStore((s) => s.room);
  const { playerAction } = useGameActions();
  const menuRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<{ left: number; top: number } | null>(null);

  /* Place the menu above the pointer. Hand cards sit on the bottom edge of the table,
     so a menu that opens downward runs off the viewport and has to be scrolled to.
     Measure first, then flip up; clamp so it never leaves the viewport on any side. */
  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!element || !contextMenu) {
      setPlacement(null);
      return;
    }
    const rect = element.getBoundingClientRect();
    const margin = 8;
    let left = contextMenu.x;
    let top = contextMenu.y - rect.height - margin;
    if (top < margin) {
      top = Math.min(contextMenu.y + margin, window.innerHeight - rect.height - margin);
    }
    top = Math.max(margin, top);
    if (left + rect.width > window.innerWidth - margin) left = window.innerWidth - rect.width - margin;
    left = Math.max(margin, left);
    setPlacement({ left, top });
  }, [contextMenu]);

  // Find a card by uuid across hand and battlefield (for needsTargets lookup)
  const findCard = (cardUuid: string): CardView | undefined => {
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
        ref={menuRef}
        style={{
          left: placement?.left ?? contextMenu.x,
          top: placement?.top ?? contextMenu.y,
          visibility: placement ? undefined : 'hidden',
        }}
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
