import { describe, expect, it } from 'vitest';
import { activeRules, recordRuleUse, ruleUse, ruleUseAvailable } from '../../packages/engine/src/rules/runtime/active-rules';
import type { ActiveRule } from '../../packages/engine/src/rules/runtime/active-rules';
import type { CardInstance } from '@shared/card.types';
import type { GameRoom } from '@shared/game.room.types';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';

const costRule = (id: string, overrides: Record<string, unknown> = {}) =>
  ({ id, family: 'costs', operation: { type: 'increase', amount: 1 }, ...overrides }) as never;

const staticAbility = (id: string, rules?: unknown[]) =>
  ({ id, type: 'static', activeZones: ['battlefield'], effects: [], ...(rules ? { rules } : {}) }) as never;

const cardWithAbilities = (uuid: string, abilities: unknown[]): CardInstance => {
  const card = creature(uuid, 'player1');
  card.blueprint = { ...card.blueprint, abilities: abilities as CardInstance['blueprint']['abilities'] };
  return card;
};

const ruleSource = (): CardInstance => {
  const source = creature('rule-source', 'player1');
  source.blueprint = { ...source.blueprint, id: 'rule-source' };
  return source;
};

const activeRule = (overrides: Partial<ActiveRule> & { definition?: unknown } = {}): ActiveRule =>
  ({
    definition: costRule('r'),
    source: ruleSource(),
    controllerId: 'player1',
    abilityId: 'ability-1',
    id: 'active-1',
    ...overrides,
  }) as ActiveRule;

describe('active rules: discovery', () => {
  it('discovers static ability rules once a card or pool carries an evaluated rule', () => {
    const room: GameRoom = createTestRoom();
    room.battlefield = [
      cardWithAbilities('static-source', [
        staticAbility('static-1', [costRule('rule-1')]),
        staticAbility('static-2'),
      ]),
      cardWithAbilities('event-source', [
        staticAbility('event-static', [
          { id: 'ev', family: 'event-replacements', events: ['damage'], scope: { type: 'card' }, operation: { type: 'prevent_damage', amount: 1 } },
        ]),
      ]),
    ];

    const found = activeRules(room);
    const fromAbility = found.find((rule) => rule.abilityId === 'static-1');
    expect(fromAbility).toMatchObject({
      abilityId: 'static-1',
      controllerId: 'player1',
      id: 'rule:static-source:0:static-1:rule-1',
    });
    expect(fromAbility?.source.uuid).toBe('static-source');
    expect(found.some((rule) => rule.abilityId === 'static-2')).toBe(false);
    expect(found.some((rule) => rule.abilityId === 'event-static')).toBe(true);
  });

  it('treats event-replacement rules as evaluated even without a cost rule', () => {
    const room: GameRoom = createTestRoom();
    room.battlefield = [
      cardWithAbilities('event-only', [
        staticAbility('event-only-static', [
          { id: 'ev', family: 'event-replacements', events: ['damage'], scope: { type: 'card' }, operation: { type: 'prevent_damage', amount: 1 } },
        ]),
      ]),
    ];

    const found = activeRules(room);
    expect(found.some((rule) => rule.abilityId === 'event-only-static')).toBe(true);
  });

  it('discovers abilities that omit activeZones and caches frozen definitions', () => {
    const room: GameRoom = createTestRoom();
    const card = cardWithAbilities('default-zones', [
      { id: 'no-zones', type: 'static', effects: [], rules: [costRule('rule-1')] } as never,
    ]);
    card.state.zoneRevision = undefined as unknown as number;
    Object.freeze(card.blueprint);
    room.battlefield = [card];

    const first = activeRules(room);
    const second = activeRules(room);

    expect(first.find((rule) => rule.abilityId === 'no-zones')?.id).toBe('rule:default-zones:0:no-zones:rule-1');
    expect(second.find((rule) => rule.abilityId === 'no-zones')?.id).toBe('rule:default-zones:0:no-zones:rule-1');
  });

  it('ignores static abilities outside their active zones and short-circuits without evaluated rules', () => {
    const outside: GameRoom = createTestRoom();
    outside.battlefield = [
      cardWithAbilities('zoning', [
        { id: 'z-static', type: 'static', activeZones: ['graveyard'], effects: [], rules: [costRule('rule-1')] } as never,
      ]),
    ];
    expect(activeRules(outside)).toEqual([]);

    const empty: GameRoom = createTestRoom();
    expect(activeRules(empty)).toEqual([]);
  });

  it('adds rules granted by counters', () => {
    const room: GameRoom = createTestRoom();
    const source = creature('counter-host', 'player1');
    source.state.counters = { aurora: 1 };
    room.battlefield = [source];

    const found = activeRules(room);
    expect(found.some((rule) => rule.counterType === 'aurora')).toBe(true);
    expect(found.every((rule) => rule.abilityId.startsWith('counter:'))).toBe(true);
  });
});

