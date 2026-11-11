/** A unit-interval draw supplied by the match or test. */
export type RandomSource = () => number;

/** Pick an integer from the inclusive bounds. A singleton range consumes no draw. */
export function randomInteger(min: number, max: number, random: RandomSource): number {
  const width = max - min + 1;
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || !Number.isSafeInteger(width) || width < 1) {
    throw new RangeError('Random integer bounds must define a nonempty safe integer range');
  }
  if (width === 1) return min;

  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
    throw new RangeError('Random source must return a number in [0, 1)');
  }
  return min + Math.min(width - 1, Math.floor(sample * width));
}

/** Pick one item by position, or return undefined for an empty list. */
export function pickRandom<T>(items: readonly T[], random: RandomSource): T | undefined {
  if (!items.length) return undefined;
  return items[randomInteger(0, items.length - 1, random)];
}

/** Sample distinct positions in draw order without changing the original list. */
export function sampleWithoutReplacement<T>(items: readonly T[], count: number, random: RandomSource): T[] {
  if (!Number.isSafeInteger(count) || count < 0 || count > items.length) {
    throw new RangeError('Random sample size must be between zero and the number of items');
  }
  if (!count) return [];
  if (count === 1) return [pickRandom(items, random)!];

  const shuffled = shuffleTail(items, count, random);
  return shuffled.slice(-count).reverse();
}

/** Return a Fisher–Yates permutation with the same descending draw order used by deck shuffles. */
export function shuffle<T>(items: readonly T[], random: RandomSource): T[] {
  return shuffleTail(items, items.length, random);
}

function shuffleTail<T>(items: readonly T[], count: number, random: RandomSource): T[] {
  const result = [...items];
  const stop = Math.max(1, result.length - count);
  for (let index = result.length - 1; index >= stop; index--) {
    const selected = randomInteger(0, index, random);
    [result[index], result[selected]] = [result[selected], result[index]];
  }
  return result;
}
