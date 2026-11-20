import { useT } from '@card-game/ui';
import { useShallow } from 'zustand/react/shallow';
import { useGameStore } from '../store/gameStore';
import { battlefieldCardLabel } from '../card-label';

const EMPTY_COMBAT: never[] = [];
const EMPTY_BATTLEFIELD: never[] = [];

/**
 * Renders declared attackers from room.combat (CR 508 — turn-based action,
 * NOT on the stack). Shows attacker→blocker pairs. Damage is resolved
 * simultaneously in combatDamageStep.
 */
export default function CombatDisplay() {
  const t = useT();
  const combat = useGameStore(useShallow((s) => s.room?.combat ?? EMPTY_COMBAT));
  const battlefield = useGameStore(useShallow((s) => s.room?.battlefield ?? EMPTY_BATTLEFIELD));
  const combatSelection = useGameStore((s) => s.combatSelection);
  const assignBlocker = useGameStore((s) => s.assignBlocker);
  const room = useGameStore((s) => s.room);

  if (!room || combat.length === 0) return null;

  const declaration = room.legalActions?.combat;
  const pending = combatSelection.pendingBlocker;
  const canAssign = declaration?.actionId === 'declare_blockers' && pending !== null && declaration.blockerUuids.includes(pending);

  return (
    <div className="combat-display">
      <h3>Combat ({combat.length})</h3>
      <ul>
        {combat.map((decl) => (
          <li key={decl.uuid}>
            <button
              disabled={!canAssign || !declaration.attackerUuids.includes(decl.uuid)}
              className={`combat-attacker ${canAssign && declaration.attackerUuids.includes(decl.uuid) ? 'clickable' : ''}`}
              onClick={() => {
                if (canAssign && declaration.attackerUuids.includes(decl.uuid)) {
                  assignBlocker(decl.uuid);
                }
              }}
            >
              {battlefieldCardLabel(room, decl.attacker)}
            </button>
            {' → '}
            <span className="combat-target">
              {decl.blockers.length > 0
                ? decl.blockers.map(b => battlefieldCardLabel(room, b)).join(', ')
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
          <h4>{t('board.pendingBlocks')}</h4>
          <ul>
            {combatSelection.blockerPairs.map((pair, i) => {
              const attacker = combat.find((d) => d.uuid === pair.attackerUuid);
              const blocker = battlefield.find((c) => c.uuid === pair.blockerUuid);
              return (
                <li key={i}>
                  {attacker ? battlefieldCardLabel(room, attacker.attacker) : pair.attackerUuid}
                  {' blocked by '}
                  {blocker ? battlefieldCardLabel(room, blocker) : pair.blockerUuid}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
