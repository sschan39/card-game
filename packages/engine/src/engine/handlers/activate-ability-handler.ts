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
import { prepareAnnouncement, abilityAnnouncementDefinition } from '../announcement-values';
import { findActivationSource } from '../activation-source';
import { abilityEffects } from '../ability-effects';

/** Server definitions determine costs and effects; the packet selects only the ability. */
function plan(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult {
  const reject = (reason: string): ActionResult => ({ success: false, phase: 'validate', reason });
  const card = findActivationSource(room, playerId, action.cardUuid);
  if (!card) return reject('Ability source not found');
  const ability = CardCharacteristicService.resolveAbilities(room, card).find(a => a.id === action.abilityId);
  if (!ability || ability.type !== 'activated' || isManaAbility(ability)) return reject('Select a valid non-mana ability');
  if (abilityLimitReached(room, card, ability)) return reject('Ability use limit reached for this turn');
  const announcement = prepareAnnouncement(card, abilityAnnouncementDefinition(ability), action);
  if (!announcement.success) return reject(announcement.reason);
  if (announcement.missing) return reject('Choose all declared numbers');
  if (announcement.missingCostRoute) return reject('Choose a cost route');
  const cost = announcement.cost;
  const valid = ActionValidator.canActivate(room, playerId, card, { allowedZones: ability.allowedZones ?? ['battlefield'], speed: ability.castSpeed }, 'activate', ability.id);
  if (!valid.valid) return reject(valid.reason ?? 'Cannot activate ability');
  const effects = selectModeEffects(abilityEffects(ability), ability.modes, action.modes, ability.modeCount, { room, playerId });
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
      const live = findActivationSource(paymentRoom, playerId, card.uuid);
      if (live) sourceInfo = captureSourceInformation(paymentRoom, live);
    }
    paymentRoom = gameReducer(paymentRoom, mutation);
  }
  const stackObject: ActivatedStackObject = {
    uuid: typeof action.stackUuid === 'string' ? action.stackUuid : '', type: 'activated', controllerId: playerId,
    source: structuredClone(card), sourceInfo, ability, effects: distributions.effects, targetGroups: targets.groups, countered: false,
    ...(Object.keys(announcement.bindings).length ? { numericBindings: announcement.bindings } : {}),
  };
  mutations.push({ type: 'PUSH_STACK', stackObject });
  mutations.push({ type: 'RECORD_ABILITY_USE', key: abilityUseKey(card, ability.id ?? '') });
  return { success: true, stackObject, mutations };
}

export const activateAbilityHandler: ActionHandler = { validate: plan, propose: plan };
