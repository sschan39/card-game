import { buildPlayerView, buildStackView } from '@server/projection/view-builder';
import { buildCardView } from '@server/projection/card-view';
import { createTestRoom as authoritativeRoom } from './test-room-factory';
import { instantiateCard as authoritativeCard } from '@library/card-factory';
import { creature as authoritativeCreature } from './combat-fixture';
import type { GameRoom } from '@shared/game.room.types';

/** UI fixtures use the same projection boundary as real socket clients. */
export function createTestRoom(overrides?: Partial<GameRoom>) {
  return buildPlayerView(authoritativeRoom({ roomId: 'room', ...overrides }), 'player1');
}
export function instantiateCard(id: string) {
  const room = authoritativeRoom();
  const card = authoritativeCard(id);
  card.state = { ...card.state, ownerId: 'player1', controllerId: 'player1', zone: 'hand' };
  room.players.player1.hand = [card];
  return buildCardView(room, 'player1', card, true);
}
export function creature(uuid: string, ownerId: string) {
  const room = authoritativeRoom(), card = authoritativeCreature(uuid, ownerId);
  room.battlefield = [card];
  return buildCardView(room, ownerId, card, true);
}
export { buildPlayerView, buildStackView, authoritativeRoom, authoritativeCard, authoritativeCreature };
