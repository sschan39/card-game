import { actionPermission } from '../shared/action-permissions';
import { sampleWithoutReplacement } from '../shared/random';
import { defaultEffectContext, type EffectContext } from './effect-context';
import type { CardResultSource } from '../types/resolution-result.types';
import type { PendingChoice } from '../types/choice.types';
import type { GameRoom } from '../types/game.room.types';
import type { StackEffect, StackObject } from '../types/effect.types';
import type { CapturedCardResult } from '../types/resolution-result.types';
import type { CardInstance } from '../types/card.types';
import type { GameMutation } from '../types/game-mutation.types';
import type { CardObservation, ObservationVisibility } from '../types/card-observation.types';
import { CaptureWindowSchema, CollectionVisibilitySchema } from '../rules/schema/observations';
import { hiddenObservation, resolveObservationAudience } from '../shared/observation-policy';
import { captureSourceInformation, resolveSourceInformation } from './source-information';
import { collectCardSource } from '../shared/card-collections';
import { matchesCardFilter } from '../shared/card-query';
import { roomCards } from './continuous-effect-state';
import { sameCardObject as sameObservedCard } from '../shared/card-identity';
import { CardCharacteristicService } from './card-characteristic-service';

type WindowPlan = { object: StackObject; mutations: GameMutation[] };

function expose(
  room: GameRoom,
  object: StackObject,
  observation: CardObservation,
  cards: CardInstance[],
  event: 'none' | 'revealed' = 'none',
): WindowPlan {
  const sequence = (room.cardObservations?.sequence ?? 0) + 1;
  const players = [room.player1Id, room.player2Id].filter((id): id is string => !!id);
  const preservePublicOrder = cards.every((card) =>
    observation.members.some(
      (member) =>
        sameObservedCard(card, member.snapshot.card) && players.every((id) => member.audience.order.includes(id)),
    ),
  );
  const revealed = [...cards];
  // Completion events and trigger discovery are public too; never leak a hidden deck order through them.
  if (!preservePublicOrder)
    revealed.sort(
      (a, b) =>
        a.blueprint.name.localeCompare(b.blueprint.name) ||
        a.blueprint.id.localeCompare(b.blueprint.id) ||
        a.uuid.localeCompare(b.uuid),
    );
  const reveals =
    event === 'revealed' && cards.length
      ? [
          ...(object.resolutionReveals ?? []),
          {
            cards: structuredClone(revealed),
            snapshots: observation.members
              .filter((member) => revealed.some((card) => sameObservedCard(card, member.snapshot.card)))
              .map((member) => structuredClone(member.snapshot)),
            sourceInfo: observation.sourceInfo,
            controllerId: object.controllerId,
          },
        ]
      : object.resolutionReveals;
  return {
    object: { ...object, ...(reveals ? { resolutionReveals: reveals } : {}) },
    mutations: [{ type: 'RECORD_CARD_OBSERVATION', observation, sequence }],
  };
}

/** Capture a named top-library window without moving its cards or changing their base visibility. */
export function captureCardWindow(room: GameRoom, object: StackObject, effect: StackEffect,
  context: EffectContext = defaultEffectContext): WindowPlan {
  const params = CaptureWindowSchema.parse(effect.params);
  const definition = effect.recordResult;
  if (!definition || definition.kind !== 'captured') throw new Error('Capture requires a captured result');
  if (Object.prototype.hasOwnProperty.call(object.resolutionResults ?? {}, definition.name)) {
    throw new Error('Duplicate resolution result: ' + definition.name);
  }
  const players = [room.player1Id, room.player2Id].filter((id): id is string => !!id);
  const zoneOwnerId =
    params.zonePlayer === 'opponent' ? players.find((id) => id !== object.controllerId) : object.controllerId;
  if (!zoneOwnerId || !room.players[zoneOwnerId]) throw new Error('Capture source player is unavailable');
  const holder = room.players[zoneOwnerId];
  let cards: CardInstance[];
  if (params.position === 'top') {
    cards = holder.deck.slice(-params.amount).reverse();
  } else {
    const eligible = holder.hand.filter(card => actionPermission(room, object.controllerId, card, 'affect').allowed);
    cards = params.position === 'random'
      ? sampleWithoutReplacement(eligible, Math.min(params.amount, eligible.length), context.random)
      : (collectCardSource(eligible, params.from, object.resolutionResults) ?? []).map(entry => entry.card);
  }
  const audience = resolveObservationAudience(
    params.visibility ?? hiddenObservation,
    object.controllerId,
    zoneOwnerId,
    players,
  );
  const id = `${object.uuid}:window:${definition.name}`;
  const observation: CardObservation = {
    id,
    ownerStackUuid: object.uuid,
    resultName: definition.name,
    ...(params.visibility?.expires === 'hand_exit_or_turn_end' && cards.length ? { expires: 'hand_exit_or_turn_end' as const } : {}),
    controllerId: object.controllerId,
    zoneOwnerId,
    sourceInfo: resolveSourceInformation(room, object),
    emptyAudience: audience,
    turnNumber: room.turnNumber ?? 0,
    members: cards.map((card) => ({ snapshot: captureSourceInformation(room, card), audience })),
  };
  const result: CapturedCardResult = {
    name: definition.name,
    kind: 'captured',
    observationId: id,
    cards: observation.members.map((member) => ({ before: member.snapshot })),
  };
  const captured = { ...object, resolutionResults: { ...object.resolutionResults, [definition.name]: result } };
  return expose(room, captured, observation, cards, params.event);
}

