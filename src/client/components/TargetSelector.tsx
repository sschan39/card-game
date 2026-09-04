import { useShallow } from 'zustand/react/shallow';
import { useGameStore, selectMyBattlefield, selectOpponentBattlefield, selectMyPlayerId, selectOpponentId } from '../store/gameStore';
import { useGameActions } from '../hooks/useGameActions';
import type { TargetPointer } from '../../types/effect.types';

/**
 * Renders when the player is in targeting mode. Highlights legal targets
 * (battlefield cards matching the TargetingDefinition filters, or players
 * for type 'player'), collects a single target, and confirms by dispatching
 * the action with the collected TargetPointer[].
 *
 * Single-target UX for now: collects one target then confirms. The backend
 * and data model already support multi-target; only this interaction is
 * single-target (see spec §3.3.3).
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

  // Determine legal battlefield targets based on the TargetingDefinition filters
  const allBattlefield = [...myBattlefield, ...opponentBattlefield];
  const legalCards = allBattlefield.filter((card) => {
    if (def.cardTypes && def.cardTypes.length > 0) {
      if (!def.cardTypes.some((t) => card.blueprint.cardTypes.includes(t))) return false;
    }
    if (def.subTypes && def.subTypes.length > 0) {
      if (!def.subTypes.some((s) => (card.blueprint.subTypes || []).includes(s))) return false;
    }
    if (def.controller === 'self' && card.state.controllerId !== myPlayerId) return false;
    if (def.controller === 'opponent' && card.state.controllerId === myPlayerId) return false;
    return true;
  });

  const isCardTarget = def.type === 'permanent' || def.type === 'card';
  const isPlayerTarget = def.type === 'player';

  const isCollected = (cardUuid?: string, playerId?: string) =>
    collected.some((t) => t.cardUuid === cardUuid || t.playerId === playerId);

  const handleCardClick = (cardUuid: string) => {
    if (isCollected(cardUuid)) return; // single-target: already chosen
    addTarget({ targetType: 'permanent', cardUuid });
  };

  const handlePlayerClick = (playerId: string) => {
    if (isCollected(undefined, playerId)) return;
    addTarget({ targetType: 'player', playerId });
  };

  const handleConfirm = () => {
    if (collected.length === 0) return;
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
            {[myPlayerId, opponentId].filter(Boolean).map((pid) => (
              <button
                key={pid}
                className={`target-player ${isCollected(undefined, pid) ? 'selected' : ''}`}
                onClick={() => handlePlayerClick(pid!)}
              >
                {pid === myPlayerId ? 'You' : 'Opponent'}
              </button>
            ))}
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