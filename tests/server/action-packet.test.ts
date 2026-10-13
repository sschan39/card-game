import { describe, expect, it } from 'vitest';
import { parseActionPacket } from '../../src/server/action-packet';

describe('flat player-action envelope', () => {
  it('separates tracing identity from rule action data', () => {
    expect(parseActionPacket({ roomId: 'r', actionId: 'cast_spell', commandId: 'trace-1', cardUuid: 'c' })).toEqual({
      roomId: 'r', actionId: 'cast_spell', commandId: 'trace-1', data: { cardUuid: 'c' },
    });
  });
  it('ignores malformed tracing metadata without forwarding it as rule data', () => {
    expect(parseActionPacket({ roomId: 'r', actionId: 'addon', commandId: {}, amount: 2 })).toEqual({ roomId: 'r', actionId: 'addon', data: { amount: 2 } });
  });
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
