import type { DebugMode } from '../types/debug-mode.types';
import type { ManaColor } from '../types/card.types';
import type { SetupConfig } from '../types/setup-config.types';
import elements from './elements.json';
import rules from './rules/default-v1.json';
import diagnostics from './diagnostics.json';
import development from './presets/development.json';
import trigger from './presets/trigger.json';
import st01a from './presets/st01a.json';
import workbook from './presets/workbook.json';
import smallMechanics from './presets/small-mechanics.json';
export type { SetupConfig } from '../types/setup-config.types';

if (!['off', 'stack', 'flow'].includes(diagnostics.debugMode) || typeof diagnostics.logging.actions !== 'boolean' || typeof diagnostics.logging.appliedEvents !== 'boolean' ||
    Object.values(elements).some(color => !['red', 'black', 'green', 'yellow', 'white', 'blue'].includes(color))) throw new Error('Invalid engine diagnostic/element configuration');
export const elementColors = elements as Record<keyof typeof elements, ManaColor>;
const presets = { development, trigger, st01a, workbook, 'small-mechanics': smallMechanics };
export type GameplayPreset = keyof typeof presets;
export function getSetupPreset(name: GameplayPreset): SetupConfig { return snapshotSetupConfig({ ...rules, ...presets[name] }); }

/** Compatibility API; editable defaults live in JSON. Tests can still select fixture setups. */
export const gameConfig: { debugMode: DebugMode; logging: { actions: boolean; appliedEvents: boolean }; setup: SetupConfig } = {
  debugMode: diagnostics.debugMode as DebugMode, logging: { ...diagnostics.logging }, setup: getSetupPreset('development'),
};
export const triggerTestSetup = getSetupPreset('trigger');
export const st01aTestSetup = getSetupPreset('st01a');
export const workbookTestSetup = getSetupPreset('workbook');
export const smallMechanicsTestSetup = getSetupPreset('small-mechanics');

export function landPlayLimit(setup?: SetupConfig): number { return setup?.landPlaysPerTurn ?? gameConfig.setup.landPlaysPerTurn ?? rules.landPlaysPerTurn; }
/** Validate and copy per room. Defaults are resolved at call time for legacy fixture callers. */
export function snapshotSetupConfig(setup: SetupConfig = gameConfig.setup): SetupConfig {
  if (!Number.isSafeInteger(setup.startingLife) || setup.startingLife <= 0 ||
      !Number.isSafeInteger(setup.openingHandSize) || setup.openingHandSize < 0 ||
      !Array.isArray(setup.developmentDeck) || !setup.developmentDeck.length ||
      !setup.developmentDeck.every(id => typeof id === 'string' && id.trim()) ||
      setup.openingHandSize > setup.developmentDeck.length || typeof setup.firstPlayerDrawsOnFirstTurn !== 'boolean' ||
      typeof setup.shuffleDevelopmentDeck !== 'boolean' || !Number.isSafeInteger(landPlayLimit(setup)) || landPlayLimit(setup) < 0)
    throw new Error('Invalid gameplay setup configuration');
  return structuredClone({ ...setup, landPlaysPerTurn: landPlayLimit(setup) });
}
