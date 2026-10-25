import { describe, it, expect } from 'vitest';
import { ActionRegistry, type ActionHandler } from '@engine/action-registry';

describe('ActionRegistry', () => {
  const mockHandler: ActionHandler = {
    validate: () => ({ success: true }),
    propose: () => ({ success: true }),
    resolve: () => ({ success: true }),
  };

  it('retrieves handlers supplied at construction', () => {
    const registry = new ActionRegistry({ cast_spell: mockHandler });

    expect(registry.get('cast_spell')).toBe(mockHandler);
  });

  it('derives an extended registry without mutating the original', () => {
    const addonHandler: ActionHandler = {
      validate: () => ({ success: true }),
      propose: () => ({ success: true }),
      resolve: () => ({ success: true }),
    };
    const original = new ActionRegistry({ cast_spell: mockHandler });
    const extended = original.with('addon', addonHandler);

    expect(original.get('cast_spell')).toBe(mockHandler);
    expect(original.has('addon')).toBe(false);
    expect(extended.get('addon')).toBe(addonHandler);
  });
});
