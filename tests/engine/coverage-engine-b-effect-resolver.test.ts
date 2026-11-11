import { describe, expect, it } from 'vitest';
import { planStackResolution, resolveEffects, resolveStackObject } from '@engine/effect-resolver';
import type { StackEffect, StackObject } from '@shared/effect.types';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';

function effect(over: Partial<StackEffect> = {}): StackEffect {
  return {
    action: 'ADD_MANA',
    params: { color: 'red', amount: 1 },
    tags: [],
    targets: [],
    targeting: { type: 'self', required: false },
    ...over,
  };
}

function spell(over: Partial<StackObject> = {}): StackObject {
  const source = creature('spell-source', 'player1');
  source.state.zone = 'stack';
  return {
    type: 'spell',
    uuid: 'stack-object',
    controllerId: 'player1',
    source,
    effects: [effect()],
    countered: false,
    ...over,
  } as unknown as StackObject;
}

describe('resolveEffects', () => {
  it('skips an instruction whose condition no longer holds', () => {
    const room = createTestRoom();
    const results: never[] = [];
    const object = spell({
      effects: [
        effect({ condition: { op: 'eq', left: { path: 'room.phase' }, right: 'declareAttackersStep' } }),
        effect({ action: 'ADD_MANA', params: { color: 'blue', amount: 2 } }),
      ],
    });
    const mutations = resolveEffects(room, object, results);
    expect(results).toEqual([
      { effectId: 'ADD_MANA', fizzled: false, skipped: 'condition_failed' },
      { effectId: 'ADD_MANA', fizzled: false },
    ]);
    expect(mutations.length).toBeGreaterThan(0);
  });

  it('re-resolves locked targets and drops ones of an unknown kind', () => {
    const room = createTestRoom();
    const results: never[] = [];
    const object = spell({
      effects: [
        effect({
          action: 'DESTROY',
          params: {},
          targeting: { type: 'permanent', required: true, maxTargets: 1 },
          targets: [{ targetType: 'bogus' }],
        }),
      ],
    });
    const mutations = resolveEffects(room, object, results, true);
    expect(mutations).toEqual([]);
    expect(results).toEqual([{ effectId: 'DESTROY', fizzled: false, skipped: 'illegal_targets' }]);
  });
});

describe('resolveStackObject', () => {
  it('returns the mutations and publishes the effect results', () => {
    expect(resolveStackObject(createTestRoom(), spell()).length).toBeGreaterThan(0);
    const results: unknown[] = [];
    resolveStackObject(createTestRoom(), spell(), results);
    expect(results).toEqual([{ effectId: 'ADD_MANA', fizzled: false }]);
  });

  it('publishes nothing while a payment choice is pending', () => {
    const results: unknown[] = [];
    const mutations = resolveStackObject(
      createTestRoom(),
      spell({ effects: [effect({ action: 'PAY_COST', params: { cost: {} } })] }),
      results,
    );
    expect(results).toEqual([]);
    expect(mutations).toEqual([]);
  });

  it('passes the pending payment choice to the caller', () => {
    const plan = planStackResolution(
      createTestRoom(),
      spell({ effects: [effect({ action: 'PAY_COST', params: { cost: {} } })] }),
    );
    expect(plan.resolution).toBeUndefined();
    expect(plan.pendingChoice).toMatchObject({ kind: 'optional' });
  });
});

describe('planStackResolution', () => {
  it('runs a visibility update instruction', () => {
    const room = createTestRoom();
    expect(() =>
      planStackResolution(room, spell({ effects: [effect({ action: 'SET_COLLECTION_VISIBILITY', params: {} })] })),
    ).toThrow();
  });

  it('reports every effect of a countered object as countered', () => {
    const plan = planStackResolution(createTestRoom(), spell({ countered: true, effects: [effect(), effect()] }));
    expect(plan.resolution?.effects).toEqual([
      { effectId: 'ADD_MANA', fizzled: false, skipped: 'countered' },
      { effectId: 'ADD_MANA', fizzled: false, skipped: 'countered' },
    ]);
    expect(plan.pendingChoice).toBeUndefined();
  });

  it('keeps a resumed continuation authoritative', () => {
    const room = createTestRoom();
    const plan = planStackResolution(room, spell(), {
      type: 'resolution',
      stackObj: spell(),
      effectIndex: 1,
      results: [{ effectId: 'ADD_MANA', fizzled: false }],
    });
    expect(plan.resolution?.effects).toEqual([{ effectId: 'ADD_MANA', fizzled: false }]);
  });
});

describe('planStackResolution continuations', () => {
  it('reports a countered continuation without a fizzle flag', () => {
    const room = createTestRoom();
    const plan = planStackResolution(room, spell({ countered: true }), {
      type: 'resolution',
      stackObj: { ...spell(), countered: true, fizzled: undefined } as never,
      effectIndex: 0,
      results: [],
    });
    expect(plan.resolution?.effects).toEqual([{ effectId: 'ADD_MANA', fizzled: false, skipped: 'countered' }]);
  });
});
