import type { GameRoom } from '../types/game.room.types';
import type { GameMutation } from '../types/game-mutation.types';
import type { OperationOutcome } from '../types/operation-outcome.types';

/** Prepare Fisher–Yates once. The recorded instruction is deterministic to replay. */
export function planLibraryShuffle(room: GameRoom, playerId: string, random: () => number): GameMutation[] {
  const player = room.players[playerId];
  if (!player) return [];
  const order = player.deck.map(card => ({ cardUuid: card.uuid, zoneRevision: card.state.zoneRevision ?? 0 }));
  for (let index = order.length - 1; index > 0; index--) {
    const sample = random();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw new Error('Random source must return a number in [0, 1)');
    const selected = Math.floor(sample * (index + 1));
    [order[index], order[selected]] = [order[selected], order[index]];
  }
  return [{ type: 'SHUFFLE_LIBRARY', playerId, order }];
}

/** Shuffle reduction consumes an exact prepared permutation; it never rerolls. */
export function applyLibraryShuffle(room: GameRoom, instruction: Extract<GameMutation, { type: 'SHUFFLE_LIBRARY' }>): OperationOutcome {
  const player = room.players[instruction.playerId];
  if (!player) return { status: 'rejected', state: room, reason: 'Shuffle player does not exist' };
  const order = instruction.order;
  const cards = new Map(player.deck.map(card => [card.uuid, card]));
  if (!Array.isArray(order) || order.length !== player.deck.length || cards.size !== player.deck.length ||
      new Set(order.map(reference => reference?.cardUuid)).size !== order.length ||
      order.some(reference => {
        const card = reference && cards.get(reference.cardUuid);
        return !card || card.state.zone !== 'library' || card.state.ownerId !== player.id ||
          !Number.isSafeInteger(reference.zoneRevision) || reference.zoneRevision !== (card.state.zoneRevision ?? 0);
      })) return { status: 'rejected', state: room, reason: 'Shuffle requires the exact current library permutation' };
  const deck = order.map(reference => cards.get(reference.cardUuid)!);
  const state = deck.every((card, index) => card === player.deck[index]) ? room
    : { ...room, players: { ...room.players, [player.id]: { ...player, deck } } };
  return { status: 'committed', state, events: [{ eventId: 'LIBRARY_SHUFFLED', roomId: room.roomId,
    payload: { playerId: player.id, controllerId: player.id } }] };
}
