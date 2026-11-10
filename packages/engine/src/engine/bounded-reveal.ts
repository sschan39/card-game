import type { GameRoom } from '../types/game.room.types';
import type { StackObject, StackEffect, EffectDefinition } from '../types/effect.types';
import { buildStackEffects } from './resolution-planning';
import { publicObservation, observationLimits } from '../shared/observation-policy';
import { CardCharacteristicService } from './card-characteristic-service';
import type { CardFilter } from '../types/card-query.types';
import { validCardFilter } from '../shared/card-filter-validation';
import { scorchTargetFilter } from './mechanics/scorch';

/** Expand the bounded reveal into capture, choice and remainder handling. */
export function expandBoundedReveal(
  room: GameRoom,
  stack: StackObject,
  effect: StackEffect,
  index: number,
): StackObject | undefined {
  const self = { type: 'self' as const, required: false };

  let definitions: EffectDefinition[];
  let suffix = Object.keys(stack.resolutionResults ?? {}).length;
  while (Object.prototype.hasOwnProperty.call(stack.resolutionResults ?? {}, `starter_reveal_${suffix}`)) suffix++;
  const name = `starter_reveal_${suffix}`;
  const from = { kind: 'result' as const, name };

  // Only REVEAL_TOP is expanded here; every other action is left to the caller.
  if (effect.action === 'REVEAL_TOP') {
    const count = effect.params.amount;

    // The convenience recipe shares the configurable capture work bound.
    if (!Number.isSafeInteger(count) || (count as number) < 1 || (count as number) > observationLimits.maxWindowCards) {
      return { ...stack, effects: stack.effects.filter((_, i) => i !== index) };
    }

    // The top of the deck is the end of the array; reverse so index 0 is the top.
    const cards = room.players[stack.controllerId].deck.slice(-(count as number)).reverse();

    // Guard: an authored filter must be well-formed before it is used.
    const filter = (effect.params.filter ?? {
      subTypes: effect.params.subTypes,
      excludedNames: effect.params.excludedNames,
    }) as CardFilter;
    if (effect.params.filter !== undefined && !validCardFilter(filter)) {
      return { ...stack, effects: stack.effects.filter((_, i) => i !== index) };
    }

    const clauses = effect.params.matchingClauses as { cardTypes: string[]; subTypes: string[] }[] | undefined;

    // Count the revealed cards that satisfy any matching clause.
    const matchingCount = cards.filter((card) => {
      if (!clauses?.length) return false;

      const value = CardCharacteristicService.resolve(room, card);
      return clauses.some(
        (clause) =>
          clause.cardTypes.some((type) => value.cardTypes.some((actual) => actual === type)) &&
          clause.subTypes.some((type) => value.subTypes.includes(type)),
      );
    }).length;

    // Scorch disposition adds counters; otherwise the player may take one card.
    const first: EffectDefinition =
      effect.params.disposition === 'scorch'
        ? {
            action: 'ADD_COUNTER',
            params: { counterType: 'scorch', amount: matchingCount },
            targeting: self,
            choice: {
              kind: 'selection',
              criteria: {
                type: 'permanent',
                controller: 'opponent',
                ...scorchTargetFilter,
                required: true,
                minTargets: 1,
                maxTargets: 1,
              },
            },
          }
        : {
            action: 'MOVE_ZONE',
            params: { origin: 'library', destination: 'hand' },
            targeting: self,
            choice: {
              ...filter,
              kind: 'search',
              zone: 'library',
              from,
              min: (effect.params.min as number | undefined) ?? 0,
              max: (effect.params.max as number | undefined) ?? 1,
            },
          };

    const remainder: EffectDefinition = effect.params.remainder === 'discard'
      ? { action: 'DISCARD_CAPTURED', params: { from }, targeting: self }
      : {
          action: 'REORDER_LIBRARY',
          params: { placement: 'bottom' },
          targeting: self,
          choice: { kind: 'search', zone: 'library', from, ordered: true, allAvailable: true },
        };

    definitions = [
      {
        action: 'CAPTURE_WINDOW',
        params: { zone: 'library', position: 'top', amount: count, visibility: publicObservation, event: 'revealed' },
        recordResult: { name, kind: 'captured' },
        targeting: self,
      },
      first,
      remainder,
    ];
  } else {
    return;
  }

  // Splice the expanded instructions in place of the original one.
  return {
    ...stack,
    effects: [
      ...stack.effects.slice(0, index),
      ...buildStackEffects(definitions, stack.controllerId, stack.source).map((child, offset) => ({
        ...child,
        instructionId: `${effect.instructionId ?? index}:reveal:${offset}`,
      })),
      ...stack.effects.slice(index + 1),
    ],
  };
}
