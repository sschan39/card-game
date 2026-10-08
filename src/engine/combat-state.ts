import type { CardInstance } from '../types/card.types';
import type { GameRoom } from '../types/game.room.types';

/** A declaration snapshot identifies the original battlefield object, not just a UUID. */
export function liveCombatCard(room: GameRoom, snapshot: CardInstance): CardInstance | undefined {
  return room.battlefield.find(card => card.uuid === snapshot.uuid && card.state.zone === 'battlefield' &&
    (card.state.zoneRevision ?? 0) === (snapshot.state.zoneRevision ?? 0) &&
    card.state.controllerId === snapshot.state.controllerId && card.blueprint.cardTypes.includes('Creature'));
}

/** Prune permanently; keep declaration snapshots and blocked status for debugging. */
export function reconcileCombat(room: GameRoom): GameRoom {
  let changed = false;
  const combat = room.combat.flatMap(declaration => {
    if (!liveCombatCard(room, declaration.attacker)) { changed = true; return []; }
    const blockers = declaration.blockers.filter(card => !!liveCombatCard(room, card));
    const blocked = declaration.blocked ?? declaration.blockers.length > 0;
    if (blockers.length === declaration.blockers.length && declaration.blocked === blocked) return [declaration];
    changed = true;
    return [{ ...declaration, blockers, blocked }];
  });
  return changed ? { ...room, combat } : room;
}
