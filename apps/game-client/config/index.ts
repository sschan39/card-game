import diagnostics from './diagnostics.json';
import ui from './ui.json';

if (typeof diagnostics.logging.actions !== 'boolean' || !Number.isInteger(ui.savedDeckPageSize) || ui.savedDeckPageSize < 1 || ui.savedDeckPageSize > 100)
  throw new Error('Invalid player interface configuration');
export const clientFlags = structuredClone(diagnostics);
export const clientUi = Object.freeze(ui);
