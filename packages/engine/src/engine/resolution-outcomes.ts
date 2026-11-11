import type { GameRoom } from '../types/game.room.types';
import type { GameMutation } from '../types/game-mutation.types';
import type { OutcomeDefinition, OutcomeProbe, StackObject } from '../types/effect.types';
import { gameReducer } from './game-reducer';
import { roomCards } from './continuous-effect-state';

/** Remember only the objects this instruction attempted, before replacements run. */
export function probeOutcome(
  room: GameRoom,
  definition: OutcomeDefinition | undefined,
  produced: GameMutation[],
): OutcomeProbe | undefined {
  // Guard: nothing to probe when the instruction declares no outcome.
  if (!definition) return;

  // Collect the card UUIDs the mutations targeted, matching the outcome kind.
  const ids = produced.flatMap((mutation) =>
    definition.kind === 'killed' &&
    ('cardUuid' in mutation || mutation.type === 'ADD_CONTINUOUS_EFFECT' || mutation.type === 'APPLY_DAMAGE_BATCH')
      ? room.battlefield.map((c) => c.uuid)
      : (definition.kind === 'destroyed' && mutation.type === 'DESTROY_CARD') ||
          (definition.kind === 'discarded' && mutation.type === 'MOVE_CARD' && mutation.reason === 'discard') ||
          (definition.kind === 'deployed' && mutation.type === 'MOVE_CARD' && mutation.to === 'battlefield')
        ? [mutation.cardUuid]
        : [],
  );

  // Snapshot the exact incarnations so a later zone change cannot be mistaken
  // for the same object.
  return {
    ...definition,
    cards: roomCards(room)
      .filter((card) => ids.includes(card.uuid))
      .map((card) => ({ cardUuid: card.uuid, zoneRevision: card.state.zoneRevision ?? 0 })),
  };
}

/** Replacements may redirect/cancel: inspect the successful final operation, not intent. */
export function settleOutcome(
  room: GameRoom,
  object: StackObject,
  probe: OutcomeProbe | undefined,
  mutations: GameMutation[],
): StackObject {
  // Guard: no probe means the instruction declared no outcome to settle.
  if (!probe) return object;

  let working = room;
  const successes = new Set<string>();

  // Replay actual arrivals or intrinsic token cessation, retaining the settled destination and exact incarnation.
  for (const mutation of mutations) {
    const before = working;
    working = gameReducer(working, mutation);

    if (mutation.type !== 'MOVE_CARD' || !matchesOutcomeMove(probe.kind, mutation, object.uuid)) continue;

    const old = roomCards(before).find((card) => card.uuid === mutation.cardUuid && card.state.zone === mutation.from);
    const arrived = roomCards(working).find(
      (card) => card.uuid === mutation.cardUuid && card.state.zone === mutation.to,
    );

    // Ordinary arrivals advance the revision; a token succeeds by ceasing from that exact battlefield incarnation.
    const tokenCeased =
      old?.isToken === true &&
      old.state.zone === 'battlefield' &&
      !roomCards(working).some((card) => card.uuid === old.uuid);
    if (
      old &&
      (arrived || tokenCeased) &&
      probe.cards.some((card) => card.cardUuid === old.uuid && card.zoneRevision === (old.state.zoneRevision ?? 0)) &&
      (tokenCeased || (arrived!.state.zoneRevision ?? 0) === (old.state.zoneRevision ?? 0) + 1)
    ) {
      successes.add(old.uuid);
    }
  }

  const succeeded = successes.size >= (probe.minimum ?? 1);
  return { ...object, resolutionOutcomes: { ...object.resolutionOutcomes, [probe.name]: succeeded } };
}

function matchesOutcomeMove(
  kind: OutcomeDefinition['kind'],
  move: Extract<GameMutation, { type: 'MOVE_CARD' }>,
  stackUuid: string,
): boolean {
  switch (kind) {
    case 'deployed': return move.to === 'battlefield' && move.from !== 'battlefield';
    case 'destroyed': return move.to === 'graveyard' && move.reason === 'destroy';
    case 'discarded': return move.to === 'graveyard' && move.reason === 'discard';
    case 'killed':
      return (move.to === 'graveyard' || move.to === 'exile') &&
        move.kill?.causes.some(cause => cause.stackUuid === stackUuid) === true;
  }
}
