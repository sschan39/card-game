import type { DebugMode } from './types/debug-mode.types';
import type { ManaColor } from './types/card.types';

/** The six game elements. Workbook aliases 木/寒 mean 風/雪; 無 is generic payment. */
export const elementColors = {
  炎: 'red', 魔: 'black', 風: 'green', 雷: 'yellow', 雪: 'white', 海: 'blue',
} as const satisfies Record<string, ManaColor>;

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

/** Opt-in trigger playtest deck; normal rooms retain the development deck above. */
export const triggerTestSetup: SetupConfig = {
  ...gameConfig.setup,
  developmentDeck: [...Array.from({ length: 20 }, () => 'land-red'),
    'trigger-probe', 'trigger-probe', 'trigger-probe', 'land-red', 'land-red'],
};

/** Real ST01A consumers supported by today's engine; missing effects are marked on the cards. */
export const st01aTestSetup: SetupConfig = {
  ...gameConfig.setup,
  openingHandSize: 7,
  developmentDeck: [...Array.from({ length: 49 }, () => 'land-red'),
    'awakened-blood-mountain', 'worlds-rebel', 'fireball', 'land-red', 'flame-fangs', 'broken-fireball',
    'musketeer-infantry', 'empire-servant', 'land-red', 'land-red', 'land-red'],
};

/** Opt-in workbook consumers. Deck top is the array end; no default room changes. */
export const workbookTestSetup: SetupConfig = {
  ...gameConfig.setup,
  openingHandSize: 7,
  developmentDeck: [
    ...Array.from({ length: 7 }, (_, i) => ['land-red', 'phantom-underworld', 'beast-holy-land', 'aurora-northland', 'angel-holy-land', 'sea-domain'][i % 6]),
    'fatiao-warrior', 'blazing-dragon-habitat', 'phantom-land-soldier', 'phantom-captain',
    'hera-empowerment', 'phantom-castle', 'phantom-underworld',
    'wind-beast-rabbit', 'wind-beast-fox', 'lesser-wind-fatigue',
    'okair-mountains', 'okair-tomb', 'beast-holy-land', 'winter-drake', 'aurora-northland',
    'sky-hound', 'winged-envoy', 'angel-holy-land', 'worlds-sin-emperor', 'nether-ancient-land',
    'swift-spirit-envoy', 'nature-gift', 'divine-wind-torii', 'frozen-snowball',
    'ancient-weapon-battlefield', 'thunder-main-camp', 'undying-dusk-forest',
    'blazing-wind-river', 'far-north-graveyard', 'thunder-tundra',
    'rise-of-power', 'pursuit-of-purifying-fire', 'sea-patrol', 'abyss-illusionist',
    'worlds-sea-lord', 'raging-sea-power', 'worlds-pyromancer', 'phantom-sea-gotu',
    'phantom-sea-corporal', 'sea-depths', 'sea-city-noble', 'worlds-merchant',
    'worlds-sea', 'sea-domain', 'demon-flame-abyss', 'great-wave-thunder-array',
    'wind-call', 'worlds-traveler', 'wind-beast-bean',
    'land-red', 'land-red', 'beast-holy-land', 'phantom-underworld',
  ],
};

/** Opt-in opening for the small-mechanics consumer flow; top is array end. */
export const smallMechanicsTestSetup: SetupConfig = {
  ...gameConfig.setup,
  openingHandSize: 7,
  developmentDeck: [
    ...Array.from({ length: 48 }, (_, i) => ['land-red', 'phantom-underworld', 'beast-holy-land', 'aurora-northland', 'angel-holy-land', 'sea-domain'][i % 6]),
    'rise-of-power', 'pursuit-of-purifying-fire', 'abyss-illusionist', 'worlds-sea-lord', 'phantom-sea-gotu',
    'raging-sea-power', 'worlds-pyromancer', 'sea-patrol', 'land-red', 'land-red', 'sea-domain', 'sea-domain',
  ],
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
