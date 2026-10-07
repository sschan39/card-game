import { describe, expect, it } from 'vitest';
import { parseActionPacket } from '../../src/server/action-packet';

describe('flat player-action envelope', () => {
  it.each([null, undefined, [], 12, 'bad', {}, { roomId: 'r' }, { roomId: ' ', actionId: 'a' },
    { roomId: 'r', actionId: {} }])('rejects malformed packet %j', packet => {
    expect(parseActionPacket(packet)).toBeNull();
  });
  it('keeps extension fields while stripping transport and claimed identity', () => {
    expect(parseActionPacket({ roomId: 'r', actionId: 'addon', playerId: 'other', socketId: 'other',
      cardUuid: 'card', amount: 7, targets: [{ targetType: 'self' }] })).toEqual({
      roomId: 'r', actionId: 'addon', data: { cardUuid: 'card', amount: 7, targets: [{ targetType: 'self' }] },
    });
  });
});
