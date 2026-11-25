import { useGameStore } from '../store/gameStore';
import { battlefieldCardLabel } from '../card-label';

/** Text equivalent for the battlefield's combat arrows. */
export default function CombatDisplay() {
  const room = useGameStore(state => state.room);
  const { attackers, blockerPairs } = useGameStore(state => state.combatSelection);
  if (!room || (!room.combat.length && !attackers.length)) return null;

  const label = (uuid: string) => room.battlefield.find(card => card.uuid === uuid)?.label ?? 'Selected creature';
  const descriptions = room.combat.map(combat => {
    const blockers = combat.blockers.map(card => battlefieldCardLabel(room, card));
    const pending = blockerPairs.filter(pair => pair.attackerUuid === combat.uuid).map(pair => label(pair.blockerUuid));
    const name = battlefieldCardLabel(room, combat.attacker);
    if (pending.length) return name + ' to be blocked by ' + pending.join(', ');
    if (blockers.length) return name + ' blocked by ' + blockers.join(', ');
    return name + (combat.blocked ? ' was blocked' : ' attacks the defending player');
  });
  descriptions.push(...attackers.map(uuid => label(uuid) + ' selected to attack'));
  return <p className="sr-only" role="status">{descriptions.join('. ')}</p>;
}
