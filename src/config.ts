import type { DebugMode } from './types/debug-mode.types';

export interface SetupConfig {
  startingLife: number;
  openingHandSize: number;
  firstPlayerDrawsOnFirstTurn: boolean;
  shuffleDevelopmentDeck: boolean;
  developmentDeck: string[];
}

/** Project settings. Restart the server after changing these defaults. */
export const gameConfig: { debugMode: DebugMode; logging: { appliedEvents: boolean }; setup: SetupConfig } = {
  setup: {
    startingLife: 20, openingHandSize: 4, firstPlayerDrawsOnFirstTurn: true,
    shuffleDevelopmentDeck: true,
    developmentDeck: ['broken-fireball', 'empire-servant', 'empire-servant', 'empire-servant', 'land-red', 'land-red', 'land-red', 'land-red', 'broken-fireball'],
  },
  debugMode: 'flow',
  logging: { appliedEvents: false },
};

/** Validate and snapshot settings once when a room is created. */
export function snapshotSetupConfig(): SetupConfig {
  const setup = gameConfig.setup;
  if (!Number.isSafeInteger(setup.startingLife) || setup.startingLife <= 0 ||
      !Number.isSafeInteger(setup.openingHandSize) || setup.openingHandSize < 0 ||
      !Array.isArray(setup.developmentDeck) || !setup.developmentDeck.length ||
      !setup.developmentDeck.every(id => typeof id === 'string' && id.trim()) ||
      setup.openingHandSize > setup.developmentDeck.length ||
      typeof setup.firstPlayerDrawsOnFirstTurn !== 'boolean' || typeof setup.shuffleDevelopmentDeck !== 'boolean') {
    throw new Error('Invalid setup configuration');
  }
  return structuredClone(setup);
}
