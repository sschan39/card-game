import { describe, expect, it } from 'vitest';
import { describeStackObject } from '@rules/action-description';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';
import type { StackEffect, StackObject, TargetPointer } from '@shared/effect.types';
import type { CardInstance } from '@shared/card.types';

function effect(action: string, params: Record<string, unknown> = {}, targets: TargetPointer[] = [], tags: string[] = []): StackEffect {
  return { action, params, tags, targets } as StackEffect;
}

function sourceCard(room: ReturnType<typeof createTestRoom>, name = 'source'): CardInstance {
  const card = creature('source', 'player1');
  card.blueprint = { ...card.blueprint, name };
  room.battlefield.push(card);
  return card;
}

function stackObject(source: CardInstance, effects: StackEffect[], extra: Record<string, unknown> = {}): StackObject {
  return { uuid: 'object', type: 'triggered', controllerId: 'player1', source, effects, countered: false, ...extra } as unknown as StackObject;
}

describe('stack object descriptions', () => {
  it('labels spells, activated abilities and triggered abilities', () => {
    const room = createTestRoom();
    const source = sourceCard(room);
    expect(describeStackObject(room, { ...stackObject(source, [effect('DRAW', { amount: 2 })]), type: 'spell' })).toBe(
      'source · onPlay: { draw 2 }',
    );
    expect(describeStackObject(room, { ...stackObject(source, [effect('DRAW', { amount: 2 })]), type: 'activated' })).toBe(
      'source · activate: { draw 2 }',
    );
    const triggered = stackObject(source, [effect('DRAW', { amount: 2 })], {
      ability: { type: 'triggered', triggerCondition: 'ON_ENTER_BATTLEFIELD' },
    });
    expect(describeStackObject(room, triggered)).toBe('source · onEnter: { draw 2 }');
    const custom = stackObject(source, [effect('DRAW', { amount: 2 })], {
      ability: { type: 'triggered', triggerCondition: 'ON_KILL' },
    });
    expect(describeStackObject(room, custom)).toBe('source · ON_KILL: { draw 2 }');
    const entered = stackObject(source, [effect('DRAW', { amount: 2 })], {
      triggeringEvent: { eventId: 'PERMANENT_ENTERED' },
    });
    expect(describeStackObject(room, entered)).toBe('source · onEnter: { draw 2 }');
    expect(describeStackObject(room, stackObject(source, [effect('DRAW', { amount: 2 })]))).toBe(
      'source · trigger: { draw 2 }',
    );
  });

  it('renames another-subject trigger labels and handles an effectless object', () => {
    const room = createTestRoom();
    const source = sourceCard(room);
    const object = stackObject(source, [], {
      ability: { type: 'triggered', triggerCondition: 'ON_ENTER_BATTLEFIELD', trigger: { subject: 'another' } },
    });
    expect(describeStackObject(room, object)).toBe('source · onAnotherEnter: { no effects }');
    expect(describeStackObject(room, stackObject(source, [], {
      ability: { type: 'activated', triggerCondition: 'ON_ENTER_BATTLEFIELD', trigger: { subject: 'another' } },
    }))).toBe('source · trigger: { no effects }');
  });

  it('describes every authored effect action', () => {
    const room = createTestRoom();
    const source = sourceCard(room);
    const effects = [
      effect('DEAL_DAMAGE', { amount: 3 }),
      effect('MODIFY_LIFE', { amount: 4 }),
      effect('MODIFY_LIFE', { amount: -4 }, [], ['damage']),
      effect('MODIFY_LIFE', { amount: -4 }),
      effect('MODIFY_LIFE', { amount: {} }),
      effect('DRAW', { amount: 2 }),
      effect('MODIFY_STATS', { damage: 2 }),
      effect('MODIFY_STATS', {}),
      effect('DISCARD_FROM_HAND', { amount: 1 }),
      effect('DISCARD_FROM_LIBRARY', { amount: 2 }),
      effect('REVEAL_TOP', { amount: 3 }),
      effect('CAPTURE_WINDOW', { event: 'revealed', amount: 1 }),
      effect('CAPTURE_WINDOW', { amount: 1 }),
      effect('DISCARD_CAPTURED', {}),
      effect('ADD_COUNTER', { amount: 1, counterType: '+1/+1' }),
      effect('ADD_COUNTER', { amount: 2, counterType: '+1/+1' }),
      effect('REMOVE_COUNTER', { amount: 1, counterType: '-1/-1' }),
      effect('REMOVE_COUNTER', { amount: 2, counterType: '-1/-1' }),
      effect('ADD_MANA', { amount: 1, color: 'red' }),
      effect('GRANT_STATS', { power: 1, toughness: 2 }),
      effect('GRANT_STATS', {}),
      effect('CUSTOM_ACTION', { amount: 5 }),
      effect('CUSTOM_ACTION', {}),
    ];
    const text = describeStackObject(room, stackObject(source, effects));
    expect(text).toContain('damage 3');
    expect(text).toContain('heal 4');
    expect(text).toContain('damage 4');
    expect(text).toContain('lose life 4');
    expect(text).toContain('change life variable');
    expect(text).toContain('draw 2');
    expect(text).toContain('modify stats');
    expect(text).toContain('discard 1 from hand');
    expect(text).toContain('discard 2 from library');
    expect(text).toContain('reveal 3');
    expect(text).toContain('reveal 1');
    expect(text).toContain('capture window 1');
    expect(text).toContain('discard the remaining captured cards');
    expect(text).toContain('place 1 +1/+1 counter');
    expect(text).toContain('place 2 +1/+1 counters');
    expect(text).toContain('remove 1 -1/-1 counter');
    expect(text).toContain('remove 2 -1/-1 counters');
    expect(text).toContain('add 1 red mana');
    expect(text).toContain('buff 1/2');
    expect(text).toContain('buff 0/0');
    expect(text).toContain('custom action 5');
    expect(text).toContain('custom action');
  });

  it('resolves player, permanent, stack and missing targets', () => {
    const room = createTestRoom();
    const source = sourceCard(room);
    const named = creature('named', 'player1');
    named.blueprint = { ...named.blueprint, name: 'Named Card' };
    named.state = { ...named.state, zoneRevision: 2 };
    room.battlefield.push(named);
    const stackSpell = creature('spell-source', 'player1');
    stackSpell.blueprint = { ...stackSpell.blueprint, name: 'Stack Spell' };
    room.stack.push(stackObject(stackSpell, [], { uuid: 'stack-item' }));
    const unversioned = creature('unversioned', 'player1');
    unversioned.state = { ...unversioned.state, zoneRevision: undefined };
    room.battlefield.push(unversioned);
    const effectWithTargets = effect('DRAW', { amount: 1 }, [
      { targetType: 'player', playerId: 'player1' },
      { targetType: 'player', playerId: 'player2' },
      { targetType: 'permanent', cardUuid: unversioned.uuid, zoneRevision: 0 },
      { targetType: 'permanent', cardUuid: named.uuid, zoneRevision: 2 },
      { targetType: 'permanent', cardUuid: named.uuid, zoneRevision: 9 },
      { targetType: 'stack', stackUuid: 'stack-item' },
      { targetType: 'stack', stackUuid: 'missing' },
      { targetType: 'permanent', cardUuid: 'missing-card' },
      { targetType: 'self' },
    ]);
    const text = describeStackObject(room, stackObject(source, [effectWithTargets]), 'player1');
    expect(text).toContain('→ You, Opponent, unversioned, Named Card, selected card, Stack Spell');
  });

  it('labels duplicate battlefield names with an ordinal', () => {
    const room = createTestRoom();
    const source = sourceCard(room);
    const twin = creature('twin', 'player1');
    twin.blueprint = { ...twin.blueprint, name: 'source' };
    room.battlefield.push(twin);
    expect(describeStackObject(room, stackObject(source, []))).toMatch(/^source #\d · trigger/);
  });

  it('appends completion status from resolution results', () => {
    const room = createTestRoom();
    const source = sourceCard(room);
    const results = [
      { effectId: 'a', fizzled: false, skipped: 'condition_failed' as const },
      { effectId: 'b', fizzled: true },
      { effectId: 'c', fizzled: false },
      { effectId: 'd', fizzled: false, skipped: 'illegal_targets' as const },
      { effectId: 'e', fizzled: false, skipped: 'object_failed' as const },
      { effectId: 'f', fizzled: false, skipped: 'countered' as const },
      { effectId: 'g', fizzled: false, skipped: 'unresolved_parameter' as const },
    ];
    const effects = results.map((_, index) => effect('DRAW', { amount: index + 1 }));
    const text = describeStackObject(room, stackObject(source, effects), null, results);
    expect(text).toContain('draw 1 (skipped: condition not met)');
    expect(text).toContain('draw 2 (fizzled)');
    expect(text).toContain('draw 3');
    expect(text).toContain('draw 4 (skipped: no legal targets)');
    expect(text).toContain('draw 5 (skipped: object fizzled)');
    expect(text).toContain('draw 6 (skipped: countered)');
    expect(text).toContain('draw 7 (skipped: value unavailable)');
  });
});
