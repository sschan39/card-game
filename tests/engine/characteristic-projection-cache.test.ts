import { describe, expect, it } from 'vitest';
import { CardCharacteristicService as characteristics, withCharacteristicCache } from '@engine/card-characteristic-service';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';

describe('projection characteristic evaluation scope', () => {
  it('matches independent resolutions, including control, counters and retained departure snapshots', () => {
    const room = createTestRoom(), card = creature('cache', 'player1');
    room.battlefield = [card]; card.state.counters['+1/+1'] = 2;
    room.continuousEffectPool = [{ source: 'global', requiredZone: null, duration: 'PERMANENT', layer: 2,
      scope: { cardUuid: card.uuid }, effect: { type: 'CONTROL', controllerId: 'player2' } }];
    const expected = characteristics.resolve(room, card), copy = characteristics.resolveCopiableBlueprint(room, card);
    const departed = structuredClone(card); departed.state.zoneRevision = 99;
    departed.lastKnownCharacteristics = { ...expected, power: 17 };
    withCharacteristicCache(room, () => {
      expect(characteristics.resolve(room, card)).toEqual(expected);
      expect(characteristics.resolvePower(room, card)).toBe(expected.power);
      expect(characteristics.resolveCopiableBlueprint(room, card)).toEqual(copy);
      expect(characteristics.resolvePower(room, departed)).toBe(17);
    });
  });
  it('expires between projections and restores nested scopes even after exceptions', () => {
    const room = createTestRoom(), card = room.players.player1.hand[0], other = createTestRoom();
    const original = characteristics.resolvePower(room, card);
    withCharacteristicCache(room, () => {
      expect(() => withCharacteristicCache(other, () => { throw new Error('scope'); })).toThrow('scope');
      expect(characteristics.resolvePower(room, card)).toBe(original);
    });
    card.state.counters['+1/+1'] = 3;
    withCharacteristicCache(room, () => expect(characteristics.resolvePower(room, card)).toBe(original + 3));
    expect(characteristics.resolvePower(room, card)).toBe(original + 3);
  });
});
