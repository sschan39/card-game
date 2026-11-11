import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { buildCatalog } from '@server/catalog/catalog';
import { migrate } from '@server/stores/migrations';
import { DeckEligibilitySchema } from '@card-game/protocol';

// Synthetic blueprints exercise the catalog's display fallbacks without the
// shipped card data: a numeric generic cost that is not a single named binding
// (printed as "Variable") and a blueprint with no subTypes.
const { blueprints } = vi.hoisted(() => {
  const blueprints: Record<string, Record<string, unknown>> = {
    'synthetic-variable': {
      id: 'synthetic-variable', name: 'Synthetic variable', cardTypes: ['Spell'], rulesText: '', colors: [],
      castRequirements: { allowedZones: ['hand'], speed: 'sorcery', cost: { mana: {
        generic: { numeric: { kind: 'add', left: 2, right: { numeric: { kind: 'binding', name: 'X' } } } },
      } } },
    },
    'synthetic-basic': {
      id: 'synthetic-basic', name: 'Synthetic basic', cardTypes: ['Creature'], subTypes: ['Beast'], rulesText: 'Trample', colors: ['red'],
      power: 2, toughness: 3,
      castRequirements: { allowedZones: ['hand'], speed: 'sorcery', cost: { mana: { generic: 3, red: 2 } } },
    },
  };
  return { blueprints };
});
vi.mock('@card-game/engine/library/card-catalog', () => ({
  getCardIds: () => Object.keys(blueprints),
  getBlueprint: (id: string) => blueprints[id],
}));

const requireServer = createRequire(resolve('apps/server/package.json'));
const Database = requireServer('better-sqlite3') as typeof import('better-sqlite3');
const open: InstanceType<typeof Database>[] = [];
afterEach(() => { open.splice(0).forEach(database => database.close()); });

describe('catalog display fallbacks', () => {
  it('prints a non-binding numeric generic as Variable and tolerates a blueprint without subTypes', () => {
    const catalog = buildCatalog(DeckEligibilitySchema.parse({ unlimitedCopies: [], excludedCards: [], copyLimits: {} }));
    expect(catalog.get('synthetic-variable')).toEqual({
      id: 'synthetic-variable', name: 'Synthetic variable', cardTypes: ['Spell'], subTypes: [], rulesText: '', manaCost: '{Variable}',
      colors: [], deckLegal: true, copyLimit: 4,
    });
    expect(catalog.get('synthetic-basic')).toEqual({
      id: 'synthetic-basic', name: 'Synthetic basic', cardTypes: ['Creature'], subTypes: ['Beast'], rulesText: 'Trample', manaCost: '{3}{R}{R}',
      colors: ['red'], power: 2, toughness: 3, deckLegal: true, copyLimit: 4,
    });
  });
});

describe('migration sequence validation', () => {
  it('refuses a migration list whose versions are not the required ordered sequence', () => {
    const database = new Database(':memory:');
    open.push(database);
    expect(() => migrate(database, [{ version: 2, sql: '' }])).toThrow('Invalid migration sequence');
    expect(() => migrate(database, [{ version: 1, sql: 'CREATE TABLE t (id INTEGER) STRICT' }, { version: 3, sql: '' }])).toThrow('Invalid migration sequence');
  });
});
