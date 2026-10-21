import { describe, expect, it } from 'vitest';
import { instantiateCard } from '../../src/library/card-factory';

describe('instantiateCard runtime dependencies', () => {
  it('uses the supplied UUID capability', () => {
    const card = instantiateCard('empire-servant', { uuid: () => 'card-1' });

    expect(card.uuid).toBe('card-1');
  });
});
