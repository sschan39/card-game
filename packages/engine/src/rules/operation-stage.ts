import type { ContinuousEffect } from '../types/continuous-effect.types';

/** Execution order belongs to the operation contract, never to an authored numeric layer override. */
export function operationStage(effect: ContinuousEffect, defining = false): number {
  switch (effect.type) {
    case 'COPY': return 1; case 'CONTROL': return 2; case 'TEXT': return 3; case 'TYPE': return 4; case 'COLOR': return 5; case 'MANA_COST': return 5.5; case 'ABILITY': return 6;
    case 'SET_STATS': return defining ? 70 : 71; case 'STAT_DELTA': return 72; case 'SWITCH_STATS': return 73;
    case 'MILL_AMOUNT': return 74; case 'MANA_SUBSTITUTION': return 75; case 'PERMISSION': return 80;
  }
}
