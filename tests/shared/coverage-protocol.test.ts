import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  changeCardCounts,
  choiceAnswerDetails,
  filterCatalog,
  importScenario,
  newScenario,
  type CatalogCard,
} from '@card-game/protocol';

const fixture = JSON.parse(readFileSync('tests/fixtures/scenarios/development.json', 'utf8'));

describe('scenario protocol edge paths', () => {
  it('measures every UTF-8 width when importing a fixture', () => {
    const withWideName = structuredClone(fixture);
    withWideName.scenario.name = 'é中😀 ascii';
    const imported = importScenario(JSON.stringify(withWideName));
    expect(imported.scenario.name).toBe('é中😀 ascii');
  });

  it('rejects imports over the 64 KiB budget before parsing JSON', () => {
    expect(() => importScenario('x'.repeat(65_537))).toThrow('64 KiB');
  });

  it('creates a playable default scenario', () => {
    const scenario = newScenario();
    expect(scenario.players).toHaveLength(2);
    expect(scenario.players[0].library).toEqual([{ cardId: 'land-red', quantity: 10 }]);
  });
});

describe('deck editor helpers', () => {
  const land: CatalogCard = { id: 'land-red', name: 'Mountain', manaCost: '', cardTypes: ['Land'], subTypes: ['Mountain'], rulesText: 'Add red mana.', colors: [], deckLegal: true, copyLimit: null };
  const creature: CatalogCard = { id: 'empire-servant', name: 'Servant', manaCost: '{R}', cardTypes: ['Creature'], subTypes: ['Soldier'], rulesText: '', colors: ['R'], power: 1, toughness: 2, deckLegal: true, copyLimit: 4 };

  it('keeps the original entries when the requested delta is not a safe integer', () => {
    const entries = [{ cardId: 'land-red', quantity: 2 }];
    expect(changeCardCounts(entries, 'land-red', Number.NaN)).toEqual(entries);
    expect(changeCardCounts(entries, 'land-red', 1.5)).toEqual(entries);
  });

  it('refuses to exceed the configured maximum and removes entries that reach zero', () => {
    const entries = [{ cardId: 'land-red', quantity: 250 }];
    expect(changeCardCounts(entries, 'land-red', 1)).toEqual(entries);
    expect(changeCardCounts([], 'land-red', 1)).toEqual([{ cardId: 'land-red', quantity: 1 }]);
    expect(changeCardCounts([{ cardId: 'land-red', quantity: 249 }], 'land-red', 1, 250)).toEqual([{ cardId: 'land-red', quantity: 250 }]);
    expect(changeCardCounts([{ cardId: 'empire-servant', quantity: 1 }], 'empire-servant', -1)).toEqual([]);
    expect(changeCardCounts([{ cardId: 'rock', quantity: 1 }, { cardId: 'land-red', quantity: 1 }], 'land-red', 1))
      .toEqual([{ cardId: 'land-red', quantity: 2 }, { cardId: 'rock', quantity: 1 }]);
  });

  it('filters a catalog by every optional dimension', () => {
    const base = { search: '', type: '', color: '', legalOnly: false };
    expect(filterCatalog([land, creature], base)).toEqual([land, creature]);
    expect(filterCatalog([land, creature], { ...base, legalOnly: true, type: 'Creature', color: 'R' })).toEqual([creature]);
    expect(filterCatalog([land, creature], { ...base, color: 'colorless' })).toEqual([land]);
    expect(filterCatalog([land, creature], { ...base, search: 'SERVANT' })).toEqual([creature]);
  });
});

describe('choice diagnostics', () => {
  it('omits absent fields and reports only positive numeric allocations', () => {
    expect(choiceAnswerDetails()).toEqual({
      number: undefined,
      selected: undefined,
      attackers: undefined,
      assignments: undefined,
      allocationChoices: undefined,
      allocationTotal: undefined,
    });
  });

  it('sums numeric allocations while ignoring non-numeric values', () => {
    const details = choiceAnswerDetails({
      number: 4,
      choices: ['a', 'b'],
      attackers: [{ id: 'attacker' }],
      assignments: [{ id: 'blocker' }],
      allocations: { a: 2, b: 'nope', c: 0, d: 1 },
    });
    expect(details.selected).toBe(2);
    expect(details.attackers).toEqual([{ id: 'attacker' }]);
    expect(details.assignments).toEqual([{ id: 'blocker' }]);
    expect(details.allocationChoices).toEqual([{ id: 'a', amount: 2 }, { id: 'd', amount: 1 }]);
    expect(details.allocationTotal).toBe(3);
  });
});
