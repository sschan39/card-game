import { getSetupPreset } from '@server/config/gameplay';

export * from '@server/config/gameplay';
export const triggerTestSetup = getSetupPreset('trigger');
export const st01aTestSetup = getSetupPreset('st01a');
export const workbookTestSetup = getSetupPreset('workbook');
export const smallMechanicsTestSetup = getSetupPreset('small-mechanics');
