import { useGameStore } from '../store/gameStore';
import { useGameActions } from '../hooks/useGameActions';

export default function ContextMenu() {
  const contextMenu = useGameStore((s) => s.contextMenu);
  const hideContextMenu = useGameStore((s) => s.hideContextMenu);
  const { playerAction } = useGameActions();

  if (!contextMenu) return null;

  const handleAction = (actionId: string) => {
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
        {contextMenu.options.map((opt) => (
          <button
            key={opt.actionId}
            disabled={opt.disabled}
            onClick={() => handleAction(opt.actionId)}
            title={opt.disabledReason}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}