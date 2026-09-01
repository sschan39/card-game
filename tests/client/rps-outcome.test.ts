/**
 * tests/client/rps-outcome.test.ts
 * Pure-logic verification of the RPS winner attribution, DOM-free.
 *
 * Guards the regression: the old client handler tested boolean truthiness of
 * `data.winner` (a PlayerId string, always truthy when someone won), so the
 * correct player never saw "you win".
 */
import { describe, it, expect } from 'vitest';
import { classifyRpsOutcome, rpsOutcomeText } from '../../src/client/rpsOutcome';

describe('classifyRpsOutcome', () => {
  it('reports you-win when the winner id matches the local player', () => {
    expect(classifyRpsOutcome({ winner: 'P1' }, 'P1')).toBe('you-win');
  });

  it('reports opponent-win when the winner id differs from the local player', () => {
    expect(classifyRpsOutcome({ winner: 'P1' }, 'P2')).toBe('opponent-win');
  });

  it('reports opponent-win when the local player id is unknown and a winner exists', () => {
    // A non-tie always has a truthy winner id; with no perspective we must not
    // crash into "you win" for a stranger.
    expect(classifyRpsOutcome({ winner: 'P1' }, null)).toBe('opponent-win');
  });

  it('reports tie when data.tie is set, regardless of a stale winner field', () => {
    expect(classifyRpsOutcome({ winner: 'P1', tie: true }, 'P1')).toBe('tie');
  });

  it('reports pending when no winner and no tie (choice recorded only)', () => {
    expect(classifyRpsOutcome({}, 'P1')).toBe('pending');
  });

  it('tie takes precedence over a truthy (but irrelevant) winner id on re-prompt', () => {
    // Regression: a truthy winner string must NOT shadow the tie outcome.
    expect(classifyRpsOutcome({ tie: true, winner: 'P1' }, 'P2')).not.toBe('you-win');
    expect(classifyRpsOutcome({ tie: true, winner: 'P1' }, 'P2')).toBe('tie');
  });
});

describe('rpsOutcomeText', () => {
  it('returns a distinct message per perspective', () => {
    const texts = ['you-win', 'opponent-win', 'tie', 'pending'].map(rpsOutcomeText);
    expect(new Set(texts).size).toBe(4);
  });

  it('you-win text mentions "you"', () => {
    expect(rpsOutcomeText('you-win').toLowerCase()).toContain('you');
  });

  it('opponent-win text does not claim you started', () => {
    expect(rpsOutcomeText('opponent-win').toLowerCase()).not.toContain('you won');
  });
});