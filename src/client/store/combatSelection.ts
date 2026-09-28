// src/client/store/combatSelection.ts
// Client-only combat selection state and reconciliation logic.
// Holds local UUID selections; reconciles against server state on every delta.

import type { GameRoom } from '../../types/game.room.types';

export interface CombatSelection {
  attackers: string[];                       // selected attacker uuids
  blockerPairs: { attackerUuid: string; blockerUuid: string }[];
  pendingBlocker: string | null;             // blocker awaiting an attacker click
}

export const EMPTY_COMBAT_SELECTION: CombatSelection = {
  attackers: [],
  blockerPairs: [],
  pendingBlocker: null,
};

/**
 * Reconcile local combat selection against the latest server state.
 * Drops any reference to cards that no longer exist or are no longer eligible.
 * Returns the reconciled selection and a `changed` flag for UI notification.
 * Pure function — testable independently of Zustand.
 */
export function reconcileCombatSelection(
  selection: CombatSelection,
  room: GameRoom,
): { selection: CombatSelection; changed: boolean } {
  // Gather eligible attacker uuids (untapped, non-sick creatures on the active player's battlefield)
  const activePlayerId = room.activeTurnPlayerId;
  const eligibleAttackers = new Set(
    room.battlefield
      .filter(c =>
        c.state.controllerId === activePlayerId &&
        c.blueprint.cardTypes.includes('Creature') &&
        !c.state.isTapped &&
        !c.state.summoningSickness &&
        !c.state.attackedThisTurn,
      )
      .map(c => c.uuid),
  );

  // Gather combat attacker uuids (still in room.combat)
  const combatAttackerUuids = new Set(room.combat.map(d => d.uuid));

  // Gather eligible blocker uuids (untapped creatures on the defending player's battlefield)
  const defendingPlayerId = room.activeTurnPlayerId === room.player1Id
    ? room.player2Id! : room.player1Id;
  const eligibleBlockers = new Set(
    room.battlefield
      .filter(c =>
        c.state.controllerId === defendingPlayerId &&
        c.blueprint.cardTypes.includes('Creature') &&
        !c.state.isTapped,
      )
      .map(c => c.uuid),
  );

  const reconciledAttackers = selection.attackers.filter(uuid => eligibleAttackers.has(uuid));
  const reconciledPairs = selection.blockerPairs.filter(
    pair =>
      combatAttackerUuids.has(pair.attackerUuid) &&
      eligibleBlockers.has(pair.blockerUuid),
  );
  const reconciledPending =
    selection.pendingBlocker && eligibleBlockers.has(selection.pendingBlocker)
      ? selection.pendingBlocker
      : null;

  const changed =
    reconciledAttackers.length !== selection.attackers.length ||
    reconciledPairs.length !== selection.blockerPairs.length ||
    reconciledPending !== selection.pendingBlocker;

  return {
    selection: {
      attackers: reconciledAttackers,
      blockerPairs: reconciledPairs,
      pendingBlocker: reconciledPending,
    },
    changed,
  };
}
