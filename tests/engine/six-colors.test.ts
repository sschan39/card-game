import { describe, expect, it } from 'vitest';
import { MANA_COLORS } from '../../src/types/card.types';
import { normalizeCard, parseManaCost } from '../../src/library/card-parser';
import { instantiateCard } from '../../src/library/card-factory';
import { CardCharacteristicService } from '../../src/engine/card-characteristic-service';
import { createTestRoom } from '../helpers/test-room-factory';

describe('six game colors', () => {
  it('uses yellow as the sixth resource, keeping generic payment separate', () => {
    expect([...MANA_COLORS].sort()).toEqual(['black', 'blue', 'green', 'red', 'white', 'yellow']);
    expect(parseManaCost('{2}{Y}{W}{U}')).toEqual({ generic: 2, yellow: 1, white: 1, blue: 1 });
    expect(() => parseManaCost('{C}')).toThrow('Unsupported mana cost');
  });
  it.each([['R', 'red'], ['B', 'black'], ['G', 'green'], ['Y', 'yellow'], ['W', 'white'], ['U', 'blue']])('infers %s from its cost when colors is omitted', (symbol, color) => {
    const room = createTestRoom(), source = instantiateCard('empire-servant');
    source.blueprint = normalizeCard({ id: 'color-inference', manaCost: `{${symbol}}`, cardTypes: ['Creature'], power: 1, toughness: 1 });
    room.players.player1.hand = [source];
    expect(CardCharacteristicService.resolveColors(room, source)).toEqual([color]);
  });
});
