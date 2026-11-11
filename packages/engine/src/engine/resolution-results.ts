import type { GameRoom } from '../types/game.room.types';
import type { GameMutation } from '../types/game-mutation.types';
import type { StackObject } from '../types/effect.types';
import type { CardResultDefinition, ResolutionCardResult } from '../types/resolution-result.types';
import { captureSourceInformation } from './source-information';
import { roomCards } from './continuous-effect-state';
import { gameReducer } from './game-reducer';

/** Capture attempted top cards before replacement planning. Cards remain in their authoritative zones. */
export function probeCardResult(
  room: GameRoom,
  object: StackObject,
  definition: CardResultDefinition | undefined,
  produced: GameMutation[],
): ResolutionCardResult | undefined {
  if (!definition || definition.kind !== 'milled') return;
  if (Object.prototype.hasOwnProperty.call(object.resolutionResults ?? {}, definition.name))
    throw new Error('Duplicate resolution result: ' + definition.name);
  const cards = roomCards(room),
    seen = new Set<string>();
  return {
    name: definition.name,
    kind: 'milled',
    cards: produced.flatMap((mutation) => {
      if (
        mutation.type !== 'MOVE_CARD' ||
        mutation.from !== 'library' ||
        mutation.reason !== 'discard' ||
        seen.has(mutation.cardUuid)
      )
        return [];
      const card = cards.find(
        (card) =>
          card.uuid === mutation.cardUuid &&
          card.state.zone === 'library' &&
          (mutation.zoneRevision === undefined || (card.state.zoneRevision ?? 0) === mutation.zoneRevision),
      );
      if (!card) return [];
      seen.add(card.uuid);
      return [{ before: structuredClone(captureSourceInformation(room, card)) }];
    }),
  };
}

/** Record actual successful arrivals, including redirects; cancelled/failed attempts have no arrival. */
export function settleCardResult(
  room: GameRoom,
  object: StackObject,
  probe: ResolutionCardResult | undefined,
  mutations: GameMutation[],
): StackObject {
  if (!probe || probe.kind !== 'milled') return object;
  const result = structuredClone(probe);
  let working = room;
  for (const mutation of mutations) {
    const before = working;
    working = gameReducer(working, mutation);
    if (mutation.type !== 'MOVE_CARD' || mutation.from !== 'library') continue;
    const entry = result.cards.find((entry) => !entry.after && entry.before.card.uuid === mutation.cardUuid);
    if (!entry) continue;
    const old = roomCards(before).find(
      (card) =>
        card.uuid === mutation.cardUuid &&
        card.state.zone === 'library' &&
        (card.state.zoneRevision ?? 0) === (entry.before.card.state.zoneRevision ?? 0),
    );
    /* v8 ignore next -- MOVE_CARD always stamps a numeric revision on the arrived incarnation. */
    const arrived = roomCards(working).find(
      (card) =>
        card.uuid === mutation.cardUuid &&
        card.state.zone === mutation.to &&
        (card.state.zoneRevision ?? 0) === (entry.before.card.state.zoneRevision ?? 0) + 1,
    );
    if (old && arrived) entry.after = structuredClone(captureSourceInformation(working, arrived));
  }
  return { ...object, resolutionResults: { ...object.resolutionResults, [result.name]: result } };
}

/** End of the whole resolving object, never the end of its individual mill instruction. */
export function clearCardResults(object: StackObject): StackObject {
  const { resolutionResults: _results, ...finished } = object;
  return finished;
}
