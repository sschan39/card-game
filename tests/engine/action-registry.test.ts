import { describe, it, expect, beforeEach } from 'vitest';
import { ActionRegistry, registerAction, type ActionHandler } from '../../src/engine/action-registry';

describe('ActionRegistry', () => {
  const mockHandler: ActionHandler = {
    validate: () => ({ success: true }),
    propose: () => ({ success: true }),
    resolve: () => ({ success: true }),
  };

  beforeEach(() => {
    // Clear registry between tests
    Object.keys(ActionRegistry).forEach(key => delete ActionRegistry[key]);
  });

  it('should register and retrieve an action handler', () => {
    registerAction('cast_spell', mockHandler);
    expect(ActionRegistry['cast_spell']).toBe(mockHandler);
  });

  it('should allow multiple action types', () => {
    const drawHandler: ActionHandler = {
      validate: () => ({ success: true }),
      propose: () => ({ success: true }),
      resolve: () => ({ success: true }),
    };
    registerAction('cast_spell', mockHandler);
    registerAction('draw_card', drawHandler);
    expect(ActionRegistry['cast_spell']).toBe(mockHandler);
    expect(ActionRegistry['draw_card']).toBe(drawHandler);
  });

  it('should return undefined for unregistered actions', () => {
    expect(ActionRegistry['nonexistent']).toBeUndefined();
  });

  it('should allow overriding an existing handler', () => {
    const newHandler: ActionHandler = {
      validate: () => ({ success: false, phase: 'validate', reason: 'nope' }),
      propose: () => ({ success: true }),
      resolve: () => ({ success: true }),
    };
    registerAction('cast_spell', mockHandler);
    registerAction('cast_spell', newHandler);
    expect(ActionRegistry['cast_spell']).toBe(newHandler);
  });
});