/** Read the one card whose face this resolution publicly revealed. */
export function publicObservedCard(room: GameRoom, object: StackObject, from: CardResultSource): CardInstance | undefined {
  if (!from) return;
  const result = object.resolutionResults?.[from.name];
  if (result?.kind !== 'captured') return;
  const observation = room.cardObservations?.active[result.observationId];
  if (observation?.ownerStackUuid !== object.uuid || observation.members.length !== 1) return;

  const member = observation.members[0];
  const eligible = collectCardSource([member.snapshot.card], from, object.resolutionResults);
  if (eligible?.length !== 1) return;
  if (!room.player2Id || ![room.player1Id, room.player2Id].every(player => member.audience.faces.includes(player))) return;
  const wasRevealed = object.resolutionReveals?.some(reveal =>
    reveal.cards.some(card => sameObservedCard(card, member.snapshot.card)));
  return wasRevealed ? member.snapshot.card : undefined;
}

/** Replace selected current members' grants, retaining every earlier legitimate observation in history. */
export function setCollectionVisibility(room: GameRoom, object: StackObject, effect: StackEffect): WindowPlan {
  const params = CollectionVisibilitySchema.parse(effect.params);
  const result = object.resolutionResults?.[params.from.name];
  const observation = result?.observationId ? room.cardObservations?.active[result.observationId] : undefined;
  if (!result || result.kind !== 'captured' || !observation || observation.ownerStackUuid !== object.uuid) {
    throw new Error("Visibility updates require this resolution's active captured result");
  }
  const current = collectCardSource(roomCards(room), params.from, object.resolutionResults) ?? [];
  const cards = current
    .map((entry) => entry.card)
    .filter((card) =>
      matchesCardFilter(card, CardCharacteristicService.resolve(room, card), params.filter ?? {}, object.controllerId),
    );
  if (!cards.length && observation.members.length) return { object, mutations: [] };
  const audience = resolveObservationAudience(
    params.visibility as ObservationVisibility,
    observation.controllerId,
    observation.zoneOwnerId,
    [room.player1Id, room.player2Id].filter((id): id is string => !!id),
  );
  const updated = {
    ...observation,
    emptyAudience: observation.members.length ? observation.emptyAudience : audience,
    sourceInfo: resolveSourceInformation(room, object),
    members: observation.members.map((member) => {
      const card = cards.find((card) => sameObservedCard(card, member.snapshot.card));
      return card ? { snapshot: captureSourceInformation(room, card), audience } : member;
    }),
  };
  return expose(room, object, updated, cards, params.event);
}

/** Captured-result choices require an active face grant for the actual chooser. */
export function canChooseCapturedCard(room: GameRoom, object: StackObject, name: string, card: CardInstance): boolean {
  const result = object.resolutionResults?.[name];
  if (!result?.observationId) return true;
  const observation = room.cardObservations?.active[result.observationId];
  return (
    !!observation &&
    observation.ownerStackUuid === object.uuid &&
    observation.members.some(
      (member) => sameObservedCard(card, member.snapshot.card) && member.audience.faces.includes(object.controllerId),
    )
  );
}

/** Recheck retained choices against current grants; a saved label is never an information permission. */
export function capturedChoiceAllowed(room: GameRoom, choice: PendingChoice): boolean {
  const continuation = choice.continuation;
  if (choice.kind === 'number' || continuation.type !== 'resolution') return true;
  const definition = continuation.stackObj.effects[continuation.effectIndex]?.choice;
  if (definition?.kind !== 'search' || !definition.from) return true;
  if (!continuation.stackObj.resolutionResults?.[definition.from.name]?.observationId) return true;
  return choice.options.every((option) => {
    const target = option.value as { cardUuid?: string; zone?: string; zoneRevision?: number };
    const card = roomCards(room).find(
      (card) =>
        card.uuid === target.cardUuid &&
        card.state.zone === target.zone &&
        (card.state.zoneRevision ?? 0) === target.zoneRevision,
    );
    return !!card && canChooseCapturedCard(room, continuation.stackObj, definition.from!.name, card);
  });
}

/** Source order is a separate permission; ordinary library searches never expose their deck order. */
export function choiceSourceOrderVisible(room: GameRoom, choice: PendingChoice): boolean {
  const continuation = choice.continuation;
  if (choice.kind === 'number' || continuation.type !== 'resolution') return true;
  const definition = continuation.stackObj.effects[continuation.effectIndex]?.choice;
  if (definition?.kind !== 'search' || definition.zone !== 'library') return true;
  if (!definition.from) return false;
  const result = continuation.stackObj.resolutionResults?.[definition.from.name];
  if (!result?.observationId) return false;
  const observation = room.cardObservations?.active[result.observationId];
  return (
    !!observation &&
    choice.options.every((option) => {
      const target = option.value as { cardUuid?: string; zoneRevision?: number };
      return observation.members.some(
        (member) =>
          member.snapshot.card.uuid === target.cardUuid &&
          (member.snapshot.card.state.zoneRevision ?? 0) === target.zoneRevision &&
          member.audience.order.includes(choice.playerId),
      );
    })
  );
}
