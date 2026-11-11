import type { CardInstance, CardZone } from '../types/card.types';
import type { GameRoom } from '../types/game.room.types';
import type { GameMutation } from '../types/game-mutation.types';
import { captureSourceInformation, retainDepartingSource } from './source-information';
import { nextEffectTimestamp } from './continuous-effects';
import { createCardState } from '../shared/card-state';

/** Map a card zone to the player field that stores it, if any. */
const playerZoneKey = (zone: CardZone): 'hand' | 'graveyard' | 'deck' | 'exile' | undefined => {
  switch (zone) {
    case 'hand': return 'hand';
    case 'graveyard': return 'graveyard';
    case 'library': return 'deck';
    case 'exile': return 'exile';
  }
};

/** Immutable reducer copies retain the same logical card identity and metadata. */
export function resetCardForZone(card: CardInstance, zone: CardZone, controllerId = card.state.ownerId): CardInstance {
  const { lastKnownCharacteristics, lastKnownCopiableCharacteristics, ...identity } = card;

  return {
    ...identity,
    state: {
      ...createCardState(card.blueprint, card.state.ownerId, controllerId, zone),
      // A real zone change bumps the revision; a same-zone reset does not.
      zoneRevision: (card.state.zoneRevision ?? 0) + (zone !== card.state.zone ? 1 : 0),
    },
  };
}

export function getCardInZone(room: GameRoom, uuid: string, playerId: string, zone: CardZone): CardInstance | undefined {
  if (zone === 'battlefield') return room.battlefield.find((card) => card.uuid === uuid);
  if (zone === 'stack') return room.stack.find((object) => object.type === 'spell' && object.source.uuid === uuid)?.source;

  const key = playerZoneKey(zone);

  return key ? room.players[playerId]?.[key]?.find((card) => card.uuid === uuid) : undefined;
}

/** Validate the complete move before removing anything. Abilities aren't card occupants. */
export function validateCardMove(room: GameRoom, move: Extract<GameMutation, { type: 'MOVE_CARD' }>): boolean {
  // Guard: a move must change zone and belong to a known player.
  if (move.from === move.to || !room.players[move.playerId]) return false;

  const card = getCardInZone(room, move.cardUuid, move.playerId, move.from);

  // Guard: the card must be where the move says it is, and owned by that player.
  if (!card || (card.state.ownerId && card.state.ownerId !== move.playerId)) return false;

  // Guard: the client's revision must match the live card.
  if (
    move.zoneRevision !== undefined &&
    (!Number.isSafeInteger(move.zoneRevision) || move.zoneRevision < 0 || move.zoneRevision !== (card.state.zoneRevision ?? 0))
  ) {
    return false;
  }

  // Guard: library placement and an explicit index are mutually exclusive.
  if (move.libraryPlacement !== undefined && (move.libraryPlacement !== 'top' && move.libraryPlacement !== 'bottom' || move.toIndex !== undefined)) {
    return false;
  }

  // A token which has left the battlefield cannot move to another zone again.
  if (card.isToken && move.from !== 'battlefield') return false;

  // Guard: the destination must not already hold this card.
  if (getCardInZone(room, card.uuid, move.playerId, move.to)) return false;

  const destination = playerZoneKey(move.to);
  if (!destination && move.to !== 'battlefield' && move.to !== 'stack') return false;

  // Guard: an explicit index must be a valid insertion point.
  if (
    move.toIndex !== undefined &&
    (!destination ||
      !Number.isSafeInteger(move.toIndex) ||
      move.toIndex < 0 ||
      move.toIndex > (room.players[move.playerId][destination]?.length ?? 0))
  ) {
    return false;
  }

  const spell = move.stackObject;

  // Guard: a stack move needs a fresh spell object for this exact card.
  if (
    move.to === 'stack' &&
    (!spell ||
      spell.type !== 'spell' ||
      spell.source.uuid !== card.uuid ||
      !spell.uuid ||
      room.stack.some((object) => object.uuid === spell.uuid))
  ) {
    return false;
  }

  const sourceSpell = move.from === 'stack'
    ? room.stack.find((object) => object.type === 'spell' && object.source.uuid === card.uuid)
    : undefined;
  const ownerId = card.state.ownerId || move.playerId;
  const controllerId = move.to === 'stack'
    ? spell!.controllerId
    : move.to === 'battlefield'
      ? move.controllerId ?? sourceSpell?.controllerId ?? ownerId
      : ownerId;

  return !!room.players[controllerId];
}

