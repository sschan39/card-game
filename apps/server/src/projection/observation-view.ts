import { createHmac, randomBytes } from 'node:crypto';
import { observationHasAudience, observationLimits } from '@card-game/engine/shared/observation-policy';
import type { GameRoom } from '@card-game/engine/types/game.room.types';
import type { CardObservation } from '@card-game/engine/types/card-observation.types';
import type { CardObservationView, PlayerView } from '@card-game/protocol';

const key = randomBytes(32);
function handle(roomId: string, viewerId: string, identity: unknown): string {
  return createHmac('sha256', key)
    .update(JSON.stringify([roomId, viewerId, identity]))
    .digest('hex');
}

function projectObservation(
  roomId: string,
  viewerId: string,
  observation: CardObservation,
  identity: unknown,
): CardObservationView | undefined {
  if (!observationHasAudience(observation, viewerId)) return;
  const visible = observation.members.filter((member) => member.audience.faces.includes(viewerId));
  const countVisible = observation.members.length
    ? observation.members.some((member) => member.audience.count.includes(viewerId))
    : observation.emptyAudience.count.includes(viewerId);
  const ordered = visible.length > 0 && visible.every((member) => member.audience.order.includes(viewerId));
  const cards = visible.map((member) => {
    const card = member.snapshot.card;
    const value = card.lastKnownCharacteristics ?? card.blueprint;
    return {
      id: handle(roomId, viewerId, [observation.id, card.uuid, card.state.zoneRevision ?? 0]),
      definitionId: card.blueprint.id,
      name: value.name,
      cardTypes: [...value.cardTypes],
      subTypes: [...(value.subTypes ?? [])],
      rulesText: value.rulesText,
      ...(value.power !== undefined ? { power: value.power } : {}),
      ...(value.toughness !== undefined ? { toughness: value.toughness } : {}),
    };
  });
  // An opaque independent order cannot reveal the original library positions.
  if (!ordered) cards.sort((a, b) => a.id.localeCompare(b.id));
  return {
    id: handle(roomId, viewerId, identity),
    turnNumber: observation.turnNumber,
    ordered,
    ...(countVisible
      ? { count: observation.members.filter((member) => member.audience.count.includes(viewerId)).length }
      : {}),
    ...(cards.length ? { cards } : {}),
  };
}

/** Project historical snapshots and active grants independently for each authenticated player seat. */
export function buildObservationViews(room: GameRoom, viewerId: string): NonNullable<PlayerView['observations']> {
  const active = Object.values(room.cardObservations?.active ?? {}).flatMap((observation) => {
    const view = projectObservation(room.roomId, viewerId, observation, observation.id);
    return view ? [view] : [];
  });
  const history = (room.cardObservations?.history ?? []).flatMap(({ sequence, observation }) => {
    const view = projectObservation(room.roomId, viewerId, observation, [observation.id, sequence]);
    return view ? [view] : [];
  });
  return { active, history: history.slice(-observationLimits.historyLimit) };
}
