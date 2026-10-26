import type { GameRoom } from '@card-game/engine/types/game.room.types';
import type { CardInstance } from '@card-game/engine/types/card.types';
import type { StackObject } from '@card-game/engine/types/effect.types';

export function assertViewer(room: GameRoom, viewerId: string): void {
  if ((viewerId !== room.player1Id && viewerId !== room.player2Id) || !Object.prototype.hasOwnProperty.call(room.players, viewerId)) throw new Error('Viewer is not a room member');
}
export const canSeeHand = (viewerId: string, ownerId: string): boolean => viewerId === ownerId;
export const canSeeChoice = (room: GameRoom, viewerId: string): boolean => room.pendingChoice?.playerId === viewerId;
export const canSeeRpsPlay = (room: GameRoom, viewerId: string, ownerId: string): boolean => room.rpsState.status === 'resolved' || viewerId === ownerId;
export const isPublicPermanent = (room: GameRoom, uuid: string): boolean => room.battlefield.some(card => card.uuid === uuid);
export const canSeeRetainedSource = (room: GameRoom, viewerId: string, card: CardInstance): boolean => card.state.zone === 'battlefield' || canSeeCard(room, viewerId, card);
/** A choice can name the viewer's searched library cards; opaque handles carry their identity. */
export function choiceOptionLabel(room: GameRoom, viewerId: string, label: string): string {
  const card = Object.values(room.players).flatMap(player => [...player.deck, ...player.hand]).find(card => card.uuid === label);
  if (!card) return label;
  return card.state.ownerId === viewerId || canSeeCard(room, viewerId, card) ? card.blueprint.name : 'Hidden card';
}
/** Engine-retained battlefield sources were public at announcement/departure. */
export function canSeeStackSource(room: GameRoom, viewerId: string, object: StackObject): boolean {
  return object.type === 'spell' || canSeeCard(room, viewerId, object.source) || object.source.state.zone === 'battlefield'
    || (object.sourceInfo?.card.uuid === object.source.uuid && object.sourceInfo.card.state.zone === 'battlefield');
}
/** Visibility follows authoritative zone membership, not arbitrary nested card references. */
export function canSeeCard(room: GameRoom, viewerId: string, card: CardInstance): boolean {
  return room.battlefield.some(item => item.uuid === card.uuid)
    || room.stack.some(item => item.type === 'spell' && item.source.uuid === card.uuid)
    || room.players[viewerId]?.hand.some(item => item.uuid === card.uuid)
    || Object.values(room.players).some(player => [...player.graveyard, ...player.exile ?? []].some(item => item.uuid === card.uuid));
}

export function visibleTargetCards(room: GameRoom, viewerId: string): CardInstance[] {
  return [...room.battlefield, ...room.players[viewerId].hand,
    ...Object.values(room.players).flatMap(player => [...player.graveyard, ...player.exile ?? []])];
}
