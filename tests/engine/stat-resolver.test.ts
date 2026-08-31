import { describe, it, expect } from 'vitest';
import { getEffectivePower, getEffectiveToughness } from '../../src/engine/stat-resolver';
import { instantiateCard } from '../../src/library/card-factory';
import type { CardInstance } from '../../src/types/card.types';

function makeCard(): CardInstance {
  const card = instantiateCard('empire-servant'); // 1/1 creature
  card.state.zone = 'battlefield';
  card.state.ownerId = 'player1';
  card.state.controllerId = 'player1';
  return card;
}

describe('stat-resolver', () => {
  it('returns blueprint stats when no modifiers or counters', () => {
    const card = makeCard();
    expect(getEffectivePower(card)).toBe(1);
    expect(getEffectiveToughness(card)).toBe(1);
  });

  it('adds STAT_DELTA modifiers to base stats', () => {
    const card = makeCard();
    card.state.modifiers = [
      { source: 'self', effect: { type: 'STAT_DELTA', power: 2, toughness: 2 }, duration: 'END_OF_TURN' },
    ];
    expect(getEffectivePower(card)).toBe(3);
    expect(getEffectiveToughness(card)).toBe(3);
  });

  it('sums multiple STAT_DELTA modifiers', () => {
    const card = makeCard();
    card.state.modifiers = [
      { source: 'anthem', effect: { type: 'STAT_DELTA', power: 1 }, duration: 'WHILE_ON_BATTLEFIELD' },
      { source: 'giant-growth', effect: { type: 'STAT_DELTA', power: 2, toughness: 2 }, duration: 'END_OF_TURN' },
    ];
    expect(getEffectivePower(card)).toBe(4); // 1 + 1 + 2
    expect(getEffectiveToughness(card)).toBe(3); // 1 + 0 + 2
  });

  it('adds +1/+1 counters on top of modifiers', () => {
    const card = makeCard();
    card.state.modifiers = [
      { source: 'self', effect: { type: 'STAT_DELTA', power: 2 }, duration: 'END_OF_TURN' },
    ];
    card.state.counters['+1/+1'] = 3;
    expect(getEffectivePower(card)).toBe(6); // 1 + 2 + 3
    expect(getEffectiveToughness(card)).toBe(4); // 1 + 0 + 3
  });

  it('ignores non-STAT_DELTA modifiers', () => {
    const card = makeCard();
    card.state.modifiers = [
      { source: 'self', effect: { type: 'SET_STATS', power: 5, toughness: 5 }, duration: 'PERMANENT' },
    ];
    // SET_STATS has no handler yet; resolver only applies STAT_DELTA
    expect(getEffectivePower(card)).toBe(1);
    expect(getEffectiveToughness(card)).toBe(1);
  });

  it('handles cards with no power/toughness (non-creatures)', () => {
    const card = instantiateCard('land-red');
    card.state.zone = 'battlefield';
    expect(getEffectivePower(card)).toBe(0);
    expect(getEffectiveToughness(card)).toBe(0);
  });
});