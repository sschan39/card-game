import { useShallow } from 'zustand/react/shallow';
import { useGameStore, selectIsMyTurn } from '../store/gameStore';

const EMPTY_COMBAT: never[] = [];
const EMPTY_BATTLEFIELD: never[] = [];

/**
 * Renders declared attackers from room.combat (CR 508 — turn-based action,
 * NOT on the stack). Shows attacker→blocker pairs. Damage is resolved
 * simultaneously in combatDamageStep.
 */
export default function CombatDisplay() {
  const combat = useGameStore(useShallow((s) => s.room?.combat ?? EMPTY_COMBAT));
  const battlefield = useGameStore(useShallow((s) => s.room?.battlefield ?? EMPTY_BATTLEFIELD));
  const combatSelection = useGameStore((s) => s.combatSelection);
  const assignBlocker = useGameStore((s) => s.assignBlocker);
  const phase = useGameStore((s) => s.room?.phase ?? null);
  const isMyTurn = useGameStore(selectIsMyTurn);

  if (combat.length === 0) return null;

  const isBlockingPhase = phase === 'declareBlockersStep' && !isMyTurn;
  const hasPendingBlocker = combatSelection.pendingBlocker !== null;

  return (
    <div className="combat-display">
      <h3>Combat ({combat.length})</h3>
      <ul>
        {combat.map((decl) => (
          <li key={decl.uuid}>
            <span
              className={`combat-attacker ${isBlockingPhase && hasPendingBlocker ? 'clickable' : ''}`}
              onClick={() => {
                if (isBlockingPhase && hasPendingBlocker) {
                  assignBlocker(decl.uuid);
                }
              }}
            >
              {decl.attacker.blueprint.name}
            </span>
            {' → '}
            <span className="combat-target">
              {decl.blockers.length > 0
                ? decl.blockers.map(b => b.blueprint.name).join(', ')
                : 'Unblocked'}
            </span>
            <span className="combat-damage">
              ({decl.attackerPower})
            </span>
          </li>
        ))}
      </ul>
      {combatSelection.blockerPairs.length > 0 && (
        <div className="pending-pairs">
          <h4>Pending Blocks</h4>
          <ul>
            {combatSelection.blockerPairs.map((pair, i) => {
              const attacker = combat.find((d) => d.uuid === pair.attackerUuid);
              const blocker = battlefield.find((c) => c.uuid === pair.blockerUuid);
              return (
                <li key={i}>
                  {attacker?.attacker.blueprint.name ?? pair.attackerUuid}
                  {' blocked by '}
                  {blocker?.blueprint.name ?? pair.blockerUuid}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}