import { actionPermission } from '../shared/action-permissions';
import type { GameRoom } from '../types/game.room.types';
import type { CardInstance } from '../types/card.types';
import type { TargetingDefinition, TargetPointer } from '../types/effect.types';
import type { ChoiceAnswer, ChoiceOption, PendingChoice, ListedChoice, NumericChoice } from '../types/choice.types';
import type { ActionData } from './action-registry';
import { structuralTargetLegal, targetKey } from '../shared/target-legality';
import { PermissionRegistry } from './permission-registry';
import { collectCards } from '../shared/card-query';
import { CardCharacteristicService } from './card-characteristic-service';

/** True when the choice's bounds and options can actually be satisfied. */
export function choiceCanComplete(choice: Pick<ListedChoice, 'kind' | 'options' | 'min' | 'max' | 'total' | 'minimumPerOption'> | Pick<NumericChoice, 'kind' | 'range'>): boolean {
  // Numeric choices only need a sane range.
  if (choice.kind === 'number') {
    return Number.isSafeInteger(choice.range.min) &&
      (choice.range.max === undefined || Number.isSafeInteger(choice.range.max) && choice.range.max >= choice.range.min);
  }

  // Guard: option ids must be non-empty and unique.
  if (
    choice.options.some((option) => typeof option.id !== 'string' || !option.id.trim()) ||
    new Set(choice.options.map((option) => option.id)).size !== choice.options.length
  ) {
    return false;
  }

  // Guard: the selection bounds must be satisfiable by the option count.
  if (
    !Number.isSafeInteger(choice.min) ||
    !Number.isSafeInteger(choice.max) ||
    choice.min < 0 ||
    choice.max < choice.min ||
    choice.options.length < choice.min
  ) {
    return false;
  }

  // Listed choices are complete once the bounds hold.
  if (choice.kind !== 'distribution' && choice.kind !== 'payment') return true;

  const total = choice.total;

  return Number.isSafeInteger(total) &&
    total! >= 0 &&
    choice.options.length * (choice.minimumPerOption ?? 0) <= total! &&
    (choice.options.length > 0 || total === 0) &&
    choice.options.reduce((sum, option) => sum + (option.limit ?? total!), 0) >= total!;
}

/** Enumerate every legal target pointer for a targeting definition. */
export function targetOptions(room: GameRoom, playerId: string, source: CardInstance, def: TargetingDefinition, targeted = true): ChoiceOption[] {
  const cards = collectCards(room);
  const byId = new Map(cards.map((card) => [card.uuid, card]));

  const pointers: TargetPointer[] = def.type === 'any'
    ? [
      ...Object.keys(room.players).map((playerId) => ({ targetType: 'player' as const, playerId })),
      ...room.battlefield.map((card) => ({
        targetType: 'permanent' as const,
        cardUuid: card.uuid,
        zone: card.state.zone,
        zoneRevision: card.state.zoneRevision ?? 0,
      })),
    ]
    : def.type === 'player'
      ? Object.keys(room.players).map((playerId) => ({ targetType: 'player', playerId }))
      : def.type === 'spell' || def.type === 'stack'
        ? room.stack.map((object) => ({ targetType: def.type, stackUuid: object.uuid }))
        : cards.map((card) => ({
          targetType: def.type,
          cardUuid: card.uuid,
          zone: card.state.zone,
          zoneRevision: card.state.zoneRevision ?? 0,
        }));

  return pointers
    .filter((pointer) => {
      if (!structuralTargetLegal(room, playerId, pointer, def)) return false;
      if (targeted) return PermissionRegistry.canTarget(room, playerId, source, [pointer]);

      const card = byId.get(pointer.cardUuid!);
      return !card || actionPermission(room, playerId, card, 'affect').allowed;
    })
    .map((pointer) => {
      const card = byId.get(pointer.cardUuid!);

      return {
        id: targetKey(pointer),
        label: (pointer.playerId ? pointer.playerId === playerId ? 'You' : 'Opponent' : undefined) ??
          pointer.stackUuid ??
          (card ? CardCharacteristicService.resolve(room, card).name : pointer.cardUuid!),
        value: pointer,
      };
    });
}

/** Validate a submitted answer against the pending choice; undefined means invalid. */
export function validateChoiceAnswer(choice: PendingChoice, data: ActionData): ChoiceAnswer | undefined {
  if (choice.kind === 'number') {
    const number = data.number;

    // Guard: the number must be an integer inside the offered range.
    if (
      typeof number !== 'number' ||
      !Number.isSafeInteger(number) ||
      number < choice.range.min ||
      (choice.range.max !== undefined && number > choice.range.max)
    ) {
      return;
    }

    return { values: [], number };
  }

  if (choice.kind === 'distribution' || choice.kind === 'payment') {
    if (!data.allocations || typeof data.allocations !== 'object' || Array.isArray(data.allocations)) return;

    const allocations = data.allocations as Record<string, number>;

    // Guard: every option must receive at least its minimum.
    if (choice.options.some((option) => (allocations[option.id] ?? 0) < (choice.minimumPerOption ?? 0))) return;

    // Guard: amounts must be non-negative integers within each option's limit,
    // and the allocation must spend the whole total.
    if (
      Object.entries(allocations).some(([id, amount]) =>
        !Number.isSafeInteger(amount) ||
        amount < 0 ||
        !choice.options.some((option) => option.id === id && amount <= (option.limit ?? Infinity))) ||
      Object.values(allocations).reduce((sum, amount) => sum + amount, 0) !== choice.total
    ) {
      return;
    }

    return {
      allocations,
      values: choice.options.filter((option) => (allocations[option.id] ?? 0) > 0).map((option) => option.value),
    };
  }

  const selected = data.choices;

  // Guard: the selection must be unique, in range, and name known options.
  if (
    !Array.isArray(selected) ||
    selected.length < choice.min ||
    selected.length > choice.max ||
    new Set(selected).size !== selected.length ||
    selected.some((id) => typeof id !== 'string' || !choice.options.some((option) => option.id === id))
  ) {
    return;
  }

  const options = selected.map(id => choice.options.find(option => option.id === id)!);
  const groups = options.flatMap(option => option.distinctGroup === undefined ? [] : [option.distinctGroup]);
  if (new Set(groups).size !== groups.length) return;
  return { values: options.map(option => option.value) };
}
