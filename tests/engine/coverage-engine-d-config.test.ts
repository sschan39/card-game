import { describe, expect, it } from 'vitest';
import {
  elementColors,
  gameConfig,
  getRuleDefaults,
  getSetupPreset,
  landPlayLimit,
  smallMechanicsTestSetup,
  snapshotSetupConfig,
  st01aTestSetup,
  triggerTestSetup,
  workbookTestSetup,
} from '@config';
import type { SetupConfig } from '@shared/setup-config.types';

const base: SetupConfig = {
  startingLife: 20,
  openingHandSize: 2,
  firstPlayerDrawsOnFirstTurn: true,
  shuffleDevelopmentDeck: false,
  developmentDeck: ['empire-servant', 'land-red'],
};

describe('engine configuration defaults', () => {
  it('derives every gameplay preset from the shared rule defaults', () => {
    expect(getSetupPreset('trigger')).toMatchObject({
      startingLife: 20,
      openingHandSize: 5,
      firstPlayerDrawsOnFirstTurn: true,
      landPlaysPerTurn: 1,
      shuffleDevelopmentDeck: false,
    });
    expect(getSetupPreset('small-mechanics').openingHandSize).toBe(7);
    expect(st01aTestSetup.scorch).toBe(true);
    expect(triggerTestSetup.developmentDeck).toContain('trigger-probe');
    expect(workbookTestSetup.developmentDeck.length).toBeGreaterThan(0);
    expect(smallMechanicsTestSetup.openingHandSize).toBe(7);
    expect(gameConfig.setup.startingLife).toBe(20);
    expect(gameConfig.debugMode).toBe('flow');
    expect(gameConfig.logging).toEqual({ actions: true, appliedEvents: false });
    expect(Object.values(elementColors).sort()).toEqual(['black', 'blue', 'green', 'red', 'white', 'yellow']);
  });

  it('exposes a private copy of the rule defaults', () => {
    const first = getRuleDefaults() as unknown as Record<string, unknown>;
    first.startingLife = 1;
    expect(getRuleDefaults().startingLife).toBe(20);
  });

  it('resolves the land play allowance from the setup, then the room default', () => {
    expect(landPlayLimit()).toBe(1);
    expect(landPlayLimit({ ...base, landPlaysPerTurn: 0 })).toBe(0);
    expect(landPlayLimit({ ...base, landPlaysPerTurn: 3 })).toBe(3);
    expect(snapshotSetupConfig({ ...base, landPlaysPerTurn: 4 }).landPlaysPerTurn).toBe(4);
    expect(snapshotSetupConfig({ ...base, landPlaysPerTurn: undefined }).landPlaysPerTurn).toBe(1);
  });

  it('falls back to the authored rule default when the live config omits a limit', () => {
    const original = gameConfig.setup;
    try {
      gameConfig.setup = { ...original, landPlaysPerTurn: undefined };
      expect(landPlayLimit()).toBe(1);
    } finally {
      gameConfig.setup = original;
    }
  });

  it('snapshots a valid setup into an independent copy', () => {
    const setup = snapshotSetupConfig(base);
    setup.developmentDeck.push('empire-servant');
    expect(snapshotSetupConfig(base).developmentDeck).toEqual(['empire-servant', 'land-red']);
  });

  it('accepts explicit player decks in place of a development deck', () => {
    const setup = snapshotSetupConfig({
      ...base,
      developmentDeck: [],
      playerDecks: { player1: ['empire-servant', 'land-red'], player2: ['broken-fireball', 'land-red'] },
    });
    expect(setup.playerDecks?.player1).toEqual(['empire-servant', 'land-red']);
    expect(setup.landPlaysPerTurn).toBe(1);
    expect(snapshotSetupConfig(base).developmentDeck).toHaveLength(2);
  });

  it.each<[string, SetupConfig]>([
    ['a non-positive starting life', { ...base, startingLife: 0 }],
    ['a negative opening hand', { ...base, openingHandSize: -1 }],
    ['a development deck that is not a list', { ...base, developmentDeck: 'empire-servant' as unknown as string[] }],
    ['an opening hand larger than the shared deck', { ...base, openingHandSize: 3 }],
    ['a blank card id', { ...base, developmentDeck: ['a', '   '] }],
    ['a non-string card id', { ...base, developmentDeck: ['a', 1] as unknown as string[] }],
    ['an empty development deck without player decks', { ...base, developmentDeck: [] }],
    ['a non-boolean first-player draw rule', { ...base, firstPlayerDrawsOnFirstTurn: 1 as unknown as boolean }],
    ['a non-boolean shuffle rule', { ...base, shuffleDevelopmentDeck: 'no' as unknown as boolean }],
    ['a fractional land play limit', { ...base, landPlaysPerTurn: 1.5 }],
    ['a negative land play limit', { ...base, landPlaysPerTurn: -1 }],
  ])('rejects %s', (_label, setup) => {
    expect(() => snapshotSetupConfig(setup)).toThrow('Invalid gameplay setup configuration');
  });

  it.each<[string, Record<string, unknown>]>([
    ['no decks at all', { playerDecks: {} }],
    ['a deck that is not a list', { playerDecks: { player1: 'empire-servant' } }],
    ['a deck shorter than the opening hand', { playerDecks: { player1: ['empire-servant'] } }],
    ['a blank card id in a player deck', { playerDecks: { player1: ['empire-servant', ' '] } }],
    ['a non-string card id in a player deck', { playerDecks: { player1: ['empire-servant', 2] } }],
  ])('rejects player decks with %s', (_label, override) => {
    expect(() =>
      snapshotSetupConfig({ ...base, ...(override as unknown as Partial<SetupConfig>) }),
    ).toThrow('Invalid gameplay setup configuration');
  });
});
