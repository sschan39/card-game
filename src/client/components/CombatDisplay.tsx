import { useShallow } from 'zustand/react/shallow';
import { useGameStore } from '../store/gameStore';

const EMPTY_COMBAT: never[] = [];

/**
 * Renders declared attackers from room.combat (CR 508 — turn-based action,
 * NOT on the stack). In the current single-attacker model, combat resolves
 * immediately, so this is a transient flash that disappears when CLEAR_COMBAT
 * fires at endCombatStep. In a future declare-blockers step, this will grow to
 * show attacker→blocker pairs.
 */
export default function CombatDisplay() {
  const combat = useGameStore(useShallow((s) => s.room?.combat ?? EMPTY_COMBAT));

  if (combat.length === 0) return null;

  return (
    <div className="combat-display">
      <h3>Combat ({combat.length})</h3>
      <ul>
        {combat.map((decl) => (
          <li key={decl.uuid}>
            <span className="combat-attacker">{decl.attacker.blueprint.name}</span>
            {' → '}
            <span className="combat-target">
              {decl.target.targetType === 'player'
                ? 'Opponent'
                : decl.target.cardUuid ?? 'unknown'}
            </span>
            <span className="combat-damage">
              ({decl.attackerPower}/{decl.defenderPower ?? '—'})
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}