import { describe, expect, it, vi } from 'vitest';
import { EventBus, type GameEvent } from '@engine/event-bus';
import { nextEffectSequence, nextEffectTimestamp } from '@engine/continuous-effects';
import { composeActionCosts } from '@engine/cost-composition';
import { DamageRuleRegistry, planDamage, validDamageAssignments } from '@engine/damage-service';
import { validManaAmounts } from '@rules/mana-validation';
import { validEffectScope } from '@rules/effect-scope-validation';
import { describeTargetGroups, structuralTargetLegal, targetPermissionsAllow } from '@rules/target-legality';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';
import { captureSourceInformation } from '@engine/source-information';
import type { ActionCost } from '@shared/effect.types';
import type { ContinuousEffectEntry } from '@shared/continuous-effect.types';
import type { GameRoom } from '@shared/game.room.types';
import type { DamageAssignment } from '@shared/damage.types';

describe('event bus subscriptions', () => {
  it('dispatches to appended listeners and tolerates stale unsubscriptions', () => {
    const bus = new EventBus('room-1');
    const calls: string[] = [];
    const first = (event: GameEvent) => calls.push(`first:${event.eventId}`);
    const second = () => calls.push('second');

    bus.off('STACK_UPDATED', first);
    bus.on('STACK_UPDATED', first);
    bus.on('STACK_UPDATED', second);
    bus.emit({ eventId: 'STACK_UPDATED', roomId: 'room-1', payload: {} });
    expect(calls).toEqual(['first:STACK_UPDATED', 'second']);

    bus.off('STACK_UPDATED', first);
    bus.off('STACK_UPDATED', first);
    bus.emit({ eventId: 'STACK_UPDATED', roomId: 'room-1', payload: {} });
    expect(calls).toEqual(['first:STACK_UPDATED', 'second', 'second']);
  });
});

describe('continuous effect identity', () => {
  it('skips pool ids that are already taken', () => {
    const room = createTestRoom();
    room.continuousEffectPool = [
      { id: `effect:${room.roomId}:1`, layer: 1, effect: { type: 'SWITCH_STATS' } } as unknown as ContinuousEffectEntry,
      { id: `effect:${room.roomId}:2`, layer: 1, effect: { type: 'SWITCH_STATS' } } as unknown as ContinuousEffectEntry,
    ];
    expect(nextEffectSequence(room)).toBe(3);
    expect(nextEffectTimestamp(room)).toBeGreaterThan(0);
  });
});

describe('action cost composition', () => {
  it('accumulates mana, counters, numeric and boolean costs', () => {
    const cost = composeActionCosts([
      { mana: { red: 1 }, life: 2, tap: true, removeCounters: [{ from: 'source', counterType: '+1/+1', amount: 1 }] },
      { mana: { red: 2, blue: 1 }, life: 3, discard: 1, removeCounters: [{ from: 'source', counterType: '+1/+1', amount: 2 }] },
      { destroyMaterials: { filter: { cardTypes: ['Creature'] }, manaValueGreaterThan: 0 } },
      { discardSelf: true },
    ]);
    expect(cost).toEqual({
      mana: { red: 3, blue: 1 },
      life: 5,
      discard: 1,
      tap: true,
      discardSelf: true,
      removeCounters: [
        { from: 'source', counterType: '+1/+1', amount: 1 },
        { from: 'source', counterType: '+1/+1', amount: 2 },
      ],
      destroyMaterials: { filter: { cardTypes: ['Creature'] }, manaValueGreaterThan: 0 },
    });
  });

  it('rejects a malformed individual cost before merging it', () => {
    expect(() => composeActionCosts([{ mana: { red: 1 }, bogus: true } as unknown as ActionCost])).toThrow(
      'Unsupported action cost',
    );
  });

  it('rejects an invalid mana requirement', () => {
    expect(() => composeActionCosts([{ mana: { red: -1 } }])).toThrow('Invalid mana requirement');
    expect(() => composeActionCosts([{ mana: { purple: 1 } as unknown as ActionCost['mana'] }])).toThrow(
      'Invalid mana requirement',
    );
  });

  it('rejects a merged cost that pays both tap and untap', () => {
    expect(() => composeActionCosts([{ tap: true }, { untap: true }])).toThrow('Cannot pay both tap and untap costs');
  });

  it('leaves an empty cost empty', () => {
    expect(composeActionCosts([])).toEqual({});
  });

  it('rejects paying the same source cost or declaring two material costs twice', () => {
    expect(() => composeActionCosts([{ tap: true }, { tap: true }])).toThrow('Cannot pay the same source cost twice');
    const materials = { filter: { cardTypes: ['Creature'] }, manaValueGreaterThan: 0 } as const;
    expect(() => composeActionCosts([{ destroyMaterials: materials }, { destroyMaterials: materials }])).toThrow(
      'An action can declare one material destruction cost',
    );
  });

  it('rejects combined amounts outside the safe integer range', () => {
    expect(() => composeActionCosts([{ mana: { red: 5_000_000_000_000_000 } }, { mana: { red: 5_000_000_000_000_000 } }])).toThrow(
      'Combined action cost exceeds the safe integer range',
    );
    expect(() => composeActionCosts([{ mana: { red: 5_000_000_000_000_000 } }, { mana: { blue: 5_000_000_000_000_000 } }])).toThrow(
      'Combined mana cost exceeds the safe integer range',
    );
    expect(() => composeActionCosts([{ life: 5_000_000_000_000_000 }, { life: 5_000_000_000_000_000 }])).toThrow(
      'Combined action cost exceeds the safe integer range',
    );
  });
});

