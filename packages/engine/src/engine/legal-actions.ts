import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { ActionId } from '../types/action.ids';
import type { ActionData, ActionHandler } from './action-registry';
import type { ChoiceAnswer, PendingChoice } from '../types/choice.types';
import { declarationPlayer } from '../shared/turn-utils';
import { CardCharacteristicService, withCharacteristicCache } from './card-characteristic-service';
import { prepareActionChoice, applyActionChoice } from './action-choices';
import { validateChoiceAnswer } from './choices';
import { playCardHandler } from './handlers/play-card-handler';
import { activateAbilityHandler } from './handlers/activate-ability-handler';
import { tapForManaHandler } from './handlers/tap-for-mana-handler';
import { validateLandPlay } from './handlers/play-land-handler';
import { isManaAbility, manaAbilities, manaOutput } from './mana-abilities';

export interface LegalActionWitness { actionId: ActionId; data: ActionData }
export type LegalNonPassActionResult =
  | { kind: 'available'; action: LegalActionWitness }
  | { kind: 'none' }
  | { kind: 'unknown'; reason: 'not_ready' | 'search_limit' | 'number_range_limit' | 'unsupported_choice' };
export interface LegalActionQueryOptions { maxNodes?: number }
interface Search {
  remaining: number;
  incomplete?: Extract<LegalNonPassActionResult, { kind: 'unknown' }>['reason'];
}
interface Candidate extends LegalActionWitness { handler: Pick<ActionHandler, 'validate'> }

function spend(search: Search): boolean {
  if (search.remaining-- > 0) return true;
  search.incomplete = 'search_limit';
  return false;
}

/** Ordered subsets cover modes and targets whose order may affect the announced instruction list. */
function* selections(
  ids: string[], min: number, max: number, search: Search, selected: string[] = [],
): Generator<string[]> {
  if (!spend(search)) return;
  if (selected.length >= min) yield selected;
  if (selected.length >= max) return;
  if (selected.length >= 32) { search.incomplete = 'search_limit'; return; }
  for (const id of ids) {
    if (search.remaining <= 0) { search.incomplete = 'search_limit'; return; }
    if (!selected.includes(id)) yield* selections(ids, min, max, search, [...selected, id]);
  }
}

/** Enumerate whole-total allocations, bounded by the node budget and option cap. */
export function* allocations(
  choice: Exclude<PendingChoice, { kind: 'number' }>, search: Search,
  index = 0, remaining = choice.total ?? 0, values: Record<string, number> = {},
): Generator<Record<string, number>> {
  if (!spend(search)) return;
  if (index === choice.options.length) {
    yield values;
  } else {
    if (index >= 32) { search.incomplete = 'search_limit'; return; }
    const option = choice.options[index];
    const minimum = choice.minimumPerOption ?? 0;
    const maximum = Math.min(option.limit ?? remaining, remaining - minimum * (choice.options.length - index - 1));
    const start = index === choice.options.length - 1 ? remaining : minimum;
    for (let amount = start; amount <= maximum; amount++) {
      if (search.remaining <= 0) { search.incomplete = 'search_limit'; return; }
      yield* allocations(choice, search, index + 1, remaining - amount, { ...values, [option.id]: amount });
    }
  }
}

function* answers(choice: PendingChoice, search: Search): Generator<ChoiceAnswer> {
  if (choice.kind === 'number') {
    // Open/large ranges are sampled, never treated as exhausted after a failed sample.
    const end = Math.min(choice.range.max ?? Infinity, choice.range.min + 31);
    if (choice.range.max === undefined || choice.range.max > end) search.incomplete = 'number_range_limit';
    for (let number = choice.range.min; number <= end; number++) {
      if (!spend(search)) return;
      const answer = validateChoiceAnswer(choice, { number });
      yield answer!;
    }
    return;
  }
  if (choice.kind === 'distribution' || choice.kind === 'payment') {
    for (const allocation of allocations(choice, search)) {
      const answer = validateChoiceAnswer(choice, { allocations: allocation });
      yield answer!;
    }
    return;
  }
  for (const ids of selections(choice.options.map(option => option.id), choice.min, choice.max, search)) {
    const answer = validateChoiceAnswer(choice, { choices: ids });
    yield answer!;
  }
}

