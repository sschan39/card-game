import type { DebugMode } from './types/debug-mode.types';

export interface SetupConfig {
  startingLife: number;
  openingHandSize: number;
  firstPlayerDrawsOnFirstTurn: boolean;
  shuffleDevelopmentDeck: boolean;
  developmentDeck: string[];
  landPlaysPerTurn?: number;
}

/** Project settings. Restart the server after changing these defaults. */
export const gameConfig: { debugMode: DebugMode; logging: { actions: boolean; appliedEvents: boolean }; setup: SetupConfig } = {
  setup: {
    startingLife: 20, openingHandSize: 5, firstPlayerDrawsOnFirstTurn: true,
    shuffleDevelopmentDeck: false,
    developmentDeck: ['empire-servant', 'empire-servant', 'land-red', 'land-red', 'empire-servant', 'choice-practice', 'choice-practice', 'land-red', 'land-red', 'empire-servant', 'empire-servant', 'broken-fireball'],
    landPlaysPerTurn: 1,
  },
  debugMode: 'flow',
  logging: { actions: true, appliedEvents: false },
};

/** Central fallback for legacy rooms/settings which predate land play. */
export function landPlayLimit(setup?: SetupConfig): number {
  return setup?.landPlaysPerTurn ?? gameConfig.setup.landPlaysPerTurn ?? 1;
}

/** Validate and snapshot settings once when a room is created. */
export function snapshotSetupConfig(): SetupConfig {
  const setup = gameConfig.setup;
  if (!Number.isSafeInteger(setup.startingLife) || setup.startingLife <= 0 ||
      !Number.isSafeInteger(setup.openingHandSize) || setup.openingHandSize < 0 ||
      !Array.isArray(setup.developmentDeck) || !setup.developmentDeck.length ||
      !setup.developmentDeck.every(id => typeof id === 'string' && id.trim()) ||
      setup.openingHandSize > setup.developmentDeck.length ||
      typeof setup.firstPlayerDrawsOnFirstTurn !== 'boolean' || typeof setup.shuffleDevelopmentDeck !== 'boolean' ||
      !Number.isSafeInteger(landPlayLimit(setup)) || landPlayLimit(setup) < 0) {
    throw new Error('Invalid setup configuration');
  }
  return structuredClone({ ...setup, landPlaysPerTurn: landPlayLimit(setup) });
}
