import { CardCharacteristicService } from '../card-characteristic-service';
import type { ActionData, ActionHandler, ActionResult } from '../action-registry';
import type { GameRoom, PlayerId } from '../../types/game.room.types';
import type { GameMutation } from '../../types/game-mutation.types';
import type { ActivatedStackObject } from '../../types/effect.types';
import { ActionValidator } from '../action-validator';
import { planActionCosts } from '../action-costs';
import { isManaAbility } from '../mana-abilities';
import { buildStackEffects } from '../effect-resolver';
import { planTargetGroups } from '../target-groups';
import { selectModeEffects } from '../../shared/action-modes';
import { planAnnouncedDistributions } from '../announced-distributions';
import { captureSourceInformation } from '../source-information';
import { gameReducer } from '../game-reducer';
import { abilityLimitReached, abilityUseKey } from '../turn-history';

/** Server definitions determine costs and effects; the packet selects only the ability. */
function plan(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult {
  const reject = (reason: string): ActionResult => ({ success: false, phase: 'validate', reason });
  const card = room.battlefield.find(c => c.uuid === action.cardUuid && CardCharacteristicService.resolveController(room, c) === playerId);
  if (!card) return reject('Card not found on your battlefield');
  const ability = CardCharacteristicService.resolveAbilities(room, card).find(a => a.id === action.abilityId);
  if (!ability || ability.type !== 'activated' || isManaAbility(ability)) return reject('Select a valid non-mana ability');
  if (abilityLimitReached(room, card, ability)) return reject('Ability use limit reached for this turn');
  const cost = ability.cost;
  const valid = ActionValidator.canActivate(room, playerId, card, { allowedZones: ['battlefield'], speed: ability.castSpeed }, 'activate', ability.id);
  if (!valid.valid) return reject(valid.reason ?? 'Cannot activate ability');
  const effects = selectModeEffects([ability.effect], ability.modes, action.modes, ability.modeCount);
  if (!effects) return reject('Select valid modes');
  const targets = planTargetGroups(room, playerId, card, buildStackEffects(effects, playerId, card), action);
  if (!targets.success) return reject(targets.reason);
  const distributions = planAnnouncedDistributions(targets.effects, action);
  if (!distributions.success) return reject(distributions.reason);
  const costs = planActionCosts(room, playerId, card, cost, action);
  if (!costs.success) return reject(costs.reason);
  const mutations: GameMutation[] = [...costs.mutations];
  let sourceInfo = captureSourceInformation(room, card);
  let paymentRoom = room;
  for (const mutation of costs.mutations) {
    if (mutation.type === 'MOVE_CARD' && mutation.cardUuid === card.uuid && mutation.from === card.state.zone) {
      const live = paymentRoom.battlefield.find(source => source.uuid === card.uuid);
      if (live) sourceInfo = captureSourceInformation(paymentRoom, live);
    }
    paymentRoom = gameReducer(paymentRoom, mutation);
  }
  const stackObject: ActivatedStackObject = {
    uuid: typeof action.stackUuid === 'string' ? action.stackUuid : '', type: 'activated', controllerId: playerId,
    source: structuredClone(card), sourceInfo, ability, effects: distributions.effects, targetGroups: targets.groups, countered: false,
  };
  mutations.push({ type: 'PUSH_STACK', stackObject });
  mutations.push({ type: 'RECORD_ABILITY_USE', key: abilityUseKey(card, ability.id ?? '') });
  return { success: true, stackObject, mutations };
}

export const activateAbilityHandler: ActionHandler = { validate: plan, propose: plan };
