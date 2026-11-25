import type { DebugMode } from '@card-game/engine/types/debug-mode.types';
import type { ManaColor } from '@card-game/engine/types/card.types';
import type { MatchRules } from '@card-game/engine/types/setup-config.types';
import elements from './elements.json';
import rules from './gameplay-defaults.json';
import { engineDiagnostics } from '@card-game/engine/shared/diagnostic-settings';
import presets from './gameplay-presets.json';

export interface SetupConfig extends MatchRules {
  startingLife: number;
  openingHandSize: number;
  shuffleDevelopmentDeck: boolean;
  developmentDeck: string[];
  playerDecks?: Record<string, string[]>;
}

export interface RoomSettings { setup: SetupConfig; debugMode: DebugMode }

const hasValidElementColors = Object.values(elements).every((color) =>
  ['red', 'black', 'green', 'yellow', 'white', 'blue'].includes(color),
);

if (!hasValidElementColors) {
  throw new Error('Invalid engine diagnostic/element configuration');
}

// The JSON shape is validated above; this assertion preserves the keyed color map for callers.
export const elementColors = elements as Record<keyof typeof elements, ManaColor>;

export const gameplayPresetNames = Object.keys(presets);

export function getSetupPreset(name: string): SetupConfig {
  if (!Object.prototype.hasOwnProperty.call(presets, name)) throw new Error(`Unknown gameplay preset '${name}'`);
  return snapshotSetupConfig({ ...rules, ...presets[name as keyof typeof presets] });
}

let developmentSetup: SetupConfig | undefined;

/** Fixture setup is resolved only for callers using development rooms. */
export const gameConfig: { debugMode: DebugMode; logging: { actions: boolean; appliedEvents: boolean }; setup: SetupConfig } = {
  get debugMode() { return engineDiagnostics.debugMode; },
  set debugMode(value) { engineDiagnostics.debugMode = value; },
  get logging() { return engineDiagnostics.logging; },
  set logging(value) { engineDiagnostics.logging = value; },
  get setup() { return developmentSetup ??= getSetupPreset('development'); },
  set setup(value) { developmentSetup = value; },
};

export function getRuleDefaults(){return structuredClone(rules);}

export function landPlayLimit(setup?: MatchRules): number {
  return setup?.landPlaysPerTurn ?? rules.landPlaysPerTurn;
}

export function matchRulesFrom(setup: MatchRules): MatchRules {
  return {
    firstPlayerDrawsOnFirstTurn: setup.firstPlayerDrawsOnFirstTurn,
    ...(setup.landPlaysPerTurn === undefined ? {} : { landPlaysPerTurn: setup.landPlaysPerTurn }),
    ...(setup.scorch === undefined ? {} : { scorch: setup.scorch }),
  };
}

/** Validate and copy per room. Defaults are resolved at call time for legacy fixture callers. */
export function snapshotSetupConfig(setup: SetupConfig = gameConfig.setup): SetupConfig {
  const hasValidStartingLife =
    Number.isSafeInteger(setup.startingLife) && setup.startingLife > 0;
  const hasValidOpeningHand =
    Number.isSafeInteger(setup.openingHandSize) && setup.openingHandSize >= 0;
  const hasValidDevelopmentDeck =
    Array.isArray(setup.developmentDeck) &&
    (setup.developmentDeck.length > 0 || !!setup.playerDecks) &&
    setup.developmentDeck.every((id) => typeof id === 'string' && id.trim());
  const hasValidFirstPlayerDrawSetting =
    typeof setup.firstPlayerDrawsOnFirstTurn === 'boolean';
  const hasValidShuffleSetting = typeof setup.shuffleDevelopmentDeck === 'boolean';
  const hasValidPlayerDecks = !setup.playerDecks || Object.keys(setup.playerDecks).length > 0 && Object.values(setup.playerDecks).every(deck => Array.isArray(deck) && deck.length >= setup.openingHandSize && deck.every(id => typeof id === 'string' && !!id.trim()));
  const setupLandPlayLimit = landPlayLimit(setup);
  const hasValidLandPlayLimit =
    Number.isSafeInteger(setupLandPlayLimit) && setupLandPlayLimit >= 0;

  if (
    !hasValidStartingLife ||
    !hasValidOpeningHand ||
    !hasValidDevelopmentDeck ||
    (!setup.playerDecks && setup.openingHandSize > setup.developmentDeck.length) ||
    !hasValidFirstPlayerDrawSetting ||
    !hasValidShuffleSetting ||
    !hasValidPlayerDecks ||
    !hasValidLandPlayLimit
  ) {
    throw new Error('Invalid gameplay setup configuration');
  }

  return structuredClone({ ...setup, landPlaysPerTurn: setupLandPlayLimit });
}
