import { describe, expect, it } from 'vitest';
import {
  assertAbilityNumericDefinition,
  assertAnnouncementCost,
  assertConditionNumericDefinition,
  assertEffectNumericDefinition,
  assertNoNumericExpressions,
  assertNumericDeclarations,
} from '../../packages/engine/src/library/card-definition-validator';
import type { CardAbility } from '@shared/card.types';
import type { RuleCondition } from '@shared/rule.types';
import type { NumericDeclaration } from '@shared/numeric-value.types';

const drawEffect = { action: 'DRAW', params: { amount: 1 }, tags: [], targeting: { type: 'self' as const, required: false } };
const binding = { numeric: { kind: 'binding', name: 'X' } };

describe('card definition validator: numeric shapes', () => {
  it('rejects reserved numeric expressions in opaque data', () => {
    expect(() => assertNoNumericExpressions({ nested: [{ deeper: binding }] })).toThrow(
      'Numeric expression in an unsupported definition field',
    );
    expect(() => assertNoNumericExpressions({ plain: { amount: 2 } })).not.toThrow();
    expect(() => assertNoNumericExpressions(undefined)).not.toThrow();
  });

  it('rejects non-array and duplicate numeric declarations', () => {
    expect(() => assertNumericDeclarations('nope' as unknown as NumericDeclaration[])).toThrow('Invalid numeric declarations');
    expect(() => assertNumericDeclarations([{ name: 'X', min: 0 }])).not.toThrow();
    expect(() =>
      assertNumericDeclarations([
        { name: 'X', min: 0 },
        { name: 'X', min: 1 },
      ]),
    ).toThrow('Invalid numeric declaration');
  });

  it('surfaces invalid numeric definitions from announcement costs', () => {
    expect(() =>
      assertAnnouncementCost({ mana: { generic: { numeric: { kind: 'add' } } } } as never),
    ).toThrow(/Invalid numeric definition/);

    expect(() =>
      assertAnnouncementCost({ mana: { generic: binding } } as never, [{ name: 'X', min: 0 }]),
    ).not.toThrow();

    expect(() => assertAnnouncementCost(undefined)).not.toThrow();
  });

  it('validates negated rule conditions recursively', () => {
    const condition = { not: { left: 1, right: 2 } } as unknown as RuleCondition;
    expect(() => assertConditionNumericDefinition(condition)).not.toThrow();

    const invalid = { not: { left: binding, right: 2 } } as unknown as RuleCondition;
    expect(() => assertConditionNumericDefinition(invalid)).toThrow('Numeric binding has no retained owner in this definition');

    expect(() => assertConditionNumericDefinition(undefined)).not.toThrow();
  });

  it('checks instruction parameters and payment branches', () => {
    expect(() => assertEffectNumericDefinition(drawEffect)).not.toThrow();

    const payCost = {
      action: 'PAY_COST',
      params: {
        cost: { life: 1 },
        then: [drawEffect],
      },
      tags: [],
      targeting: { type: 'self' as const, required: false },
    };
    expect(() => assertEffectNumericDefinition(payCost)).not.toThrow();

    expect(() =>
      assertEffectNumericDefinition({ ...drawEffect, params: { amount: binding, extra: { unsafe: binding } } }),
    ).toThrow('Numeric binding has no retained owner in this definition');
  });
});

describe('card definition validator: abilities', () => {
  it('rejects cost routes on non-activated abilities', () => {
    const triggered = {
      type: 'triggered',
      id: 'triggered-cost-route',
      castSpeed: 'instant',
      triggerCondition: 'ON_ENTER_BATTLEFIELD',
      trigger: {},
      effect: drawEffect,
      alternativeCosts: [{ id: 'alt', label: 'Alt', cost: {} }],
    } as unknown as CardAbility;

    expect(() => assertAbilityNumericDefinition(triggered)).toThrow('Only ordinary activated abilities support cost routes');
  });

  it('rejects numeric declarations on a self-targeting mana ability', () => {
    const mana = {
      type: 'activated',
      id: 'mana-numeric',
      castSpeed: 'instant',
      cost: {},
      numericDeclarations: [{ name: 'X', min: 0 }],
      effect: { action: 'ADD_MANA', params: {}, tags: [], targeting: { type: 'self', required: false } },
    } as unknown as CardAbility;

    expect(() => assertAbilityNumericDefinition(mana)).toThrow('Mana abilities cannot declare numeric bindings');
  });

  it('rejects cost routes on a self-targeting mana ability', () => {
    const mana = {
      type: 'activated',
      id: 'mana-routes',
      castSpeed: 'instant',
      cost: {},
      effect: { action: 'ADD_MANA', params: {}, tags: [], targeting: { type: 'self', required: false } },
      additionalCost: { life: 1 },
    } as unknown as CardAbility;

    expect(() => assertAbilityNumericDefinition(mana)).toThrow('Mana abilities do not support cost routes');
  });

  it('accepts an activated ability that uses the singular effect form', () => {
    const ability = {
      type: 'activated',
      id: 'single-effect',
      castSpeed: 'instant',
      cost: {},
      effect: drawEffect,
    } as unknown as CardAbility;

    expect(() => assertAbilityNumericDefinition(ability)).not.toThrow();
  });

  it('falls back to an empty effect list when an ability declares neither form', () => {
    const ability = {
      type: 'triggered',
      id: 'no-effects',
      castSpeed: 'instant',
      triggerCondition: 'ON_ENTER_BATTLEFIELD',
      trigger: {},
    } as unknown as CardAbility;

    expect(() => assertAbilityNumericDefinition(ability)).not.toThrow();
  });

  it('checks multiple effects and modes', () => {
    const ability = {
      type: 'activated',
      id: 'multi-effect',
      castSpeed: 'instant',
      cost: {},
      effects: [drawEffect, { ...drawEffect, action: 'DISCARD', params: { count: 1 } }],
      modes: [{ id: 'm1', label: 'Mode', effects: [drawEffect] }],
    } as unknown as CardAbility;

    expect(() => assertAbilityNumericDefinition(ability)).not.toThrow();
  });
});