export function moveCard(room: GameRoom, move: Extract<GameMutation, { type: 'MOVE_CARD' }>): GameRoom {
  // Guard: an invalid move leaves the room untouched.
  if (!validateCardMove(room, move)) return room;

  const card = getCardInZone(room, move.cardUuid, move.playerId, move.from)!;
  const destination = playerZoneKey(move.to);
  const spell = move.stackObject;
  const sourceSpell = move.from === 'stack'
    ? room.stack.find((object) => object.type === 'spell' && object.source.uuid === card.uuid)
    : undefined;
  const ownerId = card.state.ownerId || move.playerId;
  const controllerId = move.to === 'stack'
    ? spell!.controllerId
    : move.to === 'battlefield'
      ? move.controllerId ?? sourceSpell?.controllerId ?? ownerId
      : ownerId;

  const updated = resetCardForZone({ ...card, state: { ...card.state, ownerId } }, move.to, controllerId);

  // A permanent that arrived from the stack was cast; anything else came from an effect.
  if (move.to === 'battlefield') updated.state.summonKind = sourceSpell || move.reason === 'cast' ? 'cast' : 'effect';

  updated.state.characteristicTimestamp = nextEffectTimestamp(room);

  const snapshot = move.sourceSnapshot ?? captureSourceInformation(room, card);

  // Stack objects and delayed triggers keep the last known source information.
  let next = { ...room, stack: room.stack.map((object) => retainDepartingSource(object, snapshot)) };

  if (room.delayedTriggers) {
    next = {
      ...next,
      delayedTriggers: room.delayedTriggers.map((registration) => {
        const retained = retainDepartingSource({
          type: 'triggered',
          uuid: registration.id,
          source: registration.source,
          sourceInfo: registration.sourceInfo,
          controllerId: registration.controllerId,
          effects: [],
          countered: false,
        }, snapshot);

        return retained.sourceInfo === registration.sourceInfo
          ? registration
          : { ...registration, sourceInfo: retained.sourceInfo! };
      }),
    };
  }

  // Remove the card from its current zone.
  if (move.from === 'battlefield') {
    next = { ...next, battlefield: next.battlefield.filter((c) => c.uuid !== card.uuid) };
  } else if (move.from === 'stack') {
    next = { ...next, stack: next.stack.filter((object) => object !== sourceSpell) };
  } else {
    const key = playerZoneKey(move.from)!;
    next = {
      ...next,
      players: {
        ...next.players,
        [move.playerId]: {
          ...next.players[move.playerId],
          [key]: next.players[move.playerId][key]!.filter((c) => c.uuid !== card.uuid),
        },
      },
    };
  }

  // Tokens cease as part of departure. The settled destination remains semantic event data, never occupancy.
  if (card.isToken) return next;

  // Insert the card into its destination zone.
  if (move.to === 'battlefield') return { ...next, battlefield: [...next.battlefield, updated] };
  if (move.to === 'stack') return { ...next, stack: [...next.stack, { ...spell!, source: updated }] };

  const cards = [...next.players[move.playerId][destination!] ?? []];

  // Bottom placement means index 0 in the stored (bottom-to-top) deck array.
  const index = move.to === 'library' && move.libraryPlacement === 'bottom' ? 0 : move.toIndex ?? cards.length;
  cards.splice(index, 0, updated);

  return { ...next, players: { ...next.players, [move.playerId]: { ...next.players[move.playerId], [destination!]: cards } } };
}