describe('damage planning', () => {
  function damageRoom(): GameRoom {
    return createTestRoom({ battlefield: [creature('source', 'player1'), creature('victim', 'player2')] });
  }

  function assignment(room: GameRoom, amount: number): DamageAssignment {
    return {
      source: captureSourceInformation(room, room.battlefield[0]),
      recipient: { kind: 'permanent', cardUuid: 'victim', zoneRevision: 0 },
      amount,
      combat: false,
    };
  }

  it('drops an assignment cancelled by a registered damage rule', () => {
    const room = damageRoom();
    const stop = DamageRuleRegistry.register({ modify: () => null });
    const following = DamageRuleRegistry.register({ modify: (_room, current) => current });
    try {
      expect(planDamage(room, [assignment(room, 2)])).toEqual([]);
    } finally {
      stop();
      following();
    }
  });

  it('collects consequences from rules that declare them', () => {
    const room = damageRoom();
    const consequence = { type: 'SET_FAILED_DRAW', playerId: 'player2', value: true } as const;
    const stopWith = DamageRuleRegistry.register({ consequences: () => [consequence] });
    const stopWithout = DamageRuleRegistry.register({});
    try {
      expect(DamageRuleRegistry.consequences(room, [assignment(room, 2)])).toEqual([consequence]);
    } finally {
      stopWith();
      stopWithout();
    }
  });

  it('keeps only well-formed assignments aimed at living permanents', () => {
    const room = damageRoom();
    const legal = assignment(room, 2);
    const stale = { ...legal, recipient: { kind: 'permanent' as const, cardUuid: 'victim', zoneRevision: 9 } };
    const missing = { ...legal, recipient: { kind: 'permanent' as const, cardUuid: 'absent', zoneRevision: 0 } };
    const nonCreature = { ...legal, recipient: { kind: 'permanent' as const, cardUuid: 'source', zoneRevision: 0 } };
    room.battlefield[0] = creature('source', 'player1');
    room.battlefield[0].blueprint = { ...room.battlefield[0].blueprint, cardTypes: ['Land'] };
    expect(validDamageAssignments(room, [legal, stale, missing, nonCreature])).toEqual([legal]);
  });
});

describe('mana amount contract', () => {
  it('accepts coloured and, when allowed, generic amounts', () => {
    expect(validManaAmounts({ red: 1, blue: 2 })).toBe(true);
    expect(validManaAmounts({ generic: 2 })).toBe(false);
    expect(validManaAmounts({ generic: 2 }, true)).toBe(true);
    expect(validManaAmounts({ red: 1.5 })).toBe(false);
    expect(validManaAmounts({ red: -1 })).toBe(false);
    expect(validManaAmounts({ purple: 1 })).toBe(false);
  });

  it('rejects non-object values', () => {
    expect(validManaAmounts(undefined)).toBe(false);
    expect(validManaAmounts('red')).toBe(false);
    expect(validManaAmounts(['red'])).toBe(false);
  });
});

