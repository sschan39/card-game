import { useShallow } from 'zustand/react/shallow';
import { useGameStore, selectMyBattlefield, selectOpponentBattlefield, selectMyPlayerId, selectOpponentId } from '../store/gameStore';
import { useGameActions } from '../hooks/useGameActions';
import { matchesTargetFilter } from '../../shared/target-utils';
import type { TargetPointer } from '../../types/effect.types';

/**
 * Renders when the player is in targeting mode. Highlights legal targets
 * (battlefield cards matching the TargetingDefinition filters, or players
 * for type 'player'), collects targets, and confirms by dispatching the
 * action with the collected TargetPointer[].
 *
 * The store's `addTarget` enforces `maxTargets`; this component enforces
 * `minTargets` by disabling Confirm until the minimum is reached.
 */
export default function TargetSelector() {
  const targeting = useGameStore((s) => s.targeting);
  const addTarget = useGameStore((s) => s.addTarget);
  const cancelTargeting = useGameStore((s) => s.cancelTargeting);
  const confirmTargeting = useGameStore((s) => s.confirmTargeting);
  const myBattlefield = useGameStore(useShallow(selectMyBattlefield));
  const opponentBattlefield = useGameStore(useShallow(selectOpponentBattlefield));
  const myPlayerId = useGameStore(selectMyPlayerId);
  const opponentId = useGameStore(selectOpponentId);
  const { playerAction } = useGameActions();

  if (!targeting) return null;

  const def = targeting.targeting;
  const collected = targeting.collected;

  // Determine legal battlefield targets using the shared filter (kept in sync
  // with the server's ActionValidator.isTargetLegal).
  const allBattlefield = [...myBattlefield, ...opponentBattlefield];
  const legalCards = allBattlefield.filter((card) =>
    matchesTargetFilter(card, def, myPlayerId ?? ''),
  );

  const isCardTarget = def.type === 'permanent' || def.type === 'card';
  const isPlayerTarget = def.type === 'player';

  // Legal player targets, filtered by the controller constraint.
  const legalPlayers = [myPlayerId, opponentId].filter((pid): pid is string => {
    if (!pid) return false;
    if (def.controller === 'self' && pid !== myPlayerId) return false;
    if (def.controller === 'opponent' && pid === myPlayerId) return false;
    return true;
  });

  const isCollected = (cardUuid?: string, playerId?: string) =>
    collected.some((t) => t.cardUuid === cardUuid || t.playerId === playerId);

  const handleCardClick = (cardUuid: string) => {
    if (isCollected(cardUuid)) return; // already chosen
    addTarget({ targetType: 'permanent', cardUuid });
  };

  const handlePlayerClick = (playerId: string) => {
    if (isCollected(undefined, playerId)) return;
    addTarget({ targetType: 'player', playerId });
  };

  const handleConfirm = () => {
    if (collected.length === 0) return;
    // Dispatch with the collected targets BEFORE clearing targeting state,
    // so the targets are never lost to a re-render.
    playerAction(targeting.actionId, targeting.cardUuid, collected);
    confirmTargeting();
  };

  const minReached = def.minTargets === undefined || collected.length >= def.minTargets;

  return (
    <div className="target-selector-overlay" onClick={cancelTargeting}>
      <div className="target-selector" onClick={(e) => e.stopPropagation()}>
        <h3>Choose a target</h3>
        {isCardTarget && (
          <div className="target-cards">
            {legalCards.map((card) => (
              <button
                key={card.uuid}
                className={`target-card ${isCollected(card.uuid) ? 'selected' : ''}`}
                onClick={() => handleCardClick(card.uuid)}
              >
                {card.blueprint.name}
              </button>
            ))}
            {legalCards.length === 0 && <p className="target-empty">No legal targets</p>}
          </div>
        )}
        {isPlayerTarget && (
          <div className="target-players">
            {legalPlayers.map((pid) => (
              <button
                key={pid}
                className={`target-player ${isCollected(undefined, pid) ? 'selected' : ''}`}
                onClick={() => handlePlayerClick(pid)}
              >
                {pid === myPlayerId ? 'You' : 'Opponent'}
              </button>
            ))}
            {legalPlayers.length === 0 && <p className="target-empty">No legal targets</p>}
          </div>
        )}
        <div className="target-actions">
          <button onClick={cancelTargeting}>Cancel</button>
          <button onClick={handleConfirm} disabled={!minReached || collected.length === 0}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}