describe('active rules: use budgets', () => {
  it('keys rules by source incarnation, controller identity and usage group', () => {
    const source = ruleSource();

    const incarnation = activeRule({ source, definition: costRule('r', { usage: { identity: 'source_incarnation', period: 'turn', limit: 1, consume: 'on_commit' } }) });
    expect(ruleUse(incarnation)?.key).toBe('rule-use:rule-source:0:ability-1:r');

    const controller = activeRule({ source, definition: costRule('r', { usage: { identity: 'controller', period: 'turn', limit: 1, consume: 'on_commit' } }) });
    expect(ruleUse(controller)?.key).toBe('rule-use:player1:rule-source:ability-1:r');

    const grouped = activeRule({
      source,
      controllerId: 'player2',
      definition: costRule('r', { usage: { identity: 'controller', group: 'team', period: 'game', limit: 2, consume: 'on_commit' } }),
    });
    expect(ruleUse(grouped)).toEqual({ key: 'usage:player2:group:team', period: 'game', limit: 2 });

    const physical = activeRule({ source, definition: costRule('r', { usage: { identity: 'source_card', period: 'turn', limit: 1, consume: 'on_commit' } }) });
    expect(ruleUse(physical)?.key).toBe('rule-use:rule-source:ability-1:r');

    const unlimited = activeRule({ source, definition: costRule('r') });
    expect(ruleUse(unlimited)).toBeUndefined();
  });

  it('uses a counter-scoped key and falls back to revision zero', () => {
    const source = ruleSource();
    source.state.zoneRevision = undefined as unknown as number;

    const counter = activeRule({
      source,
      counterType: 'charge',
      definition: costRule('r', { usage: { identity: 'source_incarnation', period: 'turn', limit: 1, consume: 'on_commit' } }),
    });
    expect(ruleUse(counter)?.key).toBe('counter-use:["rule-source:0","charge","r"]');
  });

  it('reports availability from the matching history bucket and records the right mutation', () => {
    const room: GameRoom = createTestRoom();
    const turnUse = { key: 'rule-use:x', period: 'turn' as const, limit: 1 };
    const gameUse = { key: 'game-use:x', period: 'game' as const, limit: 1 };

    expect(ruleUseAvailable(room, undefined)).toBe(true);
    expect(ruleUseAvailable(room, turnUse)).toBe(true);
    expect(ruleUseAvailable(room, gameUse)).toBe(true);

    room.turnHistory = {
      ...(room.turnHistory ?? { turnNumber: 1, events: [], counts: {}, playerCounts: {}, uses: {}, landPlays: {} }),
      uses: { 'rule-use:x': 1 },
    };
    expect(ruleUseAvailable(room, turnUse)).toBe(false);
    room.gameRuleUses = { 'game-use:x': 1 };
    expect(ruleUseAvailable(room, gameUse)).toBe(false);

    expect(recordRuleUse(room, turnUse)).toEqual({ type: 'RECORD_ABILITY_USE', key: 'rule-use:x', turnNumber: 1 });
    expect(recordRuleUse(room, gameUse)).toEqual({ type: 'RECORD_GAME_RULE_USE', key: 'game-use:x' });
  });
});
