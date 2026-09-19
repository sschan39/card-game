import { describe, it, expect } from 'vitest';
import { lethalDamageFor } from '../../src/engine/card-utils';
import { instantiateCard } from '../../src/library/card-factory';
import { createTestRoom } from '../helpers/test-room-factory';

describe('lethalDamageFor', () => {
  it('returns toughness for an undamaged creature', () => {
    const room = createTestRoom();
    const card = instantiateCard('empire-servant'); // 1/1
    expect(lethalDamageFor(room, card)).toBe(1);
  });

  it('subtracts existing damage from lethal threshold', () => {
    const room = createTestRoom();
    const card = instantiateCard('empire-servant'); // 1/1
    card.state.damageTaken = 0;
    expect(lethalDamageFor(room, card)).toBe(1);
    card.state.damageTaken = 1;
    expect(lethalDamageFor(room, card)).toBe(0);
  });

  it('returns 0 when damageTaken >= toughness', () => {
    const room = createTestRoom();
    const card = instantiateCard('empire-servant'); // 1/1
    card.state.damageTaken = 3;
    expect(lethalDamageFor(room, card)).toBe(0);
  });
});