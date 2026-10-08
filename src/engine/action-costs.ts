import type { ActionData } from './action-registry';
import type { ActionCost } from '../types/effect.types';
import type { CardInstance } from '../types/card.types';
import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { GameMutation } from '../types/game-mutation.types';
import { ManaPool } from './mana-pool';
import { manaAbilities, manaOutput } from './mana-abilities';
import { ActionValidator } from './action-validator';
import { gameReducer } from './game-reducer';
import { abilityLimitReached, abilityUseKey } from './turn-history';

type CostPlan = { success: true; mutations: GameMutation[] } | { success: false; reason: string };
const reject = (reason: string): CostPlan => ({ success: false, reason });
const preview = (room: GameRoom, mutations: GameMutation[]) => mutations.reduce(gameReducer, room);
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Plan payment without events, checkpoints or mutation of authoritative state. */
export function planActionCosts(room: GameRoom, playerId: PlayerId, source: CardInstance, cost: ActionCost = {}, selections: ActionData = {}, reservedCardUuid = source.state.zone === 'hand' ? source.uuid : undefined): CostPlan {
  let working = room;
  const mutations: GameMutation[] = [];
  if (selections.manaActivations !== undefined) {
    if (!Array.isArray(selections.manaActivations)) return reject('manaActivations must be an array');
    for (const selection of selections.manaActivations) {
      if (!object(selection) || selection.manaActivations !== undefined) return reject('Invalid mana activation selection');
      const result = planManaActivation(working, playerId, selection, reservedCardUuid);
      if (!result.success) return result;
      mutations.push(...result.mutations); working = preview(working, result.mutations);
    }
  }
  const payment = planDirectCost(working, playerId, source, cost, selections, reservedCardUuid);
  return payment.success ? { success: true, mutations: [...mutations, ...payment.mutations] } : payment;
}

export function actionCostError(cost: ActionCost): string | undefined {
  if (Object.keys(cost).some(key => !['mana', 'life', 'tap', 'untap', 'discard', 'sacrifice'].includes(key))) return 'Unsupported action cost';
  for (const field of ['life', 'discard'] as const) {
    if (cost[field] !== undefined && (!Number.isSafeInteger(cost[field]) || cost[field]! < 0)) return 'Invalid action cost';
  }
  for (const field of ['tap', 'untap', 'sacrifice'] as const) {
    if (cost[field] !== undefined && typeof cost[field] !== 'boolean') return 'Invalid action cost';
  }
  if (cost.tap && cost.untap) return 'Cannot pay both tap and untap costs';
}

function planDirectCost(room: GameRoom, playerId: PlayerId, source: CardInstance, cost: ActionCost, selections: ActionData, reservedCardUuid?: string): CostPlan {
  const error = actionCostError(cost);
  if (error) return reject(error);
  const player = room.players[playerId];
  if (!player || player.life < (cost.life ?? 0)) return reject('Cannot pay life cost');
  const live = room.battlefield.find(c => c.uuid === source.uuid && c.state.controllerId === playerId);
  if (cost.tap || cost.untap || cost.sacrifice) {
    if (!live) return reject('Cost source is not on your battlefield');
    if ((cost.tap && live.state.isTapped) || (cost.untap && !live.state.isTapped)) return reject('Cannot pay orientation cost');
    if ((cost.tap || cost.untap) && live.blueprint.cardTypes.includes('Creature') && live.state.summoningSickness && !live.blueprint.keywords?.includes('Haste')) return reject('Summoning sickness prevents paying this cost');
  }
  const selected = selections.discardUuids ?? [];
  if (!Array.isArray(selected) || selected.length !== (cost.discard ?? 0) ||
      selected.some(uuid => typeof uuid !== 'string') || new Set(selected).size !== selected.length) return reject('Select the required cards to discard');
  const discarded = selected.map(uuid => player.hand.find(c => c.uuid === uuid && c.uuid !== source.uuid && c.uuid !== reservedCardUuid));
  if (discarded.some(card => !card)) return reject('Invalid discard selection');
  const payment = ManaPool.proposePayment(player.mana, cost.mana ?? {}, selections.payment);
  if (!payment) return reject('Invalid mana payment');
  const mutations: GameMutation[] = [];
  if (Object.keys(payment).length) mutations.push({ type: 'SPEND_MANA', playerId, cost: payment });
  if (cost.life) mutations.push({ type: 'SET_LIFE', playerId, amount: player.life - cost.life });
  if (cost.tap) mutations.push({ type: 'TAP_CARD', cardUuid: source.uuid });
  if (cost.untap) mutations.push({ type: 'UNTAP_CARD', cardUuid: source.uuid });
  for (const card of discarded) mutations.push({ type: 'MOVE_CARD', cardUuid: card!.uuid, playerId: card!.state.ownerId, from: 'hand', to: 'graveyard', reason: 'discard' });
  if (cost.sacrifice) mutations.push({ type: 'MOVE_CARD', cardUuid: source.uuid, playerId: source.state.ownerId, from: 'battlefield', to: 'graveyard' });
  return { success: true, mutations };
}

/** Immediate mana activation; reusable within a larger payment transaction. */
export function planManaActivation(room: GameRoom, playerId: PlayerId, action: ActionData, reservedCardUuid?: string): CostPlan {
  const card = room.battlefield.find(c => c.uuid === action.cardUuid && c.state.controllerId === playerId);
  if (!card) return reject('Card not found on your battlefield');
  const candidates = manaAbilities(card);
  const selected = action.abilityId !== undefined ? candidates.find(entry => entry.ability.id === action.abilityId)
    : action.abilityIndex === undefined && candidates.length === 1 ? candidates[0]
    : candidates.find(entry => entry.abilityIndex === action.abilityIndex);
  if (!selected) return reject('Select a valid mana ability');
  const { ability } = selected;
  if (abilityLimitReached(room, card, ability)) return reject('Ability use limit reached for this turn');
  const output = manaOutput(ability);
  if (!output) return reject('Invalid mana output');
  const color = action.manaColor ?? (output.colors.length === 1 ? output.colors[0] : undefined);
  if (!output.colors.includes(color as typeof output.colors[number])) return reject('Select a valid mana color');
  const valid = ActionValidator.canActivate(room, playerId, card, { allowedZones: ['battlefield'], speed: ability.castSpeed });
  if (!valid.valid) return reject(valid.reason ?? 'Cannot activate mana ability');
  const costs = planActionCosts(room, playerId, card, ability.cost, action, reservedCardUuid);
  if (!costs.success) return costs;
  const after = preview(room, costs.mutations);
  if (!Number.isSafeInteger(after.players[playerId].mana[color as typeof output.colors[number]] + output.amount)) return reject('Mana output exceeds the pool limit');
  return { success: true, mutations: [...costs.mutations, { type: 'ADD_MANA', playerId, color: color as typeof output.colors[number], amount: output.amount },
    { type: 'RECORD_ABILITY_USE', key: abilityUseKey(card, ability.id ?? '') }] };
}