describe('effect scope contract', () => {
  it('rejects values that are not plain objects', () => {
    expect(validEffectScope(undefined)).toBe(false);
    expect(validEffectScope([])).toBe(false);
    expect(validEffectScope('self')).toBe(false);
  });

  it('accepts pinned card and revision references', () => {
    expect(validEffectScope({ cardUuid: 'card-1' })).toBe(true);
    expect(validEffectScope({ cardUuid: '' })).toBe(false);
    expect(validEffectScope({ zoneRevision: 2 })).toBe(true);
    expect(validEffectScope({ zoneRevision: -1 })).toBe(false);
    expect(validEffectScope({ zoneRevision: 1.5 })).toBe(false);
  });

  it('accepts the remaining scope families and rejects unknown keys', () => {
    expect(validEffectScope({ self: true, attachedToSource: false })).toBe(true);
    expect(validEffectScope({ zones: ['hand', 'battlefield'] })).toBe(true);
    expect(validEffectScope({ zones: ['nowhere'] })).toBe(false);
    expect(validEffectScope({ objects: [{ cardUuid: 'card-1', zoneRevision: 0 }] })).toBe(true);
    expect(validEffectScope({ objects: [{ cardUuid: 'card-1', zoneRevision: 0, extra: true }] })).toBe(false);
    expect(validEffectScope({ from: { kind: 'result', name: 'milled' } })).toBe(true);
    expect(validEffectScope({ cardTypes: ['Creature'] })).toBe(true);
    expect(validEffectScope({ nonsense: true })).toBe(false);
  });
});

describe('target legality helpers', () => {
  it('rejects a blank target group id', () => {
    expect(() =>
      describeTargetGroups([
        { action: 'TAP', params: {}, targeting: { type: 'permanent', required: true }, targetGroup: '   ' },
      ]),
    ).toThrow('Target group ID must be nonempty');
  });

  it('rejects a target definition that does not match its declared type', () => {
    const room = createTestRoom({ battlefield: [creature('target', 'player2')] });
    expect(
      structuralTargetLegal(room, 'player1', { targetType: 'player', playerId: 'player2' }, { type: 'self', required: true }),
    ).toBe(false);
    expect(
      structuralTargetLegal(room, 'player1', { targetType: 'self' }, { type: 'self', required: false }),
    ).toBe(true);
  });

  it('accepts a card target from the battlefield when no zone list is declared', () => {
    const room = createTestRoom({ battlefield: [creature('target', 'player2')] });
    expect(
      structuralTargetLegal(room, 'player1', { targetType: 'card', cardUuid: 'target' }, { type: 'card', required: true }),
    ).toBe(true);
    expect(
      structuralTargetLegal(room, 'player1', { targetType: 'card', cardUuid: 'target' }, { type: 'card', required: true, zones: ['hand'] }),
    ).toBe(false);
  });

  it('refuses permission checks for a card that is no longer on the board', () => {
    const room = createTestRoom();
    expect(targetPermissionsAllow(room, 'player1', undefined, { targetType: 'card', cardUuid: 'absent' })).toBe(false);
    expect(targetPermissionsAllow(room, 'player1', undefined, { targetType: 'player', playerId: 'player2' })).toBe(true);
  });

  it('refuses targets with shroud or an opponent鈥檚 hexproof', () => {
    const room = createTestRoom({ battlefield: [creature('shrouded', 'player2', 2, 2, ['Shroud']), creature('hexproof', 'player2', 2, 2, ['Hexproof'])] });
    expect(targetPermissionsAllow(room, 'player1', undefined, { targetType: 'permanent', cardUuid: 'shrouded' })).toBe(false);
    expect(targetPermissionsAllow(room, 'player1', undefined, { targetType: 'permanent', cardUuid: 'hexproof' })).toBe(false);
    expect(targetPermissionsAllow(room, 'player2', undefined, { targetType: 'permanent', cardUuid: 'hexproof' })).toBe(true);
  });
});


