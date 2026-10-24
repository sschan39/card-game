import type { GameRoom } from '../types/game.room.types';
import type { CardInstance } from '../types/card.types';
import type { TargetingDefinition, TargetPointer } from '../types/effect.types';
import type { ChoiceAnswer, ChoiceOption, PendingChoice, ListedChoice, NumericChoice } from '../types/choice.types';
import type { ActionData } from './action-registry';
import { structuralTargetLegal, targetKey } from '../shared/target-legality';
import { ModifierRegistry } from './modifier-registry';

export function choiceCanComplete(choice: Pick<ListedChoice, 'kind' | 'options' | 'min' | 'max' | 'total' | 'minimumPerOption'> | Pick<NumericChoice, 'kind' | 'range'>): boolean {
  if (choice.kind === 'number') return Number.isSafeInteger(choice.range.min) && (choice.range.max === undefined || Number.isSafeInteger(choice.range.max) && choice.range.max >= choice.range.min);
  if (choice.options.some(option => typeof option.id !== 'string' || !option.id.trim()) || new Set(choice.options.map(option => option.id)).size !== choice.options.length) return false;
  if (!Number.isSafeInteger(choice.min) || !Number.isSafeInteger(choice.max) || choice.min < 0 || choice.max < choice.min || choice.options.length < choice.min) return false;
  if (choice.kind !== 'distribution' && choice.kind !== 'payment') return true;
  const total = choice.total;
  return Number.isSafeInteger(total) && total! >= 0 && choice.options.length * (choice.minimumPerOption ?? 0) <= total! &&
    (choice.options.length > 0 || total === 0) && choice.options.reduce((sum, option) => sum + (option.limit ?? total!), 0) >= total!;
}

export function targetOptions(room: GameRoom, playerId: string, source: CardInstance, def: TargetingDefinition, targeted = true): ChoiceOption[] {
  const pointers: TargetPointer[] = def.type === 'any' ? [
    ...Object.keys(room.players).map(playerId => ({ targetType: 'player' as const, playerId })),
    ...room.battlefield.map(card => ({ targetType: 'permanent' as const, cardUuid: card.uuid, zone: card.state.zone, zoneRevision: card.state.zoneRevision ?? 0 })),
  ] : def.type === 'player' ? Object.keys(room.players).map(playerId => ({ targetType: 'player', playerId }))
    : def.type === 'spell' || def.type === 'stack' ? room.stack.map(object => ({ targetType: def.type, stackUuid: object.uuid }))
    : [...room.battlefield, ...Object.values(room.players).flatMap(p => [...p.hand, ...p.graveyard, ...p.deck, ...p.exile ?? []])].map(card => ({ targetType: def.type, cardUuid: card.uuid,
      zone: card.state.zone, zoneRevision: card.state.zoneRevision ?? 0 }));
  return pointers.filter(pointer => structuralTargetLegal(room, playerId, pointer, def) && (!targeted || ModifierRegistry.canTarget(room, playerId, source, [pointer])))
    .map(pointer => ({ id: targetKey(pointer), label: (pointer.playerId ? pointer.playerId === playerId ? 'You' : 'Opponent' : undefined) ?? pointer.stackUuid ??
      [...room.battlefield, ...Object.values(room.players).flatMap(p => [...p.hand, ...p.graveyard, ...p.deck, ...p.exile ?? []])].find(c => c.uuid === pointer.cardUuid)?.blueprint.name ?? pointer.cardUuid!, value: pointer }));
}

export function validateChoiceAnswer(choice: PendingChoice, data: ActionData): ChoiceAnswer | undefined {
  if (choice.kind === 'number') {
    const number = data.number;
    if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < choice.range.min || (choice.range.max !== undefined && number > choice.range.max)) return;
    return { values: [], number };
  }
  if (choice.kind === 'distribution' || choice.kind === 'payment') {
    if (!data.allocations || typeof data.allocations !== 'object' || Array.isArray(data.allocations)) return;
    const allocations = data.allocations as Record<string, number>;
    if (choice.options.some(option => (allocations[option.id] ?? 0) < (choice.minimumPerOption ?? 0))) return;
    if (Object.entries(allocations).some(([id, amount]) => !Number.isSafeInteger(amount) || amount < 0 ||
      !choice.options.some(option => option.id === id && amount <= (option.limit ?? Infinity))) ||
      Object.values(allocations).reduce((sum, amount) => sum + amount, 0) !== choice.total) return;
    return { allocations, values: choice.options.filter(option => (allocations[option.id] ?? 0) > 0).map(option => option.value) };
  }
  const selected = data.choices;
  if (!Array.isArray(selected) || selected.length < choice.min || selected.length > choice.max || new Set(selected).size !== selected.length ||
    selected.some(id => typeof id !== 'string' || !choice.options.some(option => option.id === id))) return;
  return { values: selected.map(id => choice.options.find(option => option.id === id)!.value) };
}
