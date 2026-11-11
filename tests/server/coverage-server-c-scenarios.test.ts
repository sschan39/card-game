import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ScenarioFixtureSchema } from '@card-game/protocol';
import type { ScenarioRecord } from '@card-game/protocol';
import { getSetupPreset } from '@card-game/engine/config';
import { newScenario } from '@card-game/protocol';
import { presetFixture, presetNames } from '@server/scenarios/presets';
import { MemoryScenarioRepository } from '@server/scenarios/repository';
import developmentPreset from '../../packages/engine/src/config/presets/development.json';

const record = (overrides: Partial<ScenarioRecord> = {}): ScenarioRecord => ({
  id: 'scenario-one',
  revision: 1,
  scenario: newScenario(),
  createdAt: 10,
  updatedAt: 10,
  ...overrides,
});

describe('legacy scenario presets', () => {
  it('aggregates every preset deck into counts while preserving order, hand size and rules profile', () => {
    expect(presetNames).toEqual(['development', 'trigger', 'st01a', 'workbook', 'small-mechanics']);
    for (const name of presetNames) {
      const preset = getSetupPreset(name);
      const fixture = presetFixture(name);
      expect(ScenarioFixtureSchema.safeParse(fixture).success).toBe(true);
      expect(fixture.scenario.name).toBe('Legacy ' + name);
      expect(fixture.scenario.openingHandSize).toBe(preset.openingHandSize);
      expect(fixture.scenario.shuffle).toBe('fixed');
      expect(fixture.scenario.rulesProfile).toBe(preset.scorch ? 'scorch-v1' : 'standard-v1');
      expect(fixture.scenario.seed).toBe(1);
      expect(fixture.scenario.firstPlayer).toBe(0);
      expect(fixture.provenance).toEqual({ sourceId: null, revision: 0, instanceId: 'legacy-fixtures' });
      expect(fixture.scenario.players).toHaveLength(2);
      const expectedCounts = new Map<string, number>();
      for (const cardId of preset.developmentDeck) expectedCounts.set(cardId, (expectedCounts.get(cardId) ?? 0) + 1);
      for (const player of fixture.scenario.players) {
        expect(player.life).toBe(preset.startingLife);
        expect(player.library).toEqual([...expectedCounts].map(([cardId, quantity]) => ({ cardId, quantity })));
        expect(player.libraryOrder).toEqual([...preset.developmentDeck].reverse());
        expect(player.hand).toEqual([]);
        expect(player.graveyard).toEqual([]);
        expect(player.battlefield).toEqual([]);
      }
      expect(fixture.scenario.players[0]).not.toBe(fixture.scenario.players[1]);
    }
  });

  it('marks a shuffled preset as seeded and restores the preset data', () => {
    const original = developmentPreset.shuffleDevelopmentDeck;
    developmentPreset.shuffleDevelopmentDeck = true;
    try {
      const fixture = presetFixture('development');
      expect(fixture.scenario.shuffle).toBe('seeded');
      expect(fixture.scenario.seed).toBe(1);
    } finally {
      developmentPreset.shuffleDevelopmentDeck = original;
    }
    expect(presetFixture('development').scenario.shuffle).toBe('fixed');
  });

  it('produces independent fixtures on every call', () => {
    const first = presetFixture('workbook'), second = presetFixture('workbook');
    expect(first).toEqual(second);
    expect(first.scenario.players[0].library).not.toBe(second.scenario.players[0].library);
    first.scenario.players[0].library.push({ cardId: 'mutated', quantity: 1 });
    expect(presetFixture('workbook').scenario.players[0].library).toEqual(second.scenario.players[0].library);
  });
});

describe('in-memory scenario repository', () => {
  it('commits transactions and restores records after a failure', () => {
    const repository = new MemoryScenarioRepository();
    expect(repository.scenarioTransaction(() => 'result')).toBe('result');
    expect(repository.saveScenario(record(), 0)).toBe(true);
    expect(() =>
      repository.scenarioTransaction(() => {
        repository.saveScenario(record({ id: 'transient' }), 0);
        expect(repository.findScenario('transient')).toBeDefined();
        throw new Error('rollback');
      }),
    ).toThrow('rollback');
    expect(repository.findScenario('transient')).toBeUndefined();
    expect(repository.listScenarios(0, 10).total).toBe(1);
  });

  it('lists newest first with an identifier tie-break and defensive copies', () => {
    const repository = new MemoryScenarioRepository();
    repository.saveScenario(record({ id: 'b', updatedAt: 5 }), 0);
    repository.saveScenario(record({ id: 'a', updatedAt: 5 }), 0);
    repository.saveScenario(record({ id: 'c', updatedAt: 9 }), 0);
    const page = repository.listScenarios(0, 2);
    expect(page.total).toBe(3);
    expect(page.records.map(entry => entry.id)).toEqual(['c', 'a']);
    page.records[0].scenario.name = 'mutated page';
    expect(repository.findScenario('c')!.scenario.name).not.toBe('mutated page');
    const tail = repository.listScenarios(2, 10);
    expect(tail.records.map(entry => entry.id)).toEqual(['b']);
    expect(repository.findScenario('missing')).toBeUndefined();
  });

  it('enforces optimistic revisions for saves and deletes', () => {
    const repository = new MemoryScenarioRepository();
    const first = record();
    expect(repository.saveScenario(first, 1)).toBe(false);
    expect(repository.saveScenario(first, 0)).toBe(true);
    const updated = { ...first, revision: 2 };
    expect(repository.saveScenario(updated, 1)).toBe(true);
    expect(repository.saveScenario({ ...updated, revision: 3 }, 1)).toBe(false);
    expect(repository.deleteScenario(first.id, 1)).toBe(false);
    expect(repository.deleteScenario('missing', 0)).toBe(false);
    expect(repository.deleteScenario(first.id, 2)).toBe(true);
    expect(repository.findScenario(first.id)).toBeUndefined();
  });

  it('keeps records isolated when the caller mutates the saved object', () => {
    const repository = new MemoryScenarioRepository();
    const value = record({ id: randomUUID() });
    repository.saveScenario(value, 0);
    value.scenario.name = 'mutated saved object';
    expect(repository.findScenario(value.id)!.scenario.name).not.toBe('mutated saved object');
  });
});
