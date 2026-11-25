import diagnostics from '../config/diagnostics.json';
import type { DebugMode } from '../types/debug-mode.types';

if (
  !['off', 'stack', 'flow'].includes(diagnostics.debugMode) ||
  typeof diagnostics.logging.actions !== 'boolean' ||
  typeof diagnostics.logging.appliedEvents !== 'boolean'
) {
  throw new Error('Invalid engine diagnostic/element configuration');
}

export const engineDiagnostics = {
  debugMode: diagnostics.debugMode as DebugMode,
  logging: { ...diagnostics.logging },
};
