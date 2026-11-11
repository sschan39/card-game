import type { GameRoom } from '../types/game.room.types';
import type { CardObservation } from '../types/card-observation.types';
import { sameCardObject } from '../shared/card-identity';
import { observationLimits, observationHasAudience } from '../shared/observation-policy';

/** Commit a monotonic, replay-safe exposure revision and retain its immutable authorized history. */
export function recordCardObservation(room: GameRoom, observation: CardObservation, sequence: number): GameRoom {
  const old = room.cardObservations ?? { sequence: 0, active: {}, history: [] };
  if (!Number.isSafeInteger(sequence) || sequence <= 0 || sequence !== old.sequence + 1) return room;
  const snapshot = structuredClone(observation);
  const entries = [...old.history, { sequence, observation: snapshot }];
  const retained = new Set<number>();
  // A private observation cannot evict another player's legitimate history or disclose a private revision count.
  for (const playerId of [room.player1Id, room.player2Id]) {
    if (!playerId) continue;
    const visible = entries.filter((entry) => observationHasAudience(entry.observation, playerId));
    for (const entry of visible.slice(-observationLimits.historyLimit)) retained.add(entry.sequence);
  }
  return {
    ...room,
    cardObservations: {
      sequence,
      active: { ...old.active, [observation.id]: snapshot },
      history: entries.filter((entry) => retained.has(entry.sequence)),
    },
  };
}

/** Close temporary grants while retaining snapshots already legitimately observed by their audiences. */
export function closeCardObservations(room: GameRoom, ownerStackUuid?: string): GameRoom {
  if (!room.cardObservations) return room;
  const active = Object.fromEntries(
    Object.entries(room.cardObservations.active).filter(
      ([, observation]) => ownerStackUuid !== undefined &&
        (observation.ownerStackUuid !== ownerStackUuid || observation.expires === 'hand_exit_or_turn_end'),
    ),
  );
  if (Object.keys(active).length === Object.keys(room.cardObservations.active).length) return room;
  return { ...room, cardObservations: { ...room.cardObservations, active } };
}

/** End a hand reveal on departure or cleanup, retaining its already public history. */
export function reconcileHandObservations(room: GameRoom, endTurn = false): GameRoom {
  const observations = room.cardObservations;
  if (!observations) return room;
  const active: Record<string, CardObservation> = {};
  let changed = false;
  for (const [id, observation] of Object.entries(observations.active)) {
    if (observation.expires !== 'hand_exit_or_turn_end') {
      active[id] = observation;
      continue;
    }

    const hand = room.players[observation.zoneOwnerId]?.hand ?? [];
    const members = endTurn ? [] : observation.members.filter(member =>
      hand.some(card => sameCardObject(card, member.snapshot.card)));
    if (members.length !== observation.members.length) changed = true;
    if (members.length) active[id] = { ...observation, members };
  }
  return changed ? { ...room, cardObservations: { ...observations, active } } : room;
}
