import { describe, expect, it } from 'vitest';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';
import { captureSourceInformation } from '@engine/source-information';
import { planProposedMutations, resumeProposedChoice } from '@engine/proposed-events';
import type { GameRoom } from '@shared/game.room.types';
import type { GameMutation } from '@shared/game-mutation.types';
import type { ChoiceAnswer, PendingChoice } from '@shared/choice.types';
import type { ProposedTransaction, ReplacementDefinition } from '@shared/proposed-event.types';
import type { DamageAssignment } from '@shared/damage.types';

const double: ReplacementDefinition = {
  id: 'double',
  label: 'Double damage',
  match: { kinds: ['damage'] },
  operation: { type: 'damage_scale', factor: 2 },
};
const prevent: ReplacementDefinition = {
  id: 'prevent',
  label: 'Prevent three',
  match: { kinds: ['damage'] },
  operation: { type: 'prevent_damage', amount: 3 },
};

function room(rules: ReplacementDefinition[] = [], battlefield = [creature('source', 'player1')]): GameRoom {
  return createTestRoom({ battlefield, replacementEffects: rules });
}

function batch(r: GameRoom, amount = 5, recipientId = 'player2'): Extract<GameMutation, { type: 'APPLY_DAMAGE_BATCH' }> {
  return {
    type: 'APPLY_DAMAGE_BATCH',
    assignments: [
      {
        source: captureSourceInformation(r, r.battlefield[0]),
        recipient: { kind: 'player', playerId: recipientId },
        amount,
        combat: false,
      },
    ],
  };
}

