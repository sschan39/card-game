import { describe, expect, it } from 'vitest';
import { resolveEffects, buildDynamicParams } from '@engine/effect-resolver';
import { GameEngine } from '@engine/game-engine';
import { conditionMatches, createRuleContext } from '@engine/rule-conditions';
import { CardCharacteristicService as characteristics } from '@engine/card-characteristic-service';
import { gameReducer } from '@engine/game-reducer';
import { planProposedMutations } from '@engine/proposed-events';
import { resolveSourceInformation } from '@engine/source-information';
import { normalizeCard } from '@library/card-parser';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';
import type { StackEffect, StackObject } from '@shared/effect.types';

const add = (left: unknown, right: unknown) => ({ numeric: { kind: 'add', left, right } });
const field = (path: string) => ({ numeric: { kind: 'query', id: 'field', args: { path } } });
const count = () => ({ numeric: { kind: 'query', id: 'count', args: { scope: { zones: ['battlefield'], cardTypes: ['Creature'], controller: 'self' } } } });
const effect = (amount: unknown): StackEffect => ({ action: 'MODIFY_LIFE', params: { amount }, tags: [], targets: [{ targetType: 'player', playerId: 'player1' }] });
function fixture() {
  const room = createTestRoom(), source = creature('source', 'player1', 3, 4), subject = creature('subject', 'player1', 2, 4);
  room.battlefield = [source, subject];
  const object: StackObject = { uuid: 'numeric-stack', type: 'triggered', controllerId: 'player1', source, countered: false, effects: [] };
  return { room, source, subject, object };
}
const rawCard = (extra: Record<string, unknown>) => ({ id: 'numeric-definition', cardTypes: ['Creature'], power: 2, toughness: 3, ...extra });

