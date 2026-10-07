import type { ActionHandler, ActionData, ActionResult } from '../action-registry';
import type { GameRoom, PlayerId } from '../../types/game.room.types';
import type { GameMutation } from '../../types/game-mutation.types';
import { manaAbilities, manaOutput } from '../mana-abilities';
import { ManaPool } from '../mana-pool';
import { ActionValidator } from '../action-validator';

/** Plan one selected mana ability atomically, without putting it on the stack. */
function plan(room: GameRoom, playerId: PlayerId, action: ActionData): ActionResult {
  const reject = (reason: string): ActionResult => ({ success: false, phase: 'validate', reason });
  const card = room.battlefield.find(card => card.uuid === action.cardUuid && card.state.controllerId === playerId);
  if (!card) return reject('Card not found on your battlefield');
  const candidates = manaAbilities(card);
  const selected = action.abilityIndex === undefined && candidates.length === 1 ? candidates[0]
    : candidates.find(entry => entry.abilityIndex === action.abilityIndex);
  if (!selected) return reject('Select a valid mana ability');
  const { ability } = selected;
  const output = manaOutput(ability);
  if (!output) return reject('Invalid mana output');
  const color = action.manaColor ?? (output.colors.length === 1 ? output.colors[0] : undefined);
  if (!output.colors.includes(color as typeof output.colors[number])) return reject('Select a valid mana color');
  const cost = ability.cost;
  if (cost.discard || cost.sacrifice) return reject('This mana ability requires an unsupported cost');
  if ((cost.life !== undefined && (!Number.isSafeInteger(cost.life) || cost.life < 0)) ||
      (cost.tap !== undefined && typeof cost.tap !== 'boolean')) return reject('Invalid mana ability cost');
  const valid = ActionValidator.canActivate(room, playerId, card, { allowedZones: ['battlefield'], speed: ability.castSpeed, cost });
  if (!valid.valid) return reject(valid.reason ?? 'Cannot activate mana ability');
  const payment = ManaPool.proposePayment(room.players[playerId].mana, cost.mana ?? {}, action.payment);
  if (!payment) return reject('Invalid mana payment');
  if (!Number.isSafeInteger(room.players[playerId].mana[color as typeof output.colors[number]] - (payment[color as typeof output.colors[number]] ?? 0) + output.amount)) return reject('Mana output exceeds the pool limit');
  const mutations: GameMutation[] = [];
  if (Object.keys(payment).length) mutations.push({ type: 'SPEND_MANA', playerId, cost: payment });
  if (cost.life) mutations.push({ type: 'SET_LIFE', playerId, amount: room.players[playerId].life - cost.life });
  if (cost.tap) mutations.push({ type: 'TAP_CARD', cardUuid: card.uuid });
  mutations.push({ type: 'ADD_MANA', playerId, color: color as typeof output.colors[number], amount: output.amount });
  return { success: true, mutations };
}

export const tapForManaHandler: ActionHandler = {
  validate: plan,
  propose: plan,
  resolve: () => ({ success: true }),
};
