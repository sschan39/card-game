import { describe, expect, it } from 'vitest';
import { compileCharacteristicOperation, compileInstruction, compileStaticRules } from '../../packages/engine/src/rules/schema/compile';
import {
  Bounds,
  CardFilterSchema,
  CardResultDefinitionSchema,
  CardResultSourceSchema,
  TargetSchema,
  assertDefinitionTree,
} from '../../packages/engine/src/rules/schema/shared';

const draw = { action: 'DRAW', params: { amount: 1 } };

describe('compileStaticRules', () => {
  it('compiles characteristic rules into layered static definitions, defaulting the group name', () => {
    const rules = compileStaticRules([
      {
        id: 'type-rule',
        family: 'characteristics',
        scope: { zones: ['battlefield'] },
        operation: { type: 'TYPE', add: ['Creature'] },
      },
    ] as never);

    expect(rules).toEqual([
      {
        group: 'type-rule',
        layer: 4,
        scope: { zones: ['battlefield'] },
        effect: { type: 'TYPE', add: ['Creature'] },
      },
    ]);
  });

  it('omits an "effect" group and lifts characteristic-defining stats into layer 7', () => {
    const rules = compileStaticRules([
      { id: 'effect', family: 'characteristics', scope: {}, operation: { type: 'TYPE', add: ['Artifact'] } },
      {
        id: 'stats-rule',
        group: 'stats',
        family: 'characteristics',
        scope: {},
        condition: { op: 'eq', left: { path: 'room.turnNumber' }, right: 1 },
        operation: { type: 'SET_STATS', power: 2, toughness: 2 },
      },
    ] as never);

    expect(rules[0]).toEqual({ layer: 4, scope: {}, effect: { type: 'TYPE', add: ['Artifact'] } });
    expect(rules[1]).toMatchObject({ group: 'stats', layer: 7, condition: { op: 'eq' } });
  });

  it('places permission rules in layer 8', () => {
    const [rule] = compileStaticRules([
      {
        id: 'permission',
        family: 'permissions',
        scope: {},
        operation: { type: 'PERMISSION', rules: [{ action: 'cast', mode: 'instant' }] },
      },
    ] as never);

    expect(rule.layer).toBe(8);
  });

  it('drops rule families that are not characteristics or permissions', () => {
    expect(compileStaticRules([
      { id: 'cost', family: 'costs', action: 'cast', scope: {}, operation: { type: 'mana.reduce', color: 'generic', amount: 1 } },
    ] as never)).toEqual([]);
  });
});

describe('compileInstruction', () => {
  it('compiles a plain instruction and keeps its parameters', () => {
    expect(compileInstruction(draw)).toEqual({ action: 'DRAW', params: { amount: 1 } });
  });

  it('leaves an instruction without parameters alone', () => {
    expect(compileInstruction({ action: 'SHUFFLE' })).toEqual({ action: 'SHUFFLE' });
  });

  it('compiles every nested instruction of a pay-cost branch', () => {
    const compiled = compileInstruction({
      family: 'resources',
      operation: 'pay_cost',
      params: { cost: { life: 1 }, then: [draw, { action: 'SHUFFLE' }] },
    });

    expect(compiled.action).toBe('PAY_COST');
    expect((compiled.params as { then: unknown[] }).then).toEqual([
      { action: 'DRAW', params: { amount: 1 } },
      { action: 'SHUFFLE' },
    ]);
  });

  it('compiles the effect of a continuous-effect instruction', () => {
    const compiled = compileInstruction({
      action: 'CREATE_CONTINUOUS_EFFECT',
      params: { effect: { type: 'ABILITY', add: [{ type: 'activated', id: 'a', effect: draw }] }, duration: 'PERMANENT' },
    });

    expect((compiled.params as { effect: { add: { effect: unknown }[] } }).effect.add[0].effect).toEqual({
      action: 'DRAW',
      params: { amount: 1 },
    });
  });

  it('compiles a delayed trigger ability', () => {
    const compiled = compileInstruction({
      action: 'CREATE_DELAYED_TRIGGER',
      params: { ability: { type: 'triggered', id: 'later', triggerCondition: 'ON_DRAW', effect: draw } },
    });

    expect((compiled.params as { ability: { effect: unknown } }).ability.effect).toEqual({
      action: 'DRAW',
      params: { amount: 1 },
    });
  });

  it('compiles the mode list of option and ordering choices', () => {
    for (const kind of ['options', 'ordering']) {
      const compiled = compileInstruction({
        ...draw,
        choice: { kind, options: [{ id: 'mode', effects: [draw] }] },
      }) as { choice: { options: { effects: unknown[] }[] } };
      expect(compiled.choice.options[0].effects).toEqual([{ action: 'DRAW', params: { amount: 1 } }]);
    }
  });

  it('passes every other choice kind through unchanged', () => {
    const compiled = compileInstruction({ ...draw, choice: { kind: 'discard' } });
    expect(compiled.choice).toEqual({ kind: 'discard' });
  });

  it('omits a missing choice', () => {
    expect(compileInstruction(draw)).not.toHaveProperty('choice');
  });
});