describe('shared numeric consumers', () => {
  it('uses the same arithmetic in effects, conditions and continuous stats', () => {
    const { room, subject, object } = fixture(), expression = add(2, 3);
    const mutations = resolveEffects(room, { ...object, effects: [effect(expression)] });
    expect(mutations.reduce(gameReducer, room).players.player1.life).toBe(25);
    expect(conditionMatches({ op: 'eq', left: expression, right: 5 } as any, {})).toBe(true);
    const modified = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry: { source: 'global', requiredZone: null,
      layer: 7, duration: 'PERMANENT', scope: { cardUuid: subject.uuid }, effect: { type: 'STAT_DELTA', power: expression as any } } });
    expect(characteristics.resolvePower(modified, subject)).toBe(7);
  });

  it('samples live queries after previous instructions', () => {
    const { room, object } = fixture();
    const mutations = resolveEffects(room, { ...object, effects: [effect(1), effect(field('controller.life'))] });
    expect(mutations.reduce(gameReducer, room).players.player1.life).toBe(42);
  });

  it('reads creature counts through effect and condition contexts', () => {
    const { room, source, object } = fixture();
    expect(resolveEffects(room, { ...object, effects: [effect(count())] }).reduce(gameReducer, room).players.player1.life).toBe(22);
    expect(conditionMatches({ op: 'eq', left: count(), right: 2 } as any, createRuleContext(room, source, 'player1'))).toBe(true);
  });

  it('retains event fields while live fields change', () => {
    const { room, object } = fixture();
    const triggered = { ...object, triggeringEvent: { eventId: 'LIFE_GAINED', payload: { amount: 3 } }, effects: [effect(1), effect(add(field('event.payload.amount'), 2))] };
    expect(resolveEffects(room, triggered).reduce(gameReducer, room).players.player1.life).toBe(26);
  });

  it('reads the original departed source rather than its returned incarnation', () => {
    const { room, source, object } = fixture();
    room.stack = [{ ...object, effects: [effect(field('source.power'))] }];
    let changed = gameReducer(room, { type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' });
    changed = gameReducer(changed, { type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'graveyard', to: 'battlefield' });
    changed = gameReducer(changed, { type: 'ADD_COUNTER', cardUuid: source.uuid, counterType: '+1/+1', amount: 5 });
    expect(resolveEffects(changed, changed.stack[0]).reduce(gameReducer, changed).players.player1.life).toBe(23);
  });

  it('does not count a returned card as the original source in effects or conditions', () => {
    const { room, source, object } = fixture();
    const selfCount = { numeric: { kind: 'query', id: 'count', args: { scope: { self: true } } } };
    room.stack = [{ ...object, effects: [effect(selfCount)] }];
    let changed = gameReducer(room, { type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' });
    changed = gameReducer(changed, { type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'graveyard', to: 'battlefield' });
    expect(resolveEffects(changed, changed.stack[0]).reduce(gameReducer, changed).players.player1.life).toBe(20);
    const info = resolveSourceInformation(changed, changed.stack[0]);
    expect(conditionMatches({ op: 'eq', left: selfCount, right: 0 } as any, createRuleContext(changed, info.card, 'player1', undefined, info))).toBe(true);
  });

  it('does not read a returned target through an old revision', () => {
    const { room, subject, object } = fixture();
    subject.state.zoneRevision = 2;
    const targeted = { ...effect(field('target.power')), targets: [{ targetType: 'permanent' as const, cardUuid: subject.uuid, zoneRevision: 0 }] };
    expect(buildDynamicParams(room, object, targeted).amount).toBeUndefined();
  });

  it('preserves legacy nonnumeric paths, comparisons and event parameters', () => {
    const { room, object } = fixture();
    const triggered = { ...object, triggeringEvent: { eventId: 'CUSTOM', payload: { label: 'hello' } } };
    expect(buildDynamicParams(room, triggered, { ...effect(0), params: { label: 'DYNAMIC:event.payload.label' } })).toEqual({ label: 'hello' });
    expect(conditionMatches({ op: 'includes', left: { path: 'types' }, right: 'Creature' }, { types: ['Creature'] })).toBe(true);
    expect(conditionMatches({ not: { op: 'eq', left: { path: 'missing' }, right: 1 } }, {})).toBe(true);
  });

  it('restores a selected numeric resolution branch from JSON without applying it twice', () => {
    const { room, object } = fixture();
    const selected = effect(add(field('controller.life'), 1));
    const branch = { action: selected.action, params: selected.params, targeting: { type: 'self' as const, required: false } };
    room.stack = [{ ...object, effects: [{ ...effect(0), choice: { kind: 'options', options: [{ id: 'gain', label: 'Gain', effects: [branch] }] } }] }];
    const engine = new GameEngine(room); engine.initRoom(); engine.resolveTopOfStack();
    const restored = new GameEngine(JSON.parse(JSON.stringify(engine.roomState))); engine.dispose(); restored.initRoom();
    try {
      const choiceId = restored.roomState.pendingChoice!.id;
      expect(restored.executePlayerAction('player1', 'choose', { choiceId, choices: ['gain'] }).success).toBe(true);
      expect(restored.roomState.players.player1.life).toBe(41);
      expect(restored.executePlayerAction('player1', 'choose', { choiceId, choices: ['gain'] }).success).toBe(false);
      expect(restored.roomState.players.player1.life).toBe(41);
    } finally { restored.dispose(); }
  });

  it.each([
    { not: { op: 'eq', left: field('event.payload.missing'), right: 1 } },
    { any: [{ op: 'eq', left: 1, right: 1 }, { op: 'eq', left: field('missing'), right: 1 }] },
    { not: { all: [{ op: 'eq', left: 0, right: 1 }, { op: 'eq', left: field('missing'), right: 1 }] } },
  ])('does not turn an unresolved numeric condition into a match: %j', condition => {
    expect(conditionMatches(condition as any, {})).toBe(false);
  });

  it('skips missing numeric parameters with the established metadata', () => {
    const { room, object } = fixture(), results: any[] = [];
    expect(resolveEffects(room, { ...object, effects: [effect(field('missing'))] }, results)).toEqual([]);
    expect(results).toEqual([{ effectId: 'MODIFY_LIFE', fizzled: false, skipped: 'unresolved_parameter' }]);
  });

  it('uses an intermediate layer board for source power and dependency ordering', () => {
    const { room, source, subject } = fixture();
    room.continuousEffectPool = [
      { id: 'dependent', timestamp: 1, origin: 'static', source: source.uuid, sourceRevision: 0, requiredZone: 'battlefield', layer: 7,
        duration: 'PERMANENT', scope: { cardUuid: subject.uuid }, effect: { type: 'SET_STATS', power: field('source.power') as any, toughness: 4 } },
      { id: 'setter', timestamp: 2, source: 'global', requiredZone: null, layer: 7, duration: 'PERMANENT',
        scope: { cardUuid: source.uuid }, effect: { type: 'SET_STATS', power: 9, toughness: 4 } },
    ];
    expect(characteristics.resolvePower(room, subject)).toBe(9);
  });

  it('recalculates static counts but retains resolved counts at creation', () => {
    const { room, source, subject } = fixture();
    const entry = { source: source.uuid, sourceControllerId: 'player1', requiredZone: null, layer: 7, duration: 'PERMANENT' as const,
      scope: { cardUuid: subject.uuid }, effect: { type: 'STAT_DELTA' as const, power: count() as any } };
    const resolved = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry: { ...entry, origin: 'resolved' } });
    const staticRoom = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry: { ...entry, origin: 'static' } });
    const later = creature('later', 'player1');
    expect(characteristics.resolvePower({ ...resolved, battlefield: [...resolved.battlefield, later] }, subject)).toBe(4);
    expect(characteristics.resolvePower({ ...staticRoom, battlefield: [...staticRoom.battlefield, later] }, subject)).toBe(5);
  });

  it('preserves different default zones for legacy static and resolved count definitions', () => {
    const { room, source, subject } = fixture(), inHand = creature('in-hand', 'player1');
    inHand.state.zone = 'hand'; room.players.player1.hand = [inHand];
    const entry = { source: source.uuid, sourceControllerId: 'player1', requiredZone: null, layer: 7, duration: 'PERMANENT' as const,
      scope: { cardUuid: subject.uuid }, effect: { type: 'STAT_DELTA' as const, power: { count: { controller: 'self' as const }, multiply: 2, add: 1 } } };
    const resolved = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry: { ...entry, origin: 'resolved' } });
    const staticRoom = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry: { ...entry, origin: 'static' } });
    expect(characteristics.resolvePower(resolved, subject)).toBe(7);
    expect(characteristics.resolvePower(staticRoom, subject)).toBe(9);
  });

  it('rejects an invalid final continuous operation before committing a transaction prefix', () => {
    const { room, subject } = fixture(), before = structuredClone(room);
    const transaction = [
      { type: 'SET_LIFE', playerId: 'player1', amount: 25 },
      { type: 'ADD_CONTINUOUS_EFFECT', entry: { source: 'global', requiredZone: null, layer: 7, duration: 'PERMANENT',
        scope: { cardUuid: subject.uuid }, effect: { type: 'STAT_DELTA', power: field('missing') as any } } },
    ] as import('@shared/game-mutation.types').GameMutation[];
    expect(() => planProposedMutations(room, transaction)).toThrow(/numeric/i);
    expect(room).toEqual(before);
    const engine = new GameEngine(room); engine.initRoom();
    try {
      const initial = structuredClone(engine.roomState); engine.drainEventBatches();
      expect(() => engine.applyMutations(transaction)).toThrow(/numeric/i);
      expect(engine.roomState).toEqual(initial);
      expect(engine.drainEventBatches()).toEqual([]);
    } finally { engine.dispose(); }
  });

  it('preserves numeric stat definitions through copying and ability grants', () => {
    const { room, subject } = fixture();
    const blueprint = normalizeCard(rawCard({ abilities: [{ id: 'size', type: 'static', effects: [{ layer: 7, scope: { self: true },
      effect: { type: 'SET_STATS', power: add(count(), 4), toughness: 4 } }] }] }));
    let changed = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry: { source: 'global', requiredZone: null, layer: 1, duration: 'PERMANENT',
      scope: { cardUuid: subject.uuid }, effect: { type: 'COPY', blueprint } } });
    expect(characteristics.resolvePower(changed, subject)).toBe(6);
    changed = gameReducer(changed, { type: 'ADD_CONTINUOUS_EFFECT', entry: { source: 'global', requiredZone: null, layer: 6, duration: 'PERMANENT',
      scope: { cardUuid: subject.uuid }, effect: { type: 'ABILITY', add: [{ id: 'bonus', type: 'static', effects: [{ layer: 7, scope: { self: true },
        effect: { type: 'STAT_DELTA', power: count() as any } }] }] } } });
    expect(characteristics.resolvePower(JSON.parse(JSON.stringify(changed)), subject)).toBe(8);
  });

  it.each([
    { onCastEffects: [{ action: 'MODIFY_LIFE', params: { amount: { numeric: { kind: 'query', id: 'unknown', args: {} } } } }] },
    { onCastEffects: [{ action: 'MODIFY_LIFE', params: { amount: { numeric: { kind: 'query', id: 'field', args: { path: '__proto__.life' } } } } }] },
    { onCastEffects: [{ action: 'CUSTOM', params: { data: { nested: add(1, 2) } } }] },
    { onCastEffects: [{ action: 'MODIFY_LIFE', targeting: { type: 'permanent', maxTargets: add(1, 2) } }] },
    { castRequirements: { cost: { mana: { generic: field('controller.life') } } } },
    { abilities: [{ id: 'size', type: 'static', effects: [{ effect: { type: 'STAT_DELTA', power: { numeric: { kind: 'binding', name: 'X' } } } }] }] },
    { abilities: [{ id: 'trigger', type: 'triggered', effectId: 'MODIFY_LIFE', trigger: { condition: { op: 'eq', left: { numeric: { kind: 'bogus' } }, right: 1 } } }] },
    { abilities: [{ id: 'trigger', type: 'triggered', effectId: 'MODIFY_LIFE', trigger: { condition: { all: [], unused: add(1, 2) } } }] },
    { abilities: [{ id: 'trigger', type: 'triggered', effectId: 'MODIFY_LIFE', interveningIf: { not: { op: 'eq', left: 1, right: 2 }, unused: add(1, 2) } }] },
    { abilities: [{ id: 'trigger', type: 'triggered', effectId: 'MODIFY_LIFE', trigger: { condition: { op: 'eq', left: 1, right: 2, unused: add(1, 2) } } }] },
    { abilities: [{ id: 'size', type: 'static', effects: [{ effect: { type: 'STAT_DELTA', power: { count: {}, unused: add(1, 2) } } }] }] },
  ])('rejects unsupported or malformed authored numeric values: %j', extra => {
    expect(() => normalizeCard(rawCard(extra))).toThrow(/numeric/i);
  });
});
