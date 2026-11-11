import { afterEach, describe, expect, it, vi } from 'vitest';
import rawCards from '../../packages/engine/src/library/cards';
import {
  normalizeActionCost,
  parseAbilityDefinition,
  parseAll,
  parseCardDefinition,
  parseManaCost,
} from '../../packages/engine/src/library/card-parser';
import {
  parseAuthoredEffect,
  parseContract,
  parseModifierDefinition,
  RawAbilitySchema,
} from '../../packages/engine/src/rules/schema/contracts';

const raw = rawCards as Record<string, Record<string, unknown>>;

afterEach(() => {
  vi.doUnmock('../../packages/engine/src/library/cards');
  vi.doUnmock('../../packages/engine/src/library/tokens');
  vi.resetModules();
});

async function catalog(cards: unknown, tokens: unknown, tokenIds: string[] = []) {
  vi.resetModules();
  vi.doMock('../../packages/engine/src/library/cards', () => ({ default: cards }));
  vi.doMock('../../packages/engine/src/library/tokens', () => ({
    default: tokens,
    isTokenDefinition: (id: string) => tokenIds.includes(id),
  }));
  return import('@library/card-catalog');
}

describe('card parser arithmetic and normalization', () => {
  it('sums numeric mana symbols and reads every colour', () => {
    expect(parseManaCost('{2}{3}')).toEqual({ generic: 5 });
    expect(parseManaCost('{W}{U}{B}{R}{G}{Y}')).toEqual({ white: 1, blue: 1, black: 1, red: 1, green: 1, yellow: 1 });
    expect(parseManaCost('{X}')).toEqual({ generic: { numeric: { kind: 'binding', name: 'X' } } });
    expect(parseManaCost('{X}{2}')).toEqual({
      generic: { numeric: { kind: 'add', left: { numeric: { kind: 'binding', name: 'X' } }, right: 2 } },
    });
    expect(parseManaCost('')).toEqual({});
    expect(() => parseManaCost('{Z}')).toThrow('Unsupported mana cost');
  });

  it('normalizes announcement costs including loyalty', () => {
    expect(normalizeActionCost({ loyalty: 2 })).toMatchObject({ loyalty: 2 });
    expect(normalizeActionCost(undefined)).toEqual({ mana: {}, tap: false, life: 0, discard: 0, sacrifice: false });
  });
});

describe('card parser definition edge cases', () => {
  it('parses every entry of an explicit catalog map', () => {
    const parsed = parseAll({ 'empire-servant': raw['empire-servant'] });
    expect(parsed['empire-servant']).toMatchObject({ id: 'empire-servant' });
  });

  it('keeps supertypes on the blueprint', () => {
    const parsed = parseCardDefinition({ schemaVersion: 1, id: 'hero', name: 'Hero', superTypes: ['Legendary'] });
    expect(parsed.superTypes).toEqual(['Legendary']);
  });

  it('rejects blank or duplicate mode identifiers', () => {
    expect(() =>
      parseCardDefinition({ schemaVersion: 1, id: 'mode-a', modes: [{ id: '  ', effects: [] }] }),
    ).toThrow('Missing or duplicate mode ID');
    expect(() =>
      parseCardDefinition({
        schemaVersion: 1,
        id: 'mode-b',
        modes: [
          { id: 'same', effects: [] },
          { id: 'same', effects: [] },
        ],
      }),
    ).toThrow('Missing or duplicate mode ID');
  });

  it('labels a schema failure from an anonymous definition', () => {
    expect(() => parseCardDefinition({})).toThrow('card');
  });

  it('drops a whitespace-only ability identifier', () => {
    const ability = parseAbilityDefinition({
      type: 'activated',
      id: ' ',
      effect: { action: 'DRAW', params: { amount: 1 } },
    });
    expect(ability).toMatchObject({ id: '' });
  });

  it('rejects a triggering ability without a trigger condition at the contract layer', () => {
    expect(() => parseAbilityDefinition({ type: 'triggered', id: 't' })).toThrow();
  });
});