describe('compileCharacteristicOperation', () => {
  it('compiles ability grants only when they add abilities', () => {
    const withAdd = compileCharacteristicOperation({
      type: 'ABILITY',
      add: [{ type: 'activated', id: 'a1', effect: draw }],
    }) as { add: { effect: unknown }[] };
    expect(withAdd.add[0].effect).toEqual({ action: 'DRAW', params: { amount: 1 } });

    const withoutAdd = compileCharacteristicOperation({ type: 'ABILITY', addKeywords: ['Haste'] }) as Record<string, unknown>;
    expect(withoutAdd).toEqual({ type: 'ABILITY', addKeywords: ['Haste'] });
  });

  it('compiles the blueprint of a copy effect, including optional ability lists', () => {
    const compiled = compileCharacteristicOperation({
      type: 'COPY',
      blueprint: {
        abilities: [
          { type: 'activated', id: 'a1', effect: draw },
          { type: 'activated', id: 'a2', effects: [draw, { action: 'SHUFFLE' }] },
          { type: 'activated', id: 'a3', modes: [{ id: 'm', effects: [draw] }] },
          { type: 'static', id: 's1', rules: [{ id: 'r', family: 'characteristics', scope: {}, operation: { type: 'TYPE', add: ['Creature'] } }] },
          { type: 'static', id: 's2', rules: [{ id: 'r2', family: 'permissions', scope: {}, operation: { type: 'PERMISSION', rules: [{ action: 'cast', mode: 'instant' }] } }], effects: [{ layer: 80, scope: {}, effect: { type: 'TYPE', add: ['Artifact'] } }] },
          { type: 'static', id: 's3', effects: [{ layer: 80, scope: {}, effect: { type: 'TYPE', add: ['Artifact'] } }] },
          { type: 'static', id: 's4' },
        ],
        onCastEffects: [draw],
        onEnterEffects: [draw],
      },
    }) as { blueprint: { abilities: Record<string, unknown>[]; onCastEffects: unknown[] } };

    expect(compiled.blueprint.abilities[0].effect).toEqual({ action: 'DRAW', params: { amount: 1 } });
    expect(compiled.blueprint.abilities[1].effects).toEqual([{ action: 'DRAW', params: { amount: 1 } }, { action: 'SHUFFLE' }]);
    expect((compiled.blueprint.abilities[2].modes as { effects: unknown[] }[])[0].effects).toEqual([{ action: 'DRAW', params: { amount: 1 } }]);
    expect((compiled.blueprint.abilities[3].rules as { id: string }[])[0].id).toBe('r');
    expect(compiled.blueprint.abilities[4].effects).toEqual([
      { layer: 80, scope: {}, effect: { type: 'TYPE', add: ['Artifact'] } },
    ]);
    expect(compiled.blueprint.onCastEffects).toEqual([{ action: 'DRAW', params: { amount: 1 } }]);
    expect(compiled.blueprint.onEnterEffects).toEqual([{ action: 'DRAW', params: { amount: 1 } }]);
  });

  it('leaves a copy blueprint without the optional ability lists unchanged', () => {
    const compiled = compileCharacteristicOperation({ type: 'COPY', blueprint: { abilities: [] } }) as {
      blueprint: Record<string, unknown>;
    };
    expect(compiled.blueprint).toEqual({ abilities: [] });
  });

  it('clones every other operation verbatim', () => {
    const operation = { type: 'TYPE', add: ['Creature'] };
    const compiled = compileCharacteristicOperation(operation);
    expect(compiled).toEqual(operation);
    expect(compiled).not.toBe(operation);
  });
});

