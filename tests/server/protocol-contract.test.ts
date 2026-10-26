import { describe, expect, it } from 'vitest';
import { ACTION_IDS, ACTION_ID_LABELS, parseActionPacket, PROTOCOL_VERSION } from '@card-game/protocol';
import { ACTION_IDS as engineIds, ACTION_ID_LABELS as engineLabels } from '@shared/action.ids';
describe('wire protocol contract', () => {
  it('keeps action vocabulary in parity with the authoritative handlers', () => {
    expect(ACTION_IDS).toEqual(engineIds); expect(ACTION_ID_LABELS).toEqual(engineLabels);
  });
  it.each([undefined, null, 0, 2, '1'])('rejects unsupported command version %j', protocolVersion => {
    expect(parseActionPacket({ protocolVersion, roomId: 'room', actionId: 'pass_priority' })).toBeNull();
  });
  it('removes transport identity and version fields before dispatch', () => {
    expect(parseActionPacket({ protocolVersion: PROTOCOL_VERSION, roomId: 'room', actionId: 'pass_priority', playerId: 'spoof', socketId: 'spoof' }))
      .toEqual({ roomId: 'room', actionId: 'pass_priority', data: {} });
  });
});
