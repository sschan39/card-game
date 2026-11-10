import { describe, expect, it, vi } from 'vitest';
import { pickRandom, randomInteger, sampleWithoutReplacement, shuffle } from '@rules/random';

describe('shared game randomness', () => {
  it('picks inclusive integer bounds, including negative ranges', () => {
    expect(randomInteger(-3, 1, () => 0)).toBe(-3);
    expect(randomInteger(-3, 1, () => 0.99)).toBe(1);
    expect(randomInteger(-3, 1, () => 0.4)).toBe(-1);
  });

  it('retains descending Fisher–Yates draw order and returns a new list', () => {
    const cards = Object.freeze(['a', 'b', 'c', 'd']);
    const draws = vi.fn().mockReturnValueOnce(0.1).mockReturnValueOnce(0.8).mockReturnValueOnce(0.4);
    expect(shuffle(cards, draws)).toEqual(['b', 'd', 'c', 'a']);
    expect(cards).toEqual(['a', 'b', 'c', 'd']);
    expect(draws).toHaveBeenCalledTimes(3);
  });

  it('samples unique positions in draw order without collapsing equal values', () => {
    const cards = Object.freeze(['same', 'same', 'c', 'd']);
    const draws = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0.34);
    expect(sampleWithoutReplacement(cards, 2, draws)).toEqual(['same', 'same']);
    expect(draws).toHaveBeenCalledTimes(2);
    expect(pickRandom(cards, () => 0.6)).toBe('c');
    expect(sampleWithoutReplacement(cards, 4, () => 0)).toEqual(['same', 'd', 'c', 'same']);
    expect(cards).toEqual(['same', 'same', 'c', 'd']);
  });

  it('does not draw for empty and singleton requests', () => {
    const draw = vi.fn();
    expect(pickRandom([], draw)).toBeUndefined();
    expect(randomInteger(4, 4, draw)).toBe(4);
    expect(sampleWithoutReplacement(['a'], 0, draw)).toEqual([]);
    expect(sampleWithoutReplacement(['a'], 1, draw)).toEqual(['a']);
    expect(shuffle(['a'], draw)).toEqual(['a']);
    expect(draw).not.toHaveBeenCalled();
  });

  it('rejects malformed sizes, unsafe bounds, and invalid injected draws', () => {
    const draw = () => 0;
    expect(() => sampleWithoutReplacement([1], 2, draw)).toThrow(RangeError);
    expect(() => sampleWithoutReplacement([1], -1, draw)).toThrow(RangeError);
    expect(() => randomInteger(2, 1, draw)).toThrow(RangeError);
    expect(() => randomInteger(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, draw)).toThrow(RangeError);
    for (const invalid of [NaN, Infinity, -0.1, 1]) {
      expect(() => pickRandom([1, 2], () => invalid)).toThrow(RangeError);
    }
  });
});
