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
  const beginTargeting = useGameStore((s) => s.beginTargeting);
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

  const canConfirm = collected.length >= (def.minTargets ?? (def.required ? 1 : 0)) && collected.length <= (def.maxTargets ?? Infinity);

  const handleConfirm = () => {
    // Dispatch with the collected targets BEFORE clearing targeting state,
    // so the targets are never lost to a re-render.
    if (targeting.groups) {
      const index = targeting.groupIndex ?? 0;
      const completed = [...targeting.completedGroups ?? [], { id: targeting.groups[index].id, targets: collected }];
      if (index + 1 < targeting.groups.length) {
        beginTargeting({ ...targeting, groupIndex: index + 1, completedGroups: completed, targeting: targeting.groups[index + 1].targeting, collected: [] });
        return;
      }
      playerAction(targeting.actionId, targeting.cardUuid, undefined, { ...targeting.data, targetGroups: completed });
    } else playerAction(targeting.actionId, targeting.cardUuid, collected, targeting.data);
    confirmTargeting();
  };

  return (
    <div className="targeting-banner">
      <label><input type="checkbox" checked={targeting.data?.choosePayment === true}
        onChange={event => useGameStore.setState({ targeting: { ...targeting, data: { ...targeting.data, choosePayment: event.target.checked } } })} />Choose mana payment</label>
      <span className="targeting-banner-text">
        Choose target{def.maxTargets && def.maxTargets > 1 ? 's' : ''} — {cardName}
        {targeting.groups && ` (${(targeting.groupIndex ?? 0) + 1}/${targeting.groups.length}: ${targeting.groups[targeting.groupIndex ?? 0].id})`}
        {collected.length > 0 && ` (${collected.length} selected)`}
        {(def.minTargets ?? (def.required ? 1 : 0)) === 0 && ' (optional)'}
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
