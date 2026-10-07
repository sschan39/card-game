import type { ActionData, ActionHandler, ActionResult } from '../action-registry';
import type { GameRoom, PlayerId } from '../../types/game.room.types';
import type { GameMutation } from '../../types/game-mutation.types';
import type { ActivatedStackObject } from '../../types/effect.types';
import { ActionValidator } from '../action-validator';
import { ModifierRegistry } from '../modifier-registry';
import { ManaPool } from '../mana-pool';
import { isManaAbility } from '../mana-abilities';
import { buildStackEffects } from '../effect-resolver';

/** Server definitions determine costs and effects; the packet selects only the ability. */
function plan(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult {
  const reject = (reason: string): ActionResult => ({ success: false, phase: 'validate', reason });
  const card = room.battlefield.find(c => c.uuid === action.cardUuid && c.state.controllerId === playerId);
  if (!card) return reject('Card not found on your battlefield');
  const ability = card.blueprint.abilities.find(a => a.id === action.abilityId);
  if (!ability || ability.type !== 'activated' || isManaAbility(ability)) return reject('Select a valid non-mana ability');
  const cost = ability.cost;
  if (cost.discard || cost.sacrifice || cost.loyalty !== undefined) return reject('This ability requires an unsupported cost');
  if ((cost.life !== undefined && (!Number.isSafeInteger(cost.life) || cost.life < 0)) ||
      (cost.tap !== undefined && typeof cost.tap !== 'boolean')) return reject('Invalid ability cost');
  const valid = ActionValidator.canActivate(room, playerId, card, { allowedZones: ['battlefield'], speed: ability.castSpeed, cost });
  if (!valid.valid) return reject(valid.reason ?? 'Cannot activate ability');
  const def = ability.effect.targeting;
  const targets = action.targets ?? [];
  if (!Array.isArray(targets)) return reject('Invalid targets');
  if (def.type !== 'self' && !def.all &&
      (!ActionValidator.canTarget(room, playerId, card, targets, def) || !ModifierRegistry.canTarget(room, playerId, card, targets))) return reject('Target is not legal');
  const payment = ManaPool.proposePayment(room.players[playerId].mana, cost.mana ?? {}, action.payment);
  if (!payment) return reject('Invalid mana payment');
  const mutations: GameMutation[] = [];
  if (Object.keys(payment).length) mutations.push({ type: 'SPEND_MANA', playerId, cost: payment });
  if (cost.life) mutations.push({ type: 'SET_LIFE', playerId, amount: room.players[playerId].life - cost.life });
  if (cost.tap) mutations.push({ type: 'TAP_CARD', cardUuid: card.uuid });
  const effects = buildStackEffects([ability.effect], playerId, card);
  if (def.type !== 'self' && !def.all) effects[0].targets = targets;
  const stackObject: ActivatedStackObject = {
    uuid: typeof action.stackUuid === 'string' ? action.stackUuid : '', type: 'activated', controllerId: playerId,
    source: structuredClone(card), ability, effects, countered: false,
  };
  mutations.push({ type: 'PUSH_STACK', stackObject });
  return { success: true, stackObject, mutations };
}

export const activateAbilityHandler: ActionHandler = { validate: plan, propose: plan };