describe('schema guards', () => {
  it('rejects a bounds range whose minimum exceeds its maximum', () => {
    expect(Bounds.parse({ min: 1 })).toEqual({ min: 1 });
    expect(Bounds.parse({ max: 1 })).toEqual({ max: 1 });
    expect(Bounds.parse({ min: 1, max: 2 })).toEqual({ min: 1, max: 2 });
    expect(() => Bounds.parse({ min: 2, max: 1 })).toThrow('Minimum exceeds maximum');
  });

  it('requires a non-blank card result name', () => {
    expect(CardResultSourceSchema.parse({ kind: 'result', name: 'milled' })).toEqual({ kind: 'result', name: 'milled' });
    expect(() => CardResultSourceSchema.parse({ kind: 'result', name: '   ' })).toThrow('Empty result name');
    expect(CardResultDefinitionSchema.parse({ name: 'captured', kind: 'captured' })).toEqual({ name: 'captured', kind: 'captured' });
    expect(() => CardResultDefinitionSchema.parse({ name: '  ', kind: 'milled' })).toThrow('Empty result name');
  });

  it('parses recursive allOf and anyOf filters', () => {
    expect(CardFilterSchema.parse({ allOf: [{ cardTypes: ['Creature'] }] })).toEqual({ allOf: [{ cardTypes: ['Creature'] }] });
    expect(CardFilterSchema.parse({ anyOf: [{ colors: ['red'] }] })).toEqual({ anyOf: [{ colors: ['red'] }] });
  });

  it('rejects a target range whose minimum exceeds its maximum', () => {
    expect(TargetSchema.parse({ type: 'permanent', required: true })).toEqual({ type: 'permanent', required: true });
    expect(TargetSchema.parse({ type: 'permanent', required: false })).toEqual({ type: 'permanent', required: false });
    expect(TargetSchema.parse({ type: 'permanent', required: false, minTargets: 0, maxTargets: 2 })).toMatchObject({
      minTargets: 0,
      maxTargets: 2,
    });
    expect(() => TargetSchema.parse({ type: 'permanent', required: true, minTargets: 3, maxTargets: 2 })).toThrow(
      'Target minimum exceeds maximum',
    );
  });

  it('bounds rule definition depth, size, cycles and key safety', () => {
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let level = 0; level < 70; level++) {
      const next: Record<string, unknown> = {};
      deep.next = next;
      deep = next;
    }
    void root;
    expect(() => assertDefinitionTree(root)).toThrow('Rule definition exceeds structural limits');
    expect(() => assertDefinitionTree({ list: Array.from({ length: 100_001 }, () => 1) })).toThrow(
      'Rule definition exceeds structural limits',
    );

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => assertDefinitionTree(cyclic)).toThrow('Cyclic rule definition');

    expect(() => assertDefinitionTree({ constructor: 1 })).toThrow('Unsafe rule definition key');

    expect(() => assertDefinitionTree({ a: [1, 'two', null, { b: true }] })).not.toThrow();
  });
});
