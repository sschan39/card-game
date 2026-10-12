import type { GameRoom } from '../types/game.room.types';
import type { GameMutation } from '../types/game-mutation.types';
import type { OperationOutcome } from '../types/operation-outcome.types';
import type { LibraryCardReference, LibraryPlacement } from '../types/library.types';
import type { CardInstance } from '../types/card.types';

function exactLibraryCards(room: GameRoom, playerId: string, references: readonly LibraryCardReference[], complete: boolean): CardInstance[] | undefined {
  const player = room.players[playerId];
  if (!player || !Array.isArray(references) || (complete && references.length !== player.deck.length)) return;
  const cards = new Map(player.deck.map(card => [card.uuid, card]));
  if (cards.size !== player.deck.length || new Set(references.map(reference => reference?.cardUuid)).size !== references.length) return;
  const selected: CardInstance[] = [];
  for (const reference of references) {
    const card = reference && cards.get(reference.cardUuid);
    if (!card || card.state.zone !== 'library' || card.state.ownerId !== player.id ||
        !Number.isSafeInteger(reference.zoneRevision) || reference.zoneRevision < 0 || reference.zoneRevision !== (card.state.zoneRevision ?? 0)) return;
    selected.push(card);
  }
  return selected;
}

function withLibraryOrder(room: GameRoom, playerId: string, deck: CardInstance[]): GameRoom {
  const player = room.players[playerId];
  return deck.every((card, index) => card === player.deck[index]) ? room
    : { ...room, players: { ...room.players, [playerId]: { ...player, deck } } };
}

/** Selected order is top-to-bottom; recorded permutations use bottom-to-top storage. */
export function planLibraryReorder(room: GameRoom, playerId: string, selectedTopToBottom: readonly LibraryCardReference[], placement: LibraryPlacement): GameMutation[] {
  if (placement !== 'top' && placement !== 'bottom') return [];
  const selected = exactLibraryCards(room, playerId, selectedTopToBottom, false);
  if (!selected?.length) return [];
  const selectedIds = new Set(selected.map(card => card.uuid));
  const untouched = room.players[playerId].deck.filter(card => !selectedIds.has(card.uuid));
  const block = [...selected].reverse();
  const deck = placement === 'top' ? [...untouched, ...block] : [...block, ...untouched];
  return [{ type: 'REORDER_LIBRARY', playerId, order: deck.map(card => ({ cardUuid: card.uuid, zoneRevision: card.state.zoneRevision ?? 0 })) }];
}

export function applyLibraryReorder(room: GameRoom, instruction: Extract<GameMutation, { type: 'REORDER_LIBRARY' }>): OperationOutcome {
  const deck = exactLibraryCards(room, instruction.playerId, instruction.order, true);
  if (!deck) return { status: 'rejected', state: room, reason: 'Reorder requires the exact current library permutation' };
  const state = withLibraryOrder(room, instruction.playerId, deck);
  return state === room ? { status: 'unchanged', state } : { status: 'committed', state, events: [] };
}

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
  const deck = exactLibraryCards(room, instruction.playerId, instruction.order, true);
  if (!deck) return { status: 'rejected', state: room, reason: 'Shuffle requires the exact current library permutation' };
  const state = withLibraryOrder(room, instruction.playerId, deck);
  return { status: 'committed', state, events: [{ eventId: 'LIBRARY_SHUFFLED', roomId: room.roomId,
    payload: { playerId: player.id, controllerId: player.id } }] };
}
