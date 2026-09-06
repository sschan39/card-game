import { useGameStore, selectTargeting } from '../store/gameStore';
import { useGameActions } from '../hooks/useGameActions';

/**
 * Targeting banner — renders when the player is in targeting mode.
 * Shows the card being cast and Cancel/Confirm buttons.
 * Legal target highlighting and tap-to-select are handled by
 * CardComponent (battlefield) and PlayerInfo/OpponentInfo (players).
 */
export default function TargetSelector() {
  const targeting = useGameStore(selectTargeting);
  const cancelTargeting = useGameStore((s) => s.cancelTargeting);
  const confirmTargeting = useGameStore((s) => s.confirmTargeting);
  const room = useGameStore((s) => s.room);
  const { playerAction } = useGameActions();

  if (!targeting) return null;

  const def = targeting.targeting;
  const collected = targeting.collected;

  // Find the card name for the banner (cast spell → in hand; ability → battlefield).
  const cardName = (() => {
    if (!room) return 'card';
    for (const player of Object.values(room.players)) {
      const found = player.hand.find((c) => c.uuid === targeting.cardUuid);
      if (found) return found.blueprint.name;
    }
    const onBattlefield = room.battlefield.find((c) => c.uuid === targeting.cardUuid);
    if (onBattlefield) return onBattlefield.blueprint.name;
    return 'card';
  })();

  const minReached = def.minTargets === undefined || collected.length >= def.minTargets;
  // Attack allows confirming with zero targets (attack the face).
  const canConfirm = minReached && (collected.length > 0 || def.minTargets === 0);

  const handleConfirm = () => {
    // Dispatch with the collected targets BEFORE clearing targeting state,
    // so the targets are never lost to a re-render.
    playerAction(targeting.actionId, targeting.cardUuid, collected);
    confirmTargeting();
  };

  return (
    <div className="targeting-banner">
      <span className="targeting-banner-text">
        Choose target{def.maxTargets && def.maxTargets > 1 ? 's' : ''} — {cardName}
        {collected.length > 0 && ` (${collected.length} selected)`}
        {def.minTargets === 0 && ' (or confirm to attack the face)'}
      </span>
      <div className="targeting-banner-actions">
        <button onClick={cancelTargeting}>Cancel</button>
        <button onClick={handleConfirm} disabled={!canConfirm}>
          Confirm
        </button>
      </div>
    </div>
  );
}