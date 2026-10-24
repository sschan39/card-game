import { ACTION_IDS, type ActionId } from '../types/action.ids';
import { ActionRegistry, type ActionHandler } from './action-registry';
import { activateAbilityHandler } from './handlers/activate-ability-handler';
import { declareAttackersHandler } from './handlers/declare-attackers-handler';
import { declareBlockersHandler } from './handlers/declare-blockers-handler';
import { endTurnHandler } from './handlers/end-turn-handler';
import { enterBattleHandler } from './handlers/enter-battle-handler';
import { passPriorityHandler } from './handlers/pass-priority-handler';
import { playCardHandler } from './handlers/play-card-handler';
import { playLandHandler } from './handlers/play-land-handler';
import { resolveStackHandler } from './handlers/resolve-stack-handler';
import { rpsPlayHandler } from './handlers/rps-play-handler';
import { tapForManaHandler } from './handlers/tap-for-mana-handler';

const DEFAULT_ACTION_HANDLERS: Record<Exclude<ActionId, typeof ACTION_IDS.choose>, ActionHandler> = {
  [ACTION_IDS.castSpell]: playCardHandler,
  [ACTION_IDS.playLand]: playLandHandler,
  [ACTION_IDS.activateAbility]: activateAbilityHandler,
  [ACTION_IDS.declareAttackers]: declareAttackersHandler,
  [ACTION_IDS.declareBlockers]: declareBlockersHandler,
  [ACTION_IDS.tapForMana]: tapForManaHandler,
  [ACTION_IDS.enterBattle]: enterBattleHandler,
  [ACTION_IDS.endTurn]: endTurnHandler,
  [ACTION_IDS.passPriority]: passPriorityHandler,
  [ACTION_IDS.resolveStack]: resolveStackHandler,
  [ACTION_IDS.rpsPlay]: rpsPlayHandler,
};

export const createDefaultActionRegistry = (): ActionRegistry =>
  new ActionRegistry(DEFAULT_ACTION_HANDLERS);