describe('card catalog guards', () => {
  it('rejects a token identifier that shadows a card identifier', async () => {
    await expect(
      catalog({ dup: { schemaVersion: 1, id: 'dup' } }, { dup: { schemaVersion: 1, id: 'dup' } }, ['dup']),
    ).rejects.toThrow('Duplicate card/token definition: dup');
  });

  it('rejects a falsy authored definition', async () => {
    const { getBlueprint } = await catalog({ ghost: null }, {}, []);
    expect(() => getBlueprint('ghost')).toThrow('No raw card data found for ID: ghost');
  });

  it('rejects a definition whose identifier disagrees with its manifest key', async () => {
    const { getBlueprint } = await catalog({ 'wrong-key': { schemaVersion: 1, id: 'other' } }, {}, []);
    expect(() => getBlueprint('wrong-key')).toThrow('Definition ID does not match manifest: wrong-key');
  });

  it('rejects token blueprints that are not permanents', async () => {
    const { getBlueprint, getTokenBlueprint } = await catalog({}, { 'token-x': { schemaVersion: 1, id: 'token-x' } }, ['token-x']);
    expect(() => getBlueprint('token-x')).toThrow('Token blueprints must describe permanents');
    expect(() => getTokenBlueprint('unknown-token')).toThrow('Unknown token definition');
    expect(() => getBlueprint('missing')).toThrow('Unknown card definition');
  });

  it('rejects a token blueprint carrying the Spell type', async () => {
    const { getBlueprint } = await catalog(
      {},
      { 'token-spell': { schemaVersion: 1, id: 'token-spell', cardTypes: ['Spell'] } },
      ['token-spell'],
    );
    expect(() => getBlueprint('token-spell')).toThrow('Token blueprints must describe permanents');
  });
});