function twoSources(r: GameRoom, amount = 3): GameMutation {
  const base = batch(r, amount);
  return {
    ...base,
    assignments: [
      base.assignments[0],
      { ...base.assignments[0], source: { ...base.assignments[0].source, card: creature('second', 'player1') } },
    ],
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function answer(values: unknown[], allocations?: Record<string, number>): ChoiceAnswer {
  return { values, ...(allocations ? { allocations } : {}) } as ChoiceAnswer;
}

describe('proposed event guards', () => {
  it('proposes nothing for a destroy of a card that is not on the battlefield', () => {
    const r = room();
    expect(planProposedMutations(r, [{ type: 'DESTROY_CARD', cardUuid: 'missing', zoneRevision: 0 }])).toEqual({
      mutations: [],
    });
  });

  it('keeps an unspent amount on a scaling rule', () => {
    const r = room([{ ...double, remaining: 2 }]);
    const plan = planProposedMutations(r, [batch(r, 2)]);
    expect(plan.mutations.length).toBeGreaterThan(0);
    expect(
      plan.mutations.filter((mutation) => mutation.type === 'SET_REPLACEMENT_EFFECTS').at(-1),
    ).toMatchObject({ effects: [expect.objectContaining({ id: 'double', remaining: 2 })] });
  });

  it('applies a rule while an inapplicable registration remains', () => {
    const r = room([{ id: 'shield', label: 'Shield', match: { kinds: ['damage'] }, operation: { type: 'prevent_damage', amount: 3 }, remaining: 3 }]);
    r.replacementEffects = [r.replacementEffects![0], { id: 'unrelated', label: 'Unrelated', match: { kinds: ['draw'] }, operation: { type: 'cancel_event' }, remaining: 4 }];
    const plan = planProposedMutations(r, [batch(r, 2)]);
    expect(plan.mutations.filter((mutation) => mutation.type === 'SET_REPLACEMENT_EFFECTS').at(-1)).toMatchObject({
      effects: [expect.objectContaining({ id: 'shield', remaining: 1 }), expect.objectContaining({ id: 'unrelated' })],
    });
  });
});

describe('shield allocation guards', () => {
  function shieldPlan(extra: ReplacementDefinition[] = [], amount = 3) {
    const r = room([
      { id: 'shield', label: 'Shield', match: { kinds: ['damage'] }, operation: { type: 'prevent_damage', amount: 5 }, remaining: amount },
      ...extra,
    ]);
    const plan = planProposedMutations(r, [twoSources(r, amount)]);
    expect(plan.pendingChoice?.kind).toBe('distribution');
    return { r, plan };
  }

  it('rejects a shield answer without allocations', () => {
    const { r, plan } = shieldPlan();
    expect(() => resumeProposedChoice(r, clone(plan.pendingChoice!), answer([]))).toThrow('Invalid shield allocation');
  });

  it('rejects a shield allocation that does not add up to the shield total', () => {
    const { r, plan } = shieldPlan();
    expect(() =>
      resumeProposedChoice(r, clone(plan.pendingChoice!), answer([], { 'damage:0': 1, 'damage:1': 0 })),
    ).toThrow('Invalid shield allocation');
  });

  it('rejects a shield allocation entry outside its option limit', () => {
    const { r, plan } = shieldPlan();
    expect(() =>
      resumeProposedChoice(r, clone(plan.pendingChoice!), answer([], { 'damage:0': 99, 'damage:1': -96 })),
    ).toThrow('Invalid shield allocation');
  });

  it('rejects a numeric choice shaped like a shield allocation', () => {
    const { r, plan } = shieldPlan();
    const numeric = clone(plan.pendingChoice!) as unknown as { kind: string; total: number; options: { id: string }[] };
    numeric.kind = 'number';
    const allocations: Record<string, number> = { 'damage:0': 2, 'damage:1': 1 };
    expect(() => resumeProposedChoice(r, numeric as unknown as PendingChoice, answer([], allocations))).toThrow(
      'Invalid shield allocation',
    );
  });

  it('rejects a shield frame that stopped being damage', () => {
    const r = room([{ id: 'shield', label: 'Shield', match: { kinds: ['damage'] }, operation: { type: 'prevent_damage', amount: 5 }, remaining: 3 }]);
    const transaction: ProposedTransaction = {
      completed: [],
      remaining: [],
      current: { frames: [{ event: { kind: 'life_change', playerId: 'player2', amount: 1 }, applied: [] }], final: [] },
    };
    const choice = {
      id: 'stale',
      playerId: 'player2',
      kind: 'distribution',
      prompt: 'Allocate',
      min: 0,
      max: 1,
      total: 1,
      options: [{ id: 'damage:0', label: 'Damage', value: 0, limit: 5 }],
      continuation: { type: 'replacement', transaction, shieldAllocation: { ruleId: 'shield', indices: [0] } },
    } as unknown as PendingChoice;
    expect(() => resumeProposedChoice(r, choice, answer([], { 'damage:0': 1 }))).toThrow('Shield allocation is stale');
  });

  it('retains the rule and consumes it when the shield is spent', () => {
    const { r, plan } = shieldPlan([{ id: 'unrelated', label: 'Unrelated', match: { kinds: ['draw'] }, operation: { type: 'cancel_event' } }]);
    const spent = resumeProposedChoice(r, clone(plan.pendingChoice!), answer([], { 'damage:0': 3, 'damage:1': 0 }));
    expect(spent.mutations.filter((mutation) => mutation.type === 'SET_REPLACEMENT_EFFECTS').at(-1)).toMatchObject({
      effects: [expect.objectContaining({ id: 'unrelated' })],
    });
    const upgraded: GameRoom = {
      ...r,
      replacementEffects: [{ ...r.replacementEffects![0], remaining: 5 }, r.replacementEffects![1]],
    };
    const kept = resumeProposedChoice(upgraded, clone(plan.pendingChoice!), answer([], { 'damage:0': 2, 'damage:1': 1 }));
    expect(kept.mutations.filter((mutation) => mutation.type === 'SET_REPLACEMENT_EFFECTS').at(-1)).toMatchObject({
      effects: [expect.objectContaining({ id: 'shield', remaining: 2 }), expect.objectContaining({ id: 'unrelated' })],
    });
  });

  it('attributes the remaining damage to the shield source', () => {
    const r = room([{ id: 'shield', label: 'Shield', match: { kinds: ['damage'] }, operation: { type: 'prevent_damage', amount: 5 }, remaining: 2 }]);
    const base = batch(r, 2);
    const cause = {
      id: 'cause:one',
      rootId: 'cause:one',
      kind: 'effect' as const,
      controllerId: 'player1',
      source: base.assignments[0].source,
    };
    const mutation: GameMutation = {
      ...base,
      assignments: [{ ...base.assignments[0], cause }, { ...base.assignments[0], source: { ...base.assignments[0].source, card: creature('second', 'player1') } }],
    };
    const plan = planProposedMutations(r, [mutation]);
    expect(plan.pendingChoice?.kind).toBe('distribution');
    const final = resumeProposedChoice(r, clone(plan.pendingChoice!), answer([], { 'damage:0': 1, 'damage:1': 1 }));
    const committed = final.mutations.find((m) => m.type === 'APPLY_DAMAGE_BATCH') as Extract<GameMutation, { type: 'APPLY_DAMAGE_BATCH' }>;
    expect(committed.assignments[0].cause?.modifiers?.[0]).toMatchObject({ ruleId: 'shield' });
  });
});

describe('replacement resume guards', () => {
  it('requires a replacement continuation', () => {
    const r = room();
    const choice = {
      id: 'optional',
      playerId: 'player1',
      kind: 'optional',
      prompt: 'Choose',
      min: 0,
      max: 1,
      options: [],
      continuation: { type: 'action', actionId: 'x', data: {}, field: 'modes' },
    } as unknown as PendingChoice;
    expect(() => resumeProposedChoice(r, choice, answer([true]))).toThrow('Expected a replacement choice');
  });

  it('rejects a replacement answer that is not exactly one string', () => {
    const r = room([double, prevent]);
    const plan = planProposedMutations(r, [batch(r)]);
    expect(() => resumeProposedChoice(r, clone(plan.pendingChoice!), answer([1]))).toThrow('Invalid replacement decision');
  });

  it('rejects a rule that no longer applies', () => {
    const r = room([double, prevent]);
    const plan = planProposedMutations(r, [batch(r)]);
    expect(() => resumeProposedChoice(r, clone(plan.pendingChoice!), answer(['gone']))).toThrow(
      'Replacement decision is no longer applicable',
    );
  });

  it('chooses a shield rule and then asks for its allocation', () => {
    const r = room([
      { id: 'shield', label: 'Shield', match: { kinds: ['damage'] }, operation: { type: 'prevent_damage', amount: 5 }, remaining: 3 },
      double,
    ]);
    const plan = planProposedMutations(r, [twoSources(r, 3)]);
    expect(plan.pendingChoice?.kind).toBe('options');
    const choice = clone(plan.pendingChoice!);
    if (choice.continuation.type !== 'replacement') throw new Error('Expected a replacement choice');
    choice.continuation.afterResolution = { type: 'resolution', stackObj: {} as never, effectIndex: 0, results: [] };
    const resumed = resumeProposedChoice(r, choice, answer(['shield']));
    expect(resumed.pendingChoice?.kind).toBe('distribution');
    if (resumed.pendingChoice?.continuation.type !== 'replacement') throw new Error('Expected a shield allocation');
    expect(resumed.pendingChoice.continuation.afterResolution).toBeDefined();
  });

  it('settles suspended parents and reuses their primitive results', () => {
    const r = room([double, prevent]);
    const plan = planProposedMutations(r, [batch(r)]);
    const choice = clone(plan.pendingChoice!);
    if (choice.continuation.type !== 'replacement') throw new Error('Expected a replacement choice');
    const assignment: DamageAssignment = batch(r, 1).assignments[0];
    const parent: ProposedTransaction = {
      completed: [],
      remaining: [],
      current: { frames: [], final: [], damage: [assignment] },
    };
    choice.continuation.parents = [parent];
    const resumed = resumeProposedChoice(r, choice, answer(['double']));
    expect(resumed.pendingChoice).toBeUndefined();
    expect(resumed.mutations.length).toBeGreaterThan(0);
  });

  it('carries a simultaneous flag into rule reconciliation', () => {
    const r = room([double, prevent]);
    const plan = planProposedMutations(r, [batch(r)]);
    const choice = clone(plan.pendingChoice!);
    if (choice.continuation.type !== 'replacement') throw new Error('Expected a replacement choice');
    choice.continuation.transaction.simultaneous = true;
    const resumed = resumeProposedChoice(r, choice, answer(['double']));
    expect(resumed.mutations.length).toBeGreaterThan(0);
  });

  it('proposes nothing for a counter change on a card that is not on the battlefield', () => {
    const r = room();
    expect(
      planProposedMutations(r, [{ type: 'ADD_COUNTER', cardUuid: 'missing', counterType: '+1/+1', amount: 1 }]),
    ).toEqual({ mutations: [] });
  });

  it('previews a simultaneous board whose history has no uses yet', () => {
    const r = room([], [creature('source', 'player1')]);
    r.turnHistory = { turnNumber: 1, events: [], counts: {}, playerCounts: {} } as unknown as GameRoom['turnHistory'];
    const plan = planProposedMutations(
      r,
      [
        { type: 'SET_TURN_HISTORY', history: { turnNumber: 1, events: [], counts: {}, playerCounts: {} } as unknown as NonNullable<GameRoom['turnHistory']> },
        batch(r, 1),
      ],
      { simultaneous: true },
    );
    expect(plan.pendingChoice).toBeUndefined();
    expect(plan.mutations.some((mutation) => mutation.type === 'APPLY_DAMAGE_BATCH')).toBe(true);
  });

  it('settles a suspended parent whose current step is not damage', () => {
    const r = room([double, prevent]);
    const plan = planProposedMutations(r, [batch(r)]);
    const choice = clone(plan.pendingChoice!);
    if (choice.continuation.type !== 'replacement') throw new Error('Expected a replacement choice');
    choice.continuation.parents = [
      {
        completed: [],
        remaining: [],
        current: {
          frames: [],
          final: [{ event: { kind: 'life_change', playerId: 'player2', amount: 1 }, applied: [] }],
          resultPrimitives: [],
        },
      },
    ];
    const resumed = resumeProposedChoice(r, choice, answer(['double']));
    expect(resumed.pendingChoice).toBeUndefined();
    expect(resumed.mutations.length).toBeGreaterThan(0);
  });
});

describe('shield allocation shapes', () => {
  it('ignores a frame that is not an eligible damage recipient', () => {
    const r = room([{ id: 'shield', label: 'Shield', match: { kinds: ['damage'] }, operation: { type: 'prevent_damage' }, remaining: 3 }]);
    const base = batch(r, 2);
    const self = { ...base.assignments[0], recipient: { kind: 'player' as const, playerId: 'player1' as const } };
    const mutation: GameMutation = {
      ...base,
      assignments: [
        { ...self, source: { ...self.source, card: creature('second', 'player1') } },
        self,
        base.assignments[0],
      ],
    };
    const plan = planProposedMutations(r, [mutation]);
    expect(plan.pendingChoice?.kind).toBe('distribution');
    expect(plan.pendingChoice?.options).toHaveLength(2);
    const final = resumeProposedChoice(r, clone(plan.pendingChoice!), answer([], { 'damage:0': 2, 'damage:1': 1 }));
    expect(final.mutations.some((m) => m.type === 'APPLY_DAMAGE_BATCH')).toBe(true);
  });

  it('treats an omitted allocation as zero', () => {
    const r = room([{ id: 'shield', label: 'Shield', match: { kinds: ['damage'] }, operation: { type: 'prevent_damage' }, remaining: 3 }]);
    const plan = planProposedMutations(r, [twoSources(r, 3)]);
    expect(plan.pendingChoice?.kind).toBe('distribution');
    const final = resumeProposedChoice(r, clone(plan.pendingChoice!), answer([], { 'damage:0': 3 }));
    expect(final.mutations.some((m) => m.type === 'APPLY_DAMAGE_BATCH')).toBe(true);
  });
});
