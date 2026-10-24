import type { ActionHandler, ActionResult } from '../action-registry';
import { planManaActivation } from '../action-costs';

const plan: ActionHandler['validate'] = (room, playerId, action): ActionResult => {
  const result = planManaActivation(room, playerId, action);
  return result.success ? result : { ...result, phase: 'validate' };
};

export const tapForManaHandler: ActionHandler = { validate: plan, propose: plan };