describe('rule contracts', () => {
  const switchStats = { id: 'rule', family: 'characteristics', scope: {}, operation: { type: 'SWITCH_STATS' } };
  const normalizedAbility = (id: string) => ({ id, type: 'activated', effect: { action: 'DRAW', params: { amount: 1 } } });
  const blueprint = (abilities: unknown[]) => ({ id: 'copy', castRequirements: {}, abilities });

  it('follows the lazy ability schema for added abilities', () => {
    const rule = parseModifierDefinition({
      id: 'grant',
      family: 'characteristics',
      scope: {},
      operation: { type: 'ABILITY', add: [normalizedAbility('gained')] },
    });
    expect(rule.operation).toMatchObject({ type: 'ABILITY' });
  });

  it('parses a copy operation with a normalized blueprint', () => {
    const rule = parseModifierDefinition({
      id: 'copy-target',
      family: 'characteristics',
      scope: {},
      operation: { type: 'COPY', blueprint: blueprint([normalizedAbility('copied')]) },
    });
    expect(rule.operation).toMatchObject({ type: 'COPY' });
  });

  it('rejects static abilities without rules and duplicate rules', () => {
    expect(() => parseAbilityDefinition({ type: 'static', id: 's' })).toThrow('Static ability requires rules');
    expect(() => parseAbilityDefinition({ type: 'static', id: 's', rules: [switchStats, switchStats] })).toThrow(
      'Duplicate modifier rule ID',
    );
    expect(
      parseAbilityDefinition({ type: 'static', id: 's', characteristicDefining: true, rules: [switchStats] }),
    ).toMatchObject({ id: 's', type: 'static', characteristicDefining: true });
  });

  it('rejects normalized static abilities without rules and duplicate rules', () => {
    expect(() =>
      parseModifierDefinition({
        id: 'copy-empty',
        family: 'characteristics',
        scope: {},
        operation: { type: 'COPY', blueprint: blueprint([{ id: 's', type: 'static' }]) },
      }),
    ).toThrow('Static ability requires rules or compiled effects');
    expect(() =>
      parseModifierDefinition({
        id: 'copy-dup',
        family: 'characteristics',
        scope: {},
        operation: { type: 'COPY', blueprint: blueprint([{ id: 's', type: 'static', rules: [switchStats, switchStats] }]) },
      }),
    ).toThrow('Duplicate modifier rule ID');
  });

  it('rejects targeting on collection instructions', () => {
    const capture = (targeting: Record<string, unknown>) => ({
      action: 'CAPTURE_WINDOW',
      params: { amount: 1 },
      recordResult: { name: 'window', kind: 'captured' },
      targeting,
    });
    expect(() => parseAuthoredEffect(capture({ type: 'permanent', required: true }))).toThrow(
      'Collection instructions do not accept targeting or outcome choices',
    );
    expect(() => parseAuthoredEffect(capture({ type: 'self', required: true }))).toThrow(
      'Collection instructions do not accept targeting or outcome choices',
    );
    expect(() => parseAuthoredEffect(capture({ type: 'self', required: false, cardTypes: ['Creature'] }))).toThrow(
      'Collection instructions do not accept targeting or outcome choices',
    );
  });

  it('rejects a continuous effect that mixes a scope with targeting', () => {
    expect(() =>
      parseAuthoredEffect({
        action: 'CREATE_CONTINUOUS_EFFECT',
        params: { effect: { type: 'SWITCH_STATS' }, scope: { zones: ['battlefield'] } },
        targeting: { type: 'self', required: false },
      }),
    ).toThrow('Use either a scope or targeting');
  });

  it('rejects a condition operand that needs an announced binding', () => {
    expect(() =>
      parseModifierDefinition({
        ...switchStats,
        condition: { op: 'eq', left: { numeric: { kind: 'binding', name: 'X' } }, right: 1 },
      }),
    ).toThrow('Modifier has no announced binding owner');
  });

  it('reports an unsafe definition tree', () => {
    const cyclic: Record<string, unknown> = { schemaVersion: 1, id: 'cyclic', name: 'Cyclic' };
    cyclic.self = cyclic;
    expect(() => parseCardDefinition(cyclic)).toThrow(/cyclic|cycle|depth/i);
  });

  it('rejects a listener event without an individual card subject', () => {
    expect(() =>
      parseContract(
        RawAbilitySchema,
        { type: 'triggered', id: 't', triggerCondition: 'ON_SHUFFLE', trigger: { listener: { kind: 'event_card', state: 'before', zones: ['library'] } } },
        'ability',
      ),
    ).toThrow('This event has no individual card subject; use a watcher');
  });

  it('checks replacement operations against their event families', () => {
    const replacement = (operation: Record<string, unknown>, events: string[]) => ({
      id: 'replacement',
      family: 'event-replacements',
      events,
      scope: { type: 'player', relation: 'any' },
      operation,
    });
    expect(() =>
      parseModifierDefinition(replacement({ type: 'prevent_damage', amount: 1 }, ['damage'])),
    ).not.toThrow();
    expect(() =>
      parseModifierDefinition(replacement({ type: 'damage_scale', factor: 2 }, ['damage'])),
    ).not.toThrow();
    expect(() =>
      parseModifierDefinition(replacement({ type: 'redirect_damage', recipient: { kind: 'player', playerId: 'player2' } }, ['damage'])),
    ).not.toThrow();
    expect(() => parseModifierDefinition(replacement({ type: 'move_destination', to: 'exile' }, ['draw']))).not.toThrow();
    expect(() => parseModifierDefinition(replacement({ type: 'regenerate' }, ['destroy']))).not.toThrow();
    expect(() => parseModifierDefinition(replacement({ type: 'cancel_event' }, ['damage']))).not.toThrow();
    expect(() =>
      parseModifierDefinition(replacement({ type: 'prevent_damage', amount: 1 }, ['destroy'])),
    ).toThrow('Operation does not support this event family');
    expect(() => parseModifierDefinition(replacement({ type: 'regenerate' }, ['damage']))).toThrow(
      'Operation does not support this event family',
    );
  });
});
