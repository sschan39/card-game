import { describe, expect, it } from 'vitest';
import { getBlueprint, instantiateCard } from '@library/card-factory';

describe('instantiateCard runtime dependencies', () => {
  it('uses the supplied UUID capability', () => {
    const card = instantiateCard('empire-servant', { uuid: () => 'card-1' });

    expect(card.uuid).toBe('card-1');
  });

  it('shares one cached blueprint across lookups and instances', () => {
    const blueprint = getBlueprint('empire-servant');

    expect(getBlueprint('empire-servant')).toBe(blueprint);
    expect(instantiateCard('empire-servant').blueprint).toBe(blueprint);
  });

  it('recursively freezes cached blueprints', () => {
    const blueprint = getBlueprint('empire-servant');

    expect(Object.isFrozen(blueprint)).toBe(true);
    expect(Object.isFrozen(blueprint.cardTypes)).toBe(true);
    expect(Object.isFrozen(blueprint.castRequirements)).toBe(true);
    expect(Object.isFrozen(blueprint.abilities)).toBe(true);
    expect(() => blueprint.cardTypes.push('Artifact')).toThrow(TypeError);
    expect(getBlueprint('empire-servant').cardTypes).not.toContain('Artifact');
  });
});
