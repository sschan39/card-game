import { useShallow } from 'zustand/react/shallow';
import { useGameStore } from '../store/gameStore';

const EMPTY_COMBAT: never[] = [];

/**
 * Renders declared attackers from room.combat (CR 508 — turn-based action,
 * NOT on the stack). Shows attacker→blocker pairs. Damage is resolved
 * simultaneously in combatDamageStep.
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
    </div>
  );
}