function complete(
  room: GameRoom, playerId: PlayerId, candidate: Candidate, search: Search, data = candidate.data, depth = 0,
): LegalActionWitness | undefined {
  if (!spend(search)) return;
  if (depth >= 32) { search.incomplete = 'search_limit'; return; }
  const preparation = prepareActionChoice(room, playerId, candidate.actionId, data, true);
  if (preparation.kind === 'reject') return;
  if (preparation.kind === 'none') {
    if (candidate.handler.validate(room, playerId, data).success) return { actionId: candidate.actionId, data };
    return;
  }
  const continuation = preparation.choice.continuation as Extract<PendingChoice['continuation'], { type: 'action' }>;
  for (const answer of answers(preparation.choice, search)) {
    const witness = complete(room, playerId, candidate, search, applyActionChoice(continuation, answer), depth + 1);
    if (witness) return witness;
    if (search.remaining <= 0) return;
  }
}

function* candidates(room: GameRoom, playerId: PlayerId): Generator<Candidate> {
  const hand = room.players[playerId].hand;
  // Mana is a legal action itself; no simulation of a later cast is necessary to prove availability.
  const battlefield = room.battlefield.filter(card => CardCharacteristicService.resolveController(room, card) === playerId);
  for (const card of battlefield) {
    for (const { ability } of manaAbilities(card, room)) {
      for (const manaColor of manaOutput(ability)?.colors ?? []) {
        yield { actionId: 'tapForMana', data: { cardUuid: card.uuid, abilityId: ability.id, manaColor },
          handler: tapForManaHandler };
      }
    }
  }
  for (const card of hand) {
    if (CardCharacteristicService.resolveTypes(room, card).includes('Land')) {
      yield { actionId: 'play_land', data: { cardUuid: card.uuid, zoneRevision: card.state.zoneRevision ?? 0 },
        handler: { validate: validateLandPlay } };
    } else {
      yield { actionId: 'cast_spell', data: { cardUuid: card.uuid }, handler: playCardHandler };
    }
  }
  for (const card of [...hand, ...battlefield]) {
    for (const ability of CardCharacteristicService.resolveAbilities(room, card)) {
      if (ability.type !== 'activated' || isManaAbility(ability)) continue;
      if (!(ability.allowedZones ?? ['battlefield']).includes(card.state.zone as 'hand' | 'battlefield')) continue;
      yield { actionId: 'activate_ability', data: { cardUuid: card.uuid, abilityId: ability.id },
        handler: activateAbilityHandler };
    }
  }
}

/**
 * Pure, bounded query for ordinary built-in gameplay actions at an idle priority window.
 * Available includes a fully validated witness. None means exhaustive rejection within the supported domain.
 * Unknown must never authorize auto-pass. Excludes concede, pass, debug/turn shortcuts and declarations.
 * Call only after the engine's private rules checkpoint/collector has settled; no actions are executed here.
 */
export function hasLegalNonPassAction(
  room: GameRoom, playerId: PlayerId, options: LegalActionQueryOptions = {},
): LegalNonPassActionResult {
  const limit = options.maxNodes ?? 512;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 8192) throw new RangeError('maxNodes must be between 1 and 8192');
  if (room.status !== 'playing' || room.outcome || room.engineState !== 'waiting_for_player' ||
      room.priorityPlayerId !== playerId || room.pendingChoice || room.triggerQueue || room.pendingTriggers?.length ||
      declarationPlayer(room) || (playerId !== room.player1Id && playerId !== room.player2Id) ||
      !Object.prototype.hasOwnProperty.call(room.players, playerId)) return { kind: 'unknown', reason: 'not_ready' };
  return withCharacteristicCache(room, () => {
    const search: Search = { remaining: limit };
    for (const candidate of candidates(room, playerId)) {
      const witness = complete(room, playerId, candidate, search);
      if (witness) return { kind: 'available', action: witness };
      if (search.remaining < 0) break;
    }
    if (search.incomplete) return { kind: 'unknown', reason: search.incomplete };
    return { kind: 'none' };
  });
}
