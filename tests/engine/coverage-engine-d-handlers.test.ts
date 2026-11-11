import { describe, expect, it } from 'vitest';
import { passPriorityHandler } from '@engine/handlers/pass-priority-handler';
import { playLandHandler, validateLandPlay } from '@engine/handlers/play-land-handler';
import { rpsPlayHandler } from '@engine/handlers/rps-play-handler';
import { instantiateCard } from '@library/card-factory';
import { createTestRoom } from '../helpers/test-room-factory';
import type { GameRoom } from '@shared/game.room.types';
import type { PendingChoice } from '@shared/choice.types';
import type { StackObject } from '@shared/effect.types';

const stackObject = {
  type: 'spell',
  uuid: 'spell',
  source: instantiateCard('empire-servant'),
  controllerId: 'player1',
  effects: [],
  countered: false,
} as unknown as StackObject;

function landRoom(): { room: GameRoom; card: ReturnType<typeof instantiateCard> } {
  const room = createTestRoom();
  const land = instantiateCard('land-red');
  land.state = { ...land.state, zone: 'hand', ownerId: 'player1', controllerId: 'player1' };
  room.players.player1.hand = [land];
  return { room, card: land };
}

describe('pass priority handler', () => {
  it('accepts a pass from the priority holder', () => {
    const room = createTestRoom();
    expect(passPriorityHandler.validate(room, 'player1', {})).toEqual({ success: true });
    expect(passPriorityHandler.propose(room, 'player1', {})).toEqual({ success: true });
    expect(passPriorityHandler.resolve(room, stackObject)).toEqual({ success: true });
  });

  it('rejects a pass from the player without priority', () => {
    const room = createTestRoom();
    expect(passPriorityHandler.validate(room, 'player2', {})).toEqual({
      success: false,
      phase: 'validate',
      reason: 'Not your priority!',
    });
  });
});

describe('play land handler', () => {
  it('proposes the battlefield move and records the land play', () => {
    const { room, card } = landRoom();
    const data = { cardUuid: card.uuid, zoneRevision: card.state.zoneRevision ?? 0 };
    expect(validateLandPlay(room, 'player1', data)).toEqual({ success: true });
    expect(playLandHandler.propose(room, 'player1', data)).toEqual({
      success: true,
      mutations: [
        {
          type: 'MOVE_CARD',
          cardUuid: card.uuid,
          playerId: 'player1',
          controllerId: 'player1',
          from: 'hand',
          to: 'battlefield',
          zoneRevision: card.state.zoneRevision ?? 0,
        },
        { type: 'RECORD_LAND_PLAY', playerId: 'player1', turnNumber: 1 },
      ],
    });
  });

  it('rejects a card that is not in the acting hand', () => {
    const { room } = landRoom();
    expect(validateLandPlay(room, 'player1', { cardUuid: 'missing', zoneRevision: 0 })).toEqual({
      success: false,
      phase: 'validate',
      reason: 'Land not found in your hand',
    });
    expect(playLandHandler.propose(room, 'player1', { cardUuid: 'missing', zoneRevision: 0 })).toEqual({
      success: false,
      phase: 'validate',
      reason: 'Land not found in your hand',
    });
  });

  it('waits for the engine to be idle before playing a land', () => {
    const { room, card } = landRoom();
    room.pendingChoice = {
      id: 'choice',
      playerId: 'player1',
      kind: 'optional',
      prompt: 'Yes?',
      min: 1,
      max: 1,
      options: [],
      continuation: { type: 'combat', sourceUuid: card.uuid, passIndex: 0 },
    } as unknown as PendingChoice;
    expect(validateLandPlay(room, 'player1', { cardUuid: card.uuid, zoneRevision: 0 })).toEqual({
      success: false,
      phase: 'validate',
      reason: 'Wait for the current action to finish',
    });
  });
});

describe('RPS play handler', () => {
  it('reports a card that left the hand between validation and proposal', () => {
    const room = createTestRoom({ status: 'RPS', rpsState: { status: 'pending', playedCards: {} } });
    expect(rpsPlayHandler.propose(room, 'player1', { cardUuid: 'gone' })).toEqual({
      success: false,
      phase: 'propose',
      reason: 'Card not in hand',
    });
  });

  it('resolves without further mutations once the card has been committed', () => {
    const room = createTestRoom({ status: 'RPS', rpsState: { status: 'pending', playedCards: {} } });
    expect(rpsPlayHandler.resolve(room, stackObject)).toEqual({ success: true });
  